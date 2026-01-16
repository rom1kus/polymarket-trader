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
  FillEconomics,
  InitialCostBasis,
  PositionState,
  PositionLimitsConfig,
  QuoteSideCheck,
  PositionLimitStatus,
  ReconciliationResult,
} from "@/types/fills.js";
import { createEmptyEconomics } from "@/types/fills.js";
import {
  loadMarketState,
  saveMarketState,
  appendFill,
  setInitialPosition,
  rebuildEconomicsFromFills,
} from "@/utils/storage.js";
import { log } from "@/utils/helpers.js";

/**
 * Position tracker for a single binary market.
 *
 * Manages position state, enforces limits, tracks P&L economics,
 * and persists fill history.
 */
export class PositionTracker {
  private conditionId: string;
  private yesTokenId: string;
  private noTokenId: string;
  private limits: PositionLimitsConfig;

  // Current position state
  private yesTokens: number = 0;
  private noTokens: number = 0;

  // P&L economics tracking
  private economics: FillEconomics = createEmptyEconomics();

  // User-provided cost basis for pre-existing positions
  private initialCostBasis: InitialCostBasis | null = null;

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
  initialize(yesBalance: number, noBalance: number): ReconciliationResult & { needsCostBasis?: boolean } {
    // Load persisted state
    const persisted = loadMarketState(this.conditionId);

    if (!persisted) {
      // First run - no persisted data
      // Use actual balance as starting point
      this.yesTokens = yesBalance;
      this.noTokens = noBalance;
      this.economics = createEmptyEconomics();

      // Create new persisted state with initial position
      setInitialPosition(
        this.conditionId,
        this.yesTokenId,
        this.noTokenId,
        yesBalance,
        noBalance
      );

      this.initialized = true;

      // If starting with existing tokens, flag that we need cost basis
      const needsCostBasis = yesBalance > 0.001 || noBalance > 0.001;

      log(`[PositionTracker] Initialized fresh - YES: ${yesBalance.toFixed(2)}, NO: ${noBalance.toFixed(2)}`);
      if (needsCostBasis) {
        log(`[PositionTracker] Note: Starting with pre-existing tokens. Cost basis needed for P&L tracking.`);
      }

      const position = this.getPositionState();
      return {
        success: true,
        expectedPosition: position,
        actualPosition: position,
        discrepancy: { yesTokens: 0, noTokens: 0 },
        needsCostBasis,
      };
    }

    // Load economics (will be present in v2, rebuilt during migration from v1)
    this.economics = persisted.economics ?? rebuildEconomicsFromFills(persisted.fills, this.yesTokenId);

    // Load initial cost basis if present
    this.initialCostBasis = persisted.initialCostBasis ?? null;

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
        `  Adjusting baseline to match actual (preserving fill history).`
      );

      // Adjust the initial position to account for discrepancy
      // This preserves fill history while making the math work out
      // New initial = actual - sum(fills) = actual - (expected - old_initial)
      //             = actual - expected + old_initial
      const adjustedInitialYes = (persisted.initialPosition?.yesTokens ?? 0) + yesDiscrepancy;
      const adjustedInitialNo = (persisted.initialPosition?.noTokens ?? 0) + noDiscrepancy;

      // Update the initial position in persisted state (keeps fills intact)
      persisted.initialPosition = {
        yesTokens: adjustedInitialYes,
        noTokens: adjustedInitialNo,
        timestamp: Date.now(),
      };
      saveMarketState(persisted);

