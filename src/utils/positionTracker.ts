/**
 * Position tracker for market making strategies.
 *
 * Tracks YES and NO token positions, calculates net exposure,
 * and enforces position limits to prevent excessive directional risk.
 *
 * Position is tracked both from:
 * 1. Initial balance (loaded from API on startup)
 * 2. Fills (received via WebSocket, persisted to disk)
 *
 * Net exposure = yesTokens - noTokens
 * - Positive = long YES (profit if market resolves YES)
 * - Negative = long NO (profit if market resolves NO)
 * - Zero = market neutral (can merge all tokens back to USDC)
 *
 * @example
 * ```typescript
 * const tracker = new PositionTracker(
 *   "0xabc...",      // conditionId
 *   "12345...",      // yesTokenId
 *   "67890...",      // noTokenId
 *   { maxNetExposure: 100, warnThreshold: 0.8 }
 * );
 *
 * // Initialize from current balance
 * await tracker.initialize(50, 50); // 50 YES, 50 NO = neutral
 *
 * // Process fills as they come in
 * tracker.processFill(fill);
 *
 * // Check if we can quote
 * const canBuy = tracker.canQuoteBuy();
 * const canSell = tracker.canQuoteSell();
 * ```
 */

import type {
  Fill,
  PositionState,
  PositionLimitsConfig,
  QuoteSideCheck,
  PositionLimitStatus,
  ReconciliationResult,
} from "@/types/fills.js";
import {
  loadMarketState,
  saveMarketState,
  createEmptyState,
  appendFill,
  setInitialPosition,
} from "@/utils/storage.js";
import { log } from "@/utils/helpers.js";

/**
 * Position tracker for a single binary market.
 *
 * Manages position state, enforces limits, and persists fill history.
 */
export class PositionTracker {
  private conditionId: string;
  private yesTokenId: string;
  private noTokenId: string;
  private limits: PositionLimitsConfig;

  // Current position state
  private yesTokens: number = 0;
  private noTokens: number = 0;

  // Track fills received this session (for deduplication)
  private processedFillIds: Set<string> = new Set();

  // Whether we've been initialized
  private initialized: boolean = false;

  constructor(
    conditionId: string,
    yesTokenId: string,
    noTokenId: string,
    limits: PositionLimitsConfig
  ) {
    this.conditionId = conditionId;
    this.yesTokenId = yesTokenId;
    this.noTokenId = noTokenId;
    this.limits = limits;
  }