      log(
        `[PositionTracker] Adjusted baseline: YES=${adjustedInitialYes.toFixed(2)}, NO=${adjustedInitialNo.toFixed(2)}\n` +
        `  Preserved ${persisted.fills.length} fills in history.`
      );
    } else {
      log(
        `[PositionTracker] Loaded ${persisted.fills.length} fills - ` +
        `YES: ${yesBalance.toFixed(2)}, NO: ${noBalance.toFixed(2)}`
      );
    }

    // Check if we need cost basis for initial position
    const initialHasTokens = (persisted.initialPosition?.yesTokens ?? 0) > 0.001 ||
                             (persisted.initialPosition?.noTokens ?? 0) > 0.001;
    const needsCostBasis = initialHasTokens && !this.initialCostBasis;

    if (needsCostBasis) {
      log(`[PositionTracker] Note: Initial position has tokens without cost basis. P&L may be inaccurate.`);
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
      needsCostBasis,
    };
  }

  /**
   * Processes a new fill from WebSocket.
   *
   * Updates the position, economics, and persists the fill to disk.
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

    // Determine token type
    const isYes = fill.tokenId === this.yesTokenId;
    const isNo = fill.tokenId === this.noTokenId;

    if (!isYes && !isNo) {
      // Fill for unknown token - shouldn't happen but log it
      log(`[PositionTracker] Fill for unknown token: ${fill.tokenId}`);
      return false;
    }

    const cost = fill.price * fill.size;

    // Update position and economics
    if (isYes) {
      if (fill.side === "BUY") {
        this.yesTokens += fill.size;
        this.economics.totalYesBought += fill.size;
        this.economics.totalYesCost += cost;
      } else {
        this.yesTokens -= fill.size;
        this.economics.totalYesSold += fill.size;
        this.economics.totalYesProceeds += cost;

        // Calculate realized P&L for this sell (using weighted average cost)
        if (this.economics.totalYesBought > 0) {
          const avgCost = this.economics.totalYesCost / this.economics.totalYesBought;
          const realizedFromSale = (fill.price - avgCost) * fill.size;
          this.economics.realizedPnL += realizedFromSale;
        }
      }
    } else {
      // NO token
      if (fill.side === "BUY") {
        this.noTokens += fill.size;
        this.economics.totalNoBought += fill.size;
        this.economics.totalNoCost += cost;
      } else {
        this.noTokens -= fill.size;
        this.economics.totalNoSold += fill.size;
        this.economics.totalNoProceeds += cost;

        // Calculate realized P&L for this sell (using weighted average cost)
        if (this.economics.totalNoBought > 0) {
          const avgCost = this.economics.totalNoCost / this.economics.totalNoBought;
          const realizedFromSale = (fill.price - avgCost) * fill.size;
          this.economics.realizedPnL += realizedFromSale;
        }
      }
    }

    // Persist fill and economics
    appendFill(this.conditionId, this.yesTokenId, this.noTokenId, fill);
    this.saveEconomics();

    // Log the fill
    const tokenType = isYes ? "YES" : "NO";
    log(
      `[PositionTracker] Fill: ${fill.side} ${fill.size.toFixed(2)} ${tokenType} @ $${fill.price.toFixed(4)} ` +
      `| Net exposure: ${this.getNetExposure().toFixed(2)}`
    );

    return true;
  }

  /**
   * Saves current economics to persisted state.
   */
  private saveEconomics(): void {
    const state = loadMarketState(this.conditionId);
    if (state) {
      state.economics = this.economics;
      saveMarketState(state);
    }
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

  // =============================================================================
  // P&L Methods
  // =============================================================================

  /**
   * Gets the average cost for a token type.
   *
   * Returns null if no tokens of that type have been bought yet.
   * Note: Does not account for initial position cost basis (if not provided).
   *
   * @param tokenType - "YES" or "NO"
   * @returns Average cost per token (0-1), or null if no buys
   */
  getAverageCost(tokenType: "YES" | "NO"): number | null {
    if (tokenType === "YES") {
      // Include initial cost basis if available
      const initialYes = this.getInitialPositionTokens("YES");
      const initialCost = this.initialCostBasis?.yesAvgCost ?? null;

      const totalBought = this.economics.totalYesBought + (initialCost !== null ? initialYes : 0);
      const totalCost = this.economics.totalYesCost + (initialCost !== null ? initialYes * initialCost : 0);

      if (totalBought <= 0) return null;
      return totalCost / totalBought;
    } else {
      const initialNo = this.getInitialPositionTokens("NO");
      const initialCost = this.initialCostBasis?.noAvgCost ?? null;

      const totalBought = this.economics.totalNoBought + (initialCost !== null ? initialNo : 0);
      const totalCost = this.economics.totalNoCost + (initialCost !== null ? initialNo * initialCost : 0);

      if (totalBought <= 0) return null;
      return totalCost / totalBought;
    }
  }

  /**
   * Gets the initial position tokens for a token type.
   * Helper for cost basis calculations.
   */
  private getInitialPositionTokens(tokenType: "YES" | "NO"): number {
    const state = loadMarketState(this.conditionId);
    if (!state?.initialPosition) return 0;
    return tokenType === "YES" ? state.initialPosition.yesTokens : state.initialPosition.noTokens;
  }

  /**
   * Gets the unrealized P&L (mark-to-market) for current position.
   *
   * Calculates the paper profit/loss if you were to close the position at the current midpoint.
   *
   * @param currentMidpoint - Current market midpoint (YES price, 0-1)
   * @returns Unrealized P&L in dollars
   */
  getUnrealizedPnL(currentMidpoint: number): number {
    const avgYesCost = this.getAverageCost("YES");
    const avgNoCost = this.getAverageCost("NO");

    // YES tokens: current value - cost basis
    // If we hold YES tokens, their value is midpoint * quantity
    // Our cost was avgYesCost * quantity
    // Profit = (midpoint - avgYesCost) * quantity
    let yesUnrealized = 0;
    if (this.yesTokens > 0 && avgYesCost !== null) {
      yesUnrealized = this.yesTokens * (currentMidpoint - avgYesCost);
    }

    // NO tokens: current value is (1 - midpoint) * quantity
    // Our cost was avgNoCost * quantity
    // Profit = ((1 - midpoint) - avgNoCost) * quantity
    let noUnrealized = 0;
    if (this.noTokens > 0 && avgNoCost !== null) {
      noUnrealized = this.noTokens * ((1 - currentMidpoint) - avgNoCost);
    }

    return yesUnrealized + noUnrealized;
  }

  /**
   * Gets the realized P&L from completed round-trips.
   *
   * @returns Realized P&L in dollars
   */
  getRealizedPnL(): number {
    return this.economics.realizedPnL;
  }

  /**
   * Gets the total P&L (realized + unrealized).
   *
   * @param currentMidpoint - Current market midpoint (YES price, 0-1)
   * @returns Total P&L in dollars
   */
  getTotalPnL(currentMidpoint: number): number {
    return this.getRealizedPnL() + this.getUnrealizedPnL(currentMidpoint);
  }

  /**
   * Gets the raw economics data.
   * Useful for debugging or detailed display.
   */
  getEconomics(): FillEconomics {
    return { ...this.economics };
  }

  /**
   * Formats P&L status for display.
   *
   * @param currentMidpoint - Current market midpoint (YES price, 0-1)
   * @returns Formatted P&L string
   */
  formatPnLStatus(currentMidpoint: number): string {
    const avgYesCost = this.getAverageCost("YES");
    const avgNoCost = this.getAverageCost("NO");
    const unrealized = this.getUnrealizedPnL(currentMidpoint);
    const realized = this.getRealizedPnL();
    const total = unrealized + realized;

    const formatCost = (cost: number | null) => cost !== null ? `$${cost.toFixed(4)}` : "N/A";
    const formatPnL = (pnl: number) => {
      const sign = pnl >= 0 ? "+" : "";
      return `${sign}$${pnl.toFixed(2)}`;
    };

    return (
      `  Avg Cost: YES=${formatCost(avgYesCost)}, NO=${formatCost(avgNoCost)}\n` +
      `  P&L: Unrealized=${formatPnL(unrealized)}, Realized=${formatPnL(realized)}, Total=${formatPnL(total)}`
    );
  }

  /**
   * Formats a compact P&L summary for periodic logging.
   *
   * @param currentMidpoint - Current market midpoint (YES price, 0-1)
   * @returns Compact P&L string
   */
  formatPnLCompact(currentMidpoint: number): string {
    const unrealized = this.getUnrealizedPnL(currentMidpoint);
    const realized = this.getRealizedPnL();
    const formatPnL = (pnl: number) => {
      const sign = pnl >= 0 ? "+" : "";
      return `${sign}$${pnl.toFixed(2)}`;
    };
    return `P&L: ${formatPnL(unrealized)} unreal, ${formatPnL(realized)} real`;
  }

  /**
   * Sets the initial cost basis for pre-existing positions.
   *
   * Call this when starting with tokens that weren't acquired through tracked fills.
   *
   * @param yesAvgCost - Average cost per YES token (0-1), or null if none held
   * @param noAvgCost - Average cost per NO token (0-1), or null if none held
   */
  setInitialCostBasis(yesAvgCost: number | null, noAvgCost: number | null): void {
    this.initialCostBasis = {
      yesAvgCost,
      noAvgCost,
      timestamp: Date.now(),
    };

    // Persist to state
    const state = loadMarketState(this.conditionId);
    if (state) {
      state.initialCostBasis = this.initialCostBasis;
      saveMarketState(state);
    }

    log(
      `[PositionTracker] Initial cost basis set:\n` +
      `  YES: ${yesAvgCost !== null ? `$${yesAvgCost.toFixed(4)}` : "N/A"}\n` +
      `  NO:  ${noAvgCost !== null ? `$${noAvgCost.toFixed(4)}` : "N/A"}`
    );
  }

  /**
   * Checks if initial cost basis is needed for accurate P&L tracking.
   */
  needsInitialCostBasis(): boolean {
    const initialYes = this.getInitialPositionTokens("YES");
    const initialNo = this.getInitialPositionTokens("NO");
    const hasInitialPosition = initialYes > 0.001 || initialNo > 0.001;
    return hasInitialPosition && this.initialCostBasis === null;
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