  /**
   * Initializes the tracker from current balances and persisted fills.
   *
   * This should be called once on startup with the actual token balances
   * from the CLOB API. The tracker will then load any persisted fills
   * and reconcile the position.
   *
   * @param yesBalance - Current YES token balance from API
   * @param noBalance - Current NO token balance from API
   * @returns Reconciliation result showing any discrepancies
   */
  initialize(yesBalance: number, noBalance: number): ReconciliationResult {
    // Load persisted state
    const persisted = loadMarketState(this.conditionId);

    if (!persisted) {
      // First run - no persisted data
      // Use actual balance as starting point
      this.yesTokens = yesBalance;
      this.noTokens = noBalance;

      // Create new persisted state with initial position
      setInitialPosition(
        this.conditionId,
        this.yesTokenId,
        this.noTokenId,
        yesBalance,
        noBalance
      );

      this.initialized = true;

      log(`[PositionTracker] Initialized fresh - YES: ${yesBalance}, NO: ${noBalance}`);

      const position = this.getPositionState();
      return {
        success: true,
        expectedPosition: position,
        actualPosition: position,
        discrepancy: { yesTokens: 0, noTokens: 0 },
      };
    }

    // We have persisted data - calculate expected position from fills
    let expectedYes = persisted.initialPosition?.yesTokens ?? 0;
    let expectedNo = persisted.initialPosition?.noTokens ?? 0;

    // Apply all fills to get expected position
    for (const fill of persisted.fills) {
      // Skip non-confirmed fills
      if (fill.status === "FAILED") continue;

      // Track processed fills for deduplication
      this.processedFillIds.add(fill.id);

      // Apply fill to expected position
      if (fill.tokenId === this.yesTokenId) {
        if (fill.side === "BUY") {
          expectedYes += fill.size;
        } else {
          expectedYes -= fill.size;
        }
      } else if (fill.tokenId === this.noTokenId) {
        if (fill.side === "BUY") {
          expectedNo += fill.size;
        } else {
          expectedNo -= fill.size;
        }
      }
    }

    // Calculate discrepancy
    const yesDiscrepancy = yesBalance - expectedYes;
    const noDiscrepancy = noBalance - expectedNo;
    const hasDiscrepancy = Math.abs(yesDiscrepancy) > 0.001 || Math.abs(noDiscrepancy) > 0.001;

    // Always use actual balance as truth
    this.yesTokens = yesBalance;
    this.noTokens = noBalance;
    this.initialized = true;

    const actualPosition = this.getPositionState();
    const expectedPosition: PositionState = {
      yesTokens: expectedYes,
      noTokens: expectedNo,
      netExposure: expectedYes - expectedNo,
      neutralPosition: Math.min(expectedYes, expectedNo),
    };

    if (hasDiscrepancy) {
      log(
        `[PositionTracker] Position discrepancy detected:\n` +
        `  Expected: YES=${expectedYes.toFixed(2)}, NO=${expectedNo.toFixed(2)}\n` +
        `  Actual:   YES=${yesBalance.toFixed(2)}, NO=${noBalance.toFixed(2)}\n` +
        `  Using actual balance as truth.`
      );

      // Update initial position to account for discrepancy
      // This effectively "resets" the baseline to current state
      setInitialPosition(
        this.conditionId,
        this.yesTokenId,
        this.noTokenId,
        yesBalance,
        noBalance
      );

      // Clear fills since we're resetting
      const newState = createEmptyState(this.conditionId, this.yesTokenId, this.noTokenId);
      newState.initialPosition = {
        yesTokens: yesBalance,
        noTokens: noBalance,
        timestamp: Date.now(),
      };
      saveMarketState(newState);
      this.processedFillIds.clear();
    } else {
      log(
        `[PositionTracker] Loaded ${persisted.fills.length} fills - ` +
        `YES: ${yesBalance.toFixed(2)}, NO: ${noBalance.toFixed(2)}`
      );
    }

    return {
      success: true,
      expectedPosition,
      actualPosition,
      discrepancy: {
        yesTokens: yesDiscrepancy,
        noTokens: noDiscrepancy,
      },
      warning: hasDiscrepancy
        ? `Position discrepancy: YES=${yesDiscrepancy.toFixed(2)}, NO=${noDiscrepancy.toFixed(2)}`
        : undefined,
    };
  }

  /**
   * Processes a new fill from WebSocket.
   *
   * Updates the position and persists the fill to disk.
   * Handles deduplication (same fill ID won't be processed twice).
   *
   * @param fill - Fill to process
   * @returns True if fill was new and processed, false if duplicate
   */
  processFill(fill: Fill): boolean {
    if (!this.initialized) {
      log(`[PositionTracker] Warning: processFill called before initialize`);
      return false;
    }

    // Check for duplicate
    if (this.processedFillIds.has(fill.id)) {
      return false;
    }

    // Skip failed fills
    if (fill.status === "FAILED") {
      log(`[PositionTracker] Skipping failed fill: ${fill.id}`);
      return false;
    }

    // Track as processed
    this.processedFillIds.add(fill.id);

    // Update position
    if (fill.tokenId === this.yesTokenId) {
      if (fill.side === "BUY") {
        this.yesTokens += fill.size;
      } else {
        this.yesTokens -= fill.size;
      }
    } else if (fill.tokenId === this.noTokenId) {
      if (fill.side === "BUY") {
        this.noTokens += fill.size;
      } else {
        this.noTokens -= fill.size;
      }
    } else {
      // Fill for unknown token - shouldn't happen but log it
      log(`[PositionTracker] Fill for unknown token: ${fill.tokenId}`);
      return false;
    }

    // Persist fill
    appendFill(this.conditionId, this.yesTokenId, this.noTokenId, fill);

    // Log the fill
    const tokenType = fill.tokenId === this.yesTokenId ? "YES" : "NO";
    log(
      `[PositionTracker] Fill: ${fill.side} ${fill.size.toFixed(2)} ${tokenType} @ ${fill.price.toFixed(4)} ` +
      `| Net exposure: ${this.getNetExposure().toFixed(2)}`
    );

    return true;
  }

  /**
   * Gets the current position state.
   */
  getPositionState(): PositionState {
    return {
      yesTokens: this.yesTokens,
      noTokens: this.noTokens,
      netExposure: this.yesTokens - this.noTokens,
      neutralPosition: Math.min(this.yesTokens, this.noTokens),
    };
  }

  /**
   * Gets the current net exposure.
   * Positive = long YES, Negative = long NO.
   */
  getNetExposure(): number {
    return this.yesTokens - this.noTokens;
  }

  /**
   * Checks if we can quote the BUY side (buying YES tokens).
   *
   * Buying YES increases yesTokens, which increases netExposure.
   * We block if netExposure would exceed maxNetExposure.
   */
  canQuoteBuy(): QuoteSideCheck {
    const netExposure = this.getNetExposure();

    if (netExposure >= this.limits.maxNetExposure) {
      return {
        allowed: false,
        reason: `Net exposure ${netExposure.toFixed(2)} >= limit ${this.limits.maxNetExposure}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Checks if we can quote the SELL side (selling YES tokens).
   *
   * Selling YES decreases yesTokens, which decreases netExposure.
   * We block if netExposure would go below -maxNetExposure.
   */
  canQuoteSell(): QuoteSideCheck {
    const netExposure = this.getNetExposure();

    if (netExposure <= -this.limits.maxNetExposure) {
      return {
        allowed: false,
        reason: `Net exposure ${netExposure.toFixed(2)} <= -${this.limits.maxNetExposure}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Gets the current position limit status.
   */
  getLimitStatus(): PositionLimitStatus {
    const netExposure = this.getNetExposure();
    const absExposure = Math.abs(netExposure);
    const utilizationPercent = (absExposure / this.limits.maxNetExposure) * 100;
    const isWarning = utilizationPercent >= this.limits.warnThreshold * 100;
    const isLimitReached = absExposure >= this.limits.maxNetExposure;

    let blockedSide: "BUY" | "SELL" | null = null;
    if (netExposure >= this.limits.maxNetExposure) {
      blockedSide = "BUY";
    } else if (netExposure <= -this.limits.maxNetExposure) {
      blockedSide = "SELL";
    }

    return {
      netExposure,
      maxAllowed: this.limits.maxNetExposure,
      utilizationPercent: Math.min(utilizationPercent, 100),
      isWarning,
      isLimitReached,
      blockedSide,
    };
  }

  /**
   * Formats the position status for display.
   */
  formatStatus(): string {
    const state = this.getPositionState();
    const limit = this.getLimitStatus();

    const lines = [
      `  YES Tokens: ${state.yesTokens.toFixed(2)}`,
      `  NO Tokens:  ${state.noTokens.toFixed(2)}`,
      `  Net Exposure: ${state.netExposure >= 0 ? "+" : ""}${state.netExposure.toFixed(2)} (${state.netExposure >= 0 ? "long YES" : "long NO"})`,
      `  Neutral (mergeable): ${state.neutralPosition.toFixed(2)}`,
      `  Limit Usage: ${limit.utilizationPercent.toFixed(1)}% of ±${limit.maxAllowed}`,
    ];

    if (limit.isLimitReached) {
      lines.push(`  ⚠ LIMIT REACHED - ${limit.blockedSide} side blocked`);
    } else if (limit.isWarning) {
      lines.push(`  ⚠ Warning: approaching position limit`);
    }

    return lines.join("\n");
  }

  /**
   * Updates position limits configuration.
   *
   * @param limits - New limits configuration
   */
  updateLimits(limits: PositionLimitsConfig): void {
    this.limits = limits;
  }

  /**
   * Manually adjusts position (for reconciliation or CTF operations).
   *
   * Use this when tokens are split/merged outside of trading.
   *
   * @param yesTokens - New YES token balance
   * @param noTokens - New NO token balance
   */
  adjustPosition(yesTokens: number, noTokens: number): void {
    const oldState = this.getPositionState();

    this.yesTokens = yesTokens;
    this.noTokens = noTokens;

    const newState = this.getPositionState();

    log(
      `[PositionTracker] Position adjusted:\n` +
      `  Before: YES=${oldState.yesTokens.toFixed(2)}, NO=${oldState.noTokens.toFixed(2)}\n` +
      `  After:  YES=${newState.yesTokens.toFixed(2)}, NO=${newState.noTokens.toFixed(2)}`
    );

    // Update persisted initial position to new values
    setInitialPosition(
      this.conditionId,
      this.yesTokenId,
      this.noTokenId,
      yesTokens,
      noTokens
    );
  }
}

/**
 * Creates a position tracker with default limits.
 *
 * @param conditionId - Market condition ID
 * @param yesTokenId - YES token ID
 * @param noTokenId - NO token ID
 * @param maxNetExposure - Maximum net exposure (default: 100)
 * @returns New position tracker instance
 */
export function createPositionTracker(
  conditionId: string,
  yesTokenId: string,
  noTokenId: string,
  maxNetExposure: number = 100
): PositionTracker {
  return new PositionTracker(conditionId, yesTokenId, noTokenId, {
    maxNetExposure,
    warnThreshold: 0.8,
  });
}
