/**
 * Market Maker Orchestrator - Automatic market selection and switching.
 *
 * The orchestrator automatically:
 * 1. Finds the best market based on earning potential
 * 2. Runs the market maker until position becomes neutral
 * 3. Re-evaluates markets and switches if significantly better
 * 4. Continues until shutdown
 *
 * Features:
 * - Automatic market discovery and ranking
 * - Configurable switching threshold (default 20% improvement)
 * - Graceful shutdown with session summary
 * - Log-only mode for safe testing (default)
 *
 * Usage:
 *   npm run orchestrate                      # Dry run, no switching
 *   npm run orchestrate -- --liquidity 200   # Custom liquidity
 *   npm run orchestrate -- --enable-switching --no-dry-run  # Live mode
 */

import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { log, formatDuration, promptForInput } from "@/utils/helpers.js";
import { getUsdcBalance } from "@/utils/balance.js";
import { cancelOrdersForToken, cancelOrder } from "@/utils/orders.js";
import { findBestMarket, discoverMarkets, type RankedMarketByEarnings } from "@/utils/marketDiscovery.js";
import { generateMarketConfig, formatMarketConfig } from "@/utils/marketConfigGenerator.js";
import { calculateActualEarnings } from "@/utils/rewards.js";
import { getMidpoint } from "@/utils/orders.js";
import { createMarketMakerConfig } from "../marketMaker/config.js";
import { validateConfig, printBanner } from "../marketMaker/lifecycle.js";
import { runWithWebSocket } from "../marketMaker/modes/index.js";
import {
  detectExistingPositions,
  findPriorityMarket,
  printPositionsSummary,
  promptPositionAction,
  type DetectedPosition,
} from "@/utils/orchestratorState.js";
import { saveLiquidations, clearLiquidations, loadLiquidations, type PersistedLiquidation } from "@/utils/liquidationState.js";
import { loadMarketState } from "@/utils/storage.js";
import { createPositionTracker } from "@/utils/positionTracker.js";
import { manageLiquidations, calculateMaxBuyPrice } from "./liquidation.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerResult, OrchestratableMarketMakerConfig, SessionStats } from "../marketMaker/types.js";
import type {
  OrchestratorState,
  OrchestratorPhase,
  SwitchDecision,
  OrchestratorSessionSummary,
  OrchestratorEvent,
  PendingSwitch,
  LiquidationMarket,
} from "./types.js";
import { LiquidationStage } from "./types.js";
import type { OrchestratorConfig } from "./config.js";
import {
  createOrchestratorConfig,
  parseOrchestratorArgs,
  validateOrchestratorConfig,
} from "./config.js";

// =============================================================================
// Constants
// =============================================================================

const SEPARATOR = "═".repeat(70);
const SECTION = "─".repeat(70);

// =============================================================================
// State Management
// =============================================================================

/**
 * Creates initial orchestrator state.
 */
function createInitialState(): OrchestratorState {
  return {
    phase: "startup",
    currentMarket: null,
    currentConfig: null,
    pendingSwitch: null,
    liquidationMarkets: [],
    switchCount: 0,
    marketsVisited: [],
    startTime: new Date(),
    running: true,
    lastError: null,
    cumulativeStats: {
      startTime: Date.now(),
      fillCount: 0,
      totalVolume: 0,
      mergeCount: 0,
      totalMerged: 0,
      rebalanceCount: 0,
      ordersPlaced: 0,
      ordersCancelled: 0,
    },
  };
}

/**
 * Updates state phase with logging.
 */
function setPhase(state: OrchestratorState, phase: OrchestratorPhase): void {
  state.phase = phase;
}

/**
 * Saves current liquidation state to disk.
 * Called whenever liquidation queue changes (add/remove markets).
 */
function saveLiquidationsState(state: OrchestratorState): void {
  const persistedLiquidations: PersistedLiquidation[] = state.liquidationMarkets.map(lm => ({
    conditionId: lm.market.conditionId,
    startedAt: lm.startedAt.getTime(),
    stage: lm.stage,
  }));
  
  saveLiquidations(persistedLiquidations);
}

/**
 * Accumulates stats from a market maker run.
 */
function accumulateStats(state: OrchestratorState, stats: SessionStats): void {
  state.cumulativeStats.fillCount += stats.fillCount;
  state.cumulativeStats.totalVolume += stats.totalVolume;
  state.cumulativeStats.mergeCount += stats.mergeCount;
  state.cumulativeStats.totalMerged += stats.totalMerged;
  state.cumulativeStats.rebalanceCount += stats.rebalanceCount;
  state.cumulativeStats.ordersPlaced += stats.ordersPlaced;
  state.cumulativeStats.ordersCancelled += stats.ordersCancelled;
}

// =============================================================================
// Market Switching Logic
// =============================================================================

/**
 * Parameters for switch decision.
 */
export interface SwitchParams {
  /** Current market's earnings (actual or estimated) */
  currentEarnings: number;
  /** Whether current earnings are from actual placed orders */
  currentIsActual: boolean;
  /** Candidate market's estimated earnings */
  candidateEarnings: number;
  /** Candidate market's condition ID */
  candidateConditionId: string;
  /** Current market's condition ID */
  currentConditionId: string;
}

/**
 * Determines whether to switch from current market to candidate.
 *
 * Uses actual earnings from placed orders when available, falls back
 * to estimated earnings otherwise. This ensures we're comparing real
 * performance, not just theoretical potential.
 *
 * @param params - Switch parameters with earnings data
 * @param minImprovement - Minimum improvement threshold (e.g., 0.2 = 20%)
 * @returns Switch decision with details
 */
export function shouldSwitch(
  params: SwitchParams,
  minImprovement: number
): SwitchDecision {
  const {
    currentEarnings,
    currentIsActual,
    candidateEarnings,
    candidateConditionId,
    currentConditionId,
  } = params;

  // Same market = stay
  if (currentConditionId === candidateConditionId) {
    return {
      shouldSwitch: false,
      currentEarnings,
      currentIsActual,
      candidateEarnings,
      improvement: 0,
      reason: "Current market is still the best",
    };
  }

  // Calculate improvement
  const improvement =
    currentEarnings > 0
      ? (candidateEarnings - currentEarnings) / currentEarnings
      : candidateEarnings > 0
        ? 1 // Any positive is 100% improvement from 0
        : 0;

  // Check threshold
  if (improvement >= minImprovement) {
    const earningsType = currentIsActual ? "actual" : "estimated";
    return {
      shouldSwitch: true,
      currentEarnings,
      currentIsActual,
      candidateEarnings,
      improvement,
      reason: `${(improvement * 100).toFixed(1)}% improvement over ${earningsType} (threshold: ${(minImprovement * 100).toFixed(0)}%)`,
    };
  }

  return {
    shouldSwitch: false,
    currentEarnings,
    currentIsActual,
    candidateEarnings,
    improvement,
    reason: `${(improvement * 100).toFixed(1)}% improvement below threshold (${(minImprovement * 100).toFixed(0)}%)`,
  };
}

// =============================================================================
// Printing & Logging
// =============================================================================

/**
 * Prints the orchestrator startup banner.
 */
function printOrchestratorBanner(config: OrchestratorConfig): void {
  const reEvalMinutes = config.reEvaluateIntervalMs / 60000;
  
  console.log("");
  console.log(SEPARATOR);
  console.log("  MARKET MAKER ORCHESTRATOR");
  console.log(SEPARATOR);
  console.log("");
  console.log("  Configuration:");
  console.log(`    Liquidity:         $${config.liquidity}`);
  console.log(`    Switch Threshold:  ${(config.minEarningsImprovement * 100).toFixed(0)}% improvement`);
  console.log(`    Re-evaluate:       Every ${reEvalMinutes.toFixed(1)} minutes`);
  console.log(`    Order Size:        ${config.orderSize} shares`);
  console.log(`    Spread:            ${(config.spreadPercent * 100).toFixed(0)}% of maxSpread`);
  console.log(`    NegRisk Markets:   ${config.excludeNegRisk ? "EXCLUDED" : "ALLOWED"}`);
  console.log("");
  console.log("  Mode:");
  console.log(`    Dry Run:           ${config.dryRun ? "YES (no real orders)" : "NO (live orders)"}`);
  console.log(`    Switching:         ${config.enableSwitching ? "ENABLED" : "DISABLED (log only)"}`);
  console.log("");
  console.log(SEPARATOR);
  console.log("");
}

/**
 * Prints market discovery progress.
 */
function printDiscoveryProgress(phase: string, message: string): void {
  log(`[Discovery] ${phase}: ${message}`);
}

/**
 * Prints the selected market info.
 */
function printSelectedMarket(market: RankedMarketByEarnings): void {
  console.log("");
  console.log(SECTION);
  console.log("  SELECTED MARKET");
  console.log(SECTION);
  console.log(`  Question: ${market.question}`);
  console.log(`  Event:    ${market.eventSlug}`);
  console.log(`  Est. Daily: $${market.earningPotential.estimatedDailyEarnings.toFixed(4)}`);
  console.log(`  Min Size:   ${market.rewardsMinSize} shares`);
  console.log(`  Max Spread: ${market.rewardsMaxSpread} cents`);
  console.log(`  NegRisk:    ${market.negRisk ? "true" : "false"}`);
  console.log(SECTION);
  console.log("");
}

/**
 * Prints switch decision.
 */
function printSwitchDecision(decision: SwitchDecision, enableSwitching: boolean): void {
  const earningsType = decision.currentIsActual ? "(actual)" : "(estimated)";
  
  console.log("");
  console.log(SECTION);
  console.log("  SWITCH EVALUATION");
  console.log(SECTION);
  console.log(`  Current earnings:   $${decision.currentEarnings.toFixed(4)}/day ${earningsType}`);
  console.log(`  Candidate earnings: $${decision.candidateEarnings.toFixed(4)}/day (estimated)`);
  console.log(`  Improvement:        ${(decision.improvement * 100).toFixed(1)}%`);
  console.log(`  Decision:           ${decision.shouldSwitch ? "SWITCH" : "STAY"}`);
  console.log(`  Reason:             ${decision.reason}`);
  if (decision.shouldSwitch && !enableSwitching) {
    console.log(`  Note:               Switching disabled, staying in current market`);
  }
  console.log(SECTION);
  console.log("");
}

/**
 * Prints session summary on shutdown.
 */
function printSessionSummary(state: OrchestratorState): void {
  const runtime = Date.now() - state.startTime.getTime();
  const completedLiquidations = state.liquidationMarkets.filter(lm => 
    Math.abs(lm.tracker.getNetExposure()) < 0.1
  ).length;

  console.log("");
  console.log(SEPARATOR);
  console.log("  SESSION SUMMARY");
  console.log(SEPARATOR);
  console.log(`  Runtime:        ${formatDuration(runtime)}`);
  console.log(`  Markets:        ${state.marketsVisited.length} visited`);
  console.log(`  Switches:       ${state.switchCount}`);
  console.log(`  Liquidations:   ${completedLiquidations} completed, ${state.liquidationMarkets.length} active`);
  console.log(`  Total Fills:    ${state.cumulativeStats.fillCount}`);
  console.log(`  Total Volume:   $${state.cumulativeStats.totalVolume.toFixed(2)}`);
  console.log(`  Total Merges:   ${state.cumulativeStats.mergeCount}`);
  console.log(`  Total Merged:   ${state.cumulativeStats.totalMerged.toFixed(2)} tokens`);
  console.log(`  Rebalances:     ${state.cumulativeStats.rebalanceCount}`);
  console.log(`  Orders:         ${state.cumulativeStats.ordersPlaced} placed, ${state.cumulativeStats.ordersCancelled} cancelled`);
  console.log(SEPARATOR);
  console.log("");
}

// =============================================================================
// Position Handling (Liquidation)
// =============================================================================
async function promptIgnorePositions(): Promise<boolean> {
  console.log("");
  console.log("⚠️  WARNING: You are about to ignore existing positions!");
  console.log("");
  console.log("This means the orchestrator will start on a NEW market while you");
  console.log("still have open positions in the previous market. This will:");
  console.log("");
  console.log("  • Fragment your capital across multiple markets");
  console.log("  • Require manual intervention to close old positions");
  console.log("  • May result in losses if the old market moves against you");
  console.log("");
  console.log("This is generally NOT recommended unless you know what you're doing.");
  console.log("");

  const answer = await promptForInput(
    'Type "yes-ignore-positions" to confirm: '
  );

  return answer.toLowerCase().trim() === "yes-ignore-positions";
}

/**
 * Reconstructs liquidation markets from detected positions.
 * 
 * Loads persisted state for each position and creates LiquidationMarket objects
 * with position tracker and profit protection.
 * 
 * @param client - Authenticated CLOB client
 * @param positions - Detected positions marked as in liquidation
 * @param config - Orchestrator configuration
 * @returns Array of reconstructed liquidation markets
 */
async function reconstructLiquidationMarkets(
  client: ClobClient,
  positions: DetectedPosition[],
  config: OrchestratorConfig
): Promise<LiquidationMarket[]> {
  const liquidationMarkets: LiquidationMarket[] = [];

  for (const position of positions) {
    try {
      log(`[Orchestrator] Reconstructing liquidation for ${position.conditionId.substring(0, 18)}...`);

      // Load persisted state with fills
      const state = await loadMarketState(position.conditionId);
      
      if (!state || !state.fills) {
        log(`[Orchestrator] Warning: No persisted state for ${position.conditionId.substring(0, 18)}..., skipping`);
        continue;
      }

      // Create position tracker and initialize with current on-chain balances
      const tracker = createPositionTracker(
        position.conditionId,
        position.yesTokenId,
        position.noTokenId,
        config.positionLimits.maxNetExposure
      );

      // CRITICAL: Initialize tracker with current balances FIRST
      tracker.initialize(position.yesBalance, position.noBalance);
      
      log(`[Orchestrator]   Initialized tracker: YES=${position.yesBalance.toFixed(2)}, NO=${position.noBalance.toFixed(2)}`);

      // Load fills into tracker (for economics/P&L tracking)
      for (const fill of state.fills) {
        tracker.processFill(fill);
      }

      // Load initial cost basis if present
      if (state.initialCostBasis) {
        const { yesAvgCost, noAvgCost } = state.initialCostBasis;
        if (yesAvgCost !== null && noAvgCost !== null) {
          tracker.setInitialCostBasis(yesAvgCost, noAvgCost);
        }
      }

      // Calculate profit-protection ceiling
      const netExposure = tracker.getNetExposure();
      const maxBuyPrice = calculateMaxBuyPrice(tracker, netExposure);

      log(`[Orchestrator]   Net exposure: ${netExposure.toFixed(2)} (${netExposure > 0 ? 'long YES' : 'long NO'})`);
      if (maxBuyPrice !== null) {
        log(`[Orchestrator]   Break-even ceiling: $${maxBuyPrice.toFixed(4)}`);
      }

      // Convert stage string to enum
      let stage: LiquidationStage = LiquidationStage.PASSIVE;
      if (position.liquidationInfo?.stage) {
        const stageStr = position.liquidationInfo.stage.toLowerCase();
        if (stageStr === "passive") stage = LiquidationStage.PASSIVE;
        else if (stageStr === "skewed") stage = LiquidationStage.SKEWED;
        else if (stageStr === "aggressive") stage = LiquidationStage.AGGRESSIVE;
        else if (stageStr === "market") stage = LiquidationStage.MARKET;
      }

      // Create minimal market config for liquidation
      // We need to discover this market to get proper config
      const result = await discoverMarkets({
        maxMinSize: config.orderSize,
      });

      const matchingMarket = result.markets.find((m) => m.conditionId === position.conditionId);

      if (!matchingMarket) {
        log(`[Orchestrator]   Warning: Market not found in discovery, creating minimal config`);
        
        // Create minimal config without rewards info
        const minimalMarket: RankedMarketByEarnings = {
          id: position.conditionId,
          conditionId: position.conditionId,
          question: position.marketQuestion ?? `Market ${position.conditionId.substring(0, 8)}`,
          clobTokenIds: `["${position.yesTokenId}","${position.noTokenId}"]`,
          eventSlug: "liquidation",
          eventTitle: "Liquidation Market",
          slug: "liquidation-market",
          active: true,
          closed: false,
          acceptingOrders: true,
          enableOrderBook: true,
          negRisk: false, // Default to false if unknown
          liquidityNum: 0,
          volume24hr: 0,
          rewardsMinSize: config.orderSize,
          rewardsMaxSpread: 0.035, // Default 3.5 cents
          rewardsDaily: 0,
          competitive: 0,
          earningPotential: {
            estimatedDailyEarnings: 0,
            earningEfficiency: 0,
            easeOfParticipation: 0,
            totalScore: 0,
            compatible: true,
          },
        };

        const mmConfig = createConfigForMarket(minimalMarket, config, {
          phase: "startup",
          currentMarket: null,
          currentConfig: null,
          pendingSwitch: null,
          liquidationMarkets: [],
          switchCount: 0,
          marketsVisited: [],
          startTime: new Date(),
          running: true,
          lastError: null,
          cumulativeStats: {
            startTime: Date.now(),
            fillCount: 0,
            totalVolume: 0,
            mergeCount: 0,
            totalMerged: 0,
            rebalanceCount: 0,
            ordersPlaced: 0,
            ordersCancelled: 0,
          },
        });

        liquidationMarkets.push({
          market: minimalMarket,
          config: mmConfig,
          tracker,
          startedAt: position.liquidationInfo?.startedAt ?? new Date(),
          stage,
          activeOrderId: null,
          lastMidpoint: null,
          maxBuyPrice,
        });
      } else {
        // Use discovered market config
        const mmConfig = createConfigForMarket(matchingMarket, config, {
          phase: "startup",
          currentMarket: null,
          currentConfig: null,
          pendingSwitch: null,
          liquidationMarkets: [],
          switchCount: 0,
          marketsVisited: [],
          startTime: new Date(),
          running: true,
          lastError: null,
          cumulativeStats: {
            startTime: Date.now(),
            fillCount: 0,
            totalVolume: 0,
            mergeCount: 0,
            totalMerged: 0,
            rebalanceCount: 0,
            ordersPlaced: 0,
            ordersCancelled: 0,
          },
        });

        liquidationMarkets.push({
          market: matchingMarket,
          config: mmConfig,
          tracker,
          startedAt: position.liquidationInfo?.startedAt ?? new Date(),
          stage,
          activeOrderId: null,
          lastMidpoint: null,
          maxBuyPrice,
        });
      }

      log(`[Orchestrator]   ✓ Liquidation reconstructed`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`[Orchestrator]   Error reconstructing ${position.conditionId.substring(0, 18)}...: ${msg}`);
    }
  }

  return liquidationMarkets;
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Creates a market maker config for a discovered market.
 *
 * @param market - The market to create config for
 * @param orchestratorConfig - Orchestrator configuration
 * @param state - Orchestrator state (for pending switch callback)
 */
function createConfigForMarket(
  market: RankedMarketByEarnings,
  orchestratorConfig: OrchestratorConfig,
  state: OrchestratorState
): OrchestratableMarketMakerConfig {
  // Generate market params from discovered market
  const marketParams = generateMarketConfig(market);

  // Create base market maker config
  const baseConfig = createMarketMakerConfig(marketParams, {
    orderSize: orchestratorConfig.orderSize,
    spreadPercent: orchestratorConfig.spreadPercent,
    positionLimits: orchestratorConfig.positionLimits,
    webSocket: orchestratorConfig.webSocket,
    merge: orchestratorConfig.merge,
    dryRun: orchestratorConfig.dryRun,
  });

  // Add orchestrator options
  return {
    ...baseConfig,
    // Notify orchestrator when neutral position is detected (for logging)
    onNeutralPosition: (position) => {
      log(
        `[Orchestrator] Neutral position detected: ` +
          `YES=${position.yesTokens.toFixed(2)}, ` +
          `NO=${position.noTokens.toFixed(2)}, ` +
          `neutral=${position.neutralPosition.toFixed(2)}`
      );
    },
    // Check if orchestrator wants to switch and we're neutral
    // Returns true if market maker should stop
    onCheckPendingSwitch: (position) => {
      // Only stop if: (1) there's a pending switch AND (2) position is neutral
      if (!state.pendingSwitch) return false;
      if (!orchestratorConfig.enableSwitching) return false;
      
      const isNeutral = position.netExposure === 0;
      return isNeutral;
    },
  };
}

/**
 * Runs one cycle of the orchestrator:
 * 1. Run market maker until neutral (with pending switch)
 * 2. Execute the pending switch
 */
async function runOrchestratorCycle(
  client: ClobClient,
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<MarketMakerResult> {
  if (!state.currentMarket || !state.currentConfig) {
    throw new Error("No market selected");
  }

  // Run market maker
  setPhase(state, "market_making");
  log(`\n[Orchestrator] Starting market maker for: ${state.currentMarket.question}\n`);

  const result = await runWithWebSocket({
    config: state.currentConfig,
    client,
  });

  // Accumulate stats
  if (result.stats) {
    accumulateStats(state, result.stats);
  }

  return result;
}

/**
 * Periodic re-evaluation function.
 * Checks if a better market exists and sets pendingSwitch if so.
 *
 * Uses actual earnings from placed orders when available, otherwise
 * falls back to estimated earnings.
 */
async function reEvaluateMarkets(
  client: ClobClient,
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<void> {
  if (!state.currentMarket || !state.currentConfig || !state.running) return;

  log(`\n[Orchestrator] Periodic re-evaluation...`);

  try {
    // =========================================================================
    // 1. Calculate ACTUAL earnings from current placed orders
    // =========================================================================
    const currentMarket = state.currentMarket;
    const marketParams = state.currentConfig.market;

    // Get current midpoint for the market
    const midpoint = await getMidpoint(client, marketParams.yesTokenId);

    let currentEarnings: number;
    let currentIsActual: boolean;

    // Check if we have rewardsDaily to calculate actual earnings
    if (marketParams.rewardsDaily !== undefined && marketParams.rewardsDaily > 0) {
      const actualResult = await calculateActualEarnings(client, {
        conditionId: marketParams.conditionId,
        tokenId: marketParams.yesTokenId,
        midpoint,
        maxSpreadCents: marketParams.maxSpread,
        minSize: marketParams.minOrderSize,
        ratePerDay: marketParams.rewardsDaily,
      });

      if (actualResult.hasOrders) {
        // Use actual earnings from placed orders
        currentEarnings = actualResult.actualDailyEarnings;
        currentIsActual = true;
        log(
          `[Orchestrator] Actual earnings: $${currentEarnings.toFixed(4)}/day ` +
            `(${actualResult.earningPct.toFixed(1)}% of $${actualResult.ratePerDay}/day pool, ` +
            `${actualResult.orderCount} orders, Q=${actualResult.ourQScore.toFixed(2)})`
        );
      } else {
        // No orders placed yet, use estimated
        currentEarnings = currentMarket.earningPotential.estimatedDailyEarnings;
        currentIsActual = false;
        log(`[Orchestrator] No orders in market, using estimated: $${currentEarnings.toFixed(4)}/day`);
      }
    } else {
      // No rewardsDaily data, use estimated
      currentEarnings = currentMarket.earningPotential.estimatedDailyEarnings;
      currentIsActual = false;
      log(`[Orchestrator] No rewards data, using estimated: $${currentEarnings.toFixed(4)}/day`);
    }

    // =========================================================================
    // 2. Find the best candidate market
    // =========================================================================
    const bestMarket = await findBestMarket(config.liquidity, {
      maxMinSize: config.orderSize, // Filter out markets where minSize > our orderSize
      volatilityThresholds: config.volatilityFilter, // Filter volatile markets
      excludeNegRisk: config.excludeNegRisk, // Filter NegRisk markets if requested
      onFetchProgress: (fetched, total, filtered) => {
        printDiscoveryProgress("Fetch", `${fetched}/${total} markets, ${filtered} passed filters`);
      },
      onCompetitionProgress: (fetched, total) => {
        printDiscoveryProgress("Competition", `${fetched}/${total} orderbooks`);
      },
      onVolatilityProgress: (checked, total, filtered) => {
        printDiscoveryProgress("Volatility", `${checked}/${total} checked, ${filtered} filtered`);
      },
    });

    if (!bestMarket) {
      log("[Orchestrator] No eligible markets found during re-evaluation");
      // Clear any pending switch since we can't find a good market
      if (state.pendingSwitch) {
        state.pendingSwitch = null;
        if (config.onEvent) {
          config.onEvent({ type: "pending_switch_cleared", reason: "No eligible markets" });
        }
      }
      return;
    }

    // =========================================================================
    // 3. Compare actual current vs estimated candidate
    // =========================================================================
    const decision = shouldSwitch(
      {
        currentEarnings,
        currentIsActual,
        candidateEarnings: bestMarket.earningPotential.estimatedDailyEarnings,
        candidateConditionId: bestMarket.conditionId,
        currentConditionId: currentMarket.conditionId,
      },
      config.minEarningsImprovement
    );

    // Emit event for monitoring
    if (config.onEvent) {
      config.onEvent({ type: "switch_decision", decision });
    }

    if (decision.shouldSwitch) {
      // Set pending switch
      const pendingSwitch: PendingSwitch = {
        targetMarket: bestMarket,
        detectedAt: new Date(),
        decision,
      };
      state.pendingSwitch = pendingSwitch;

      log(`[Orchestrator] Found better market: ${bestMarket.question}`);
      log(`[Orchestrator] Pending switch set - will execute when position is neutral`);
      printSwitchDecision(decision, config.enableSwitching);

      if (config.onEvent) {
        config.onEvent({ type: "pending_switch_set", pendingSwitch });
      }
    } else {
      // Clear any pending switch if conditions changed
      if (state.pendingSwitch) {
        log(`[Orchestrator] Conditions changed - clearing pending switch`);
        state.pendingSwitch = null;
        if (config.onEvent) {
          config.onEvent({ type: "pending_switch_cleared", reason: decision.reason });
        }
      } else {
        log(`[Orchestrator] Current market is still optimal`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`[Orchestrator] Re-evaluation error: ${msg}`);
    if (config.onEvent) {
      config.onEvent({ type: "error", error: msg, phase: "evaluating" });
    }
  }
}

/**
 * Main orchestrator loop.
 *
 * New flow:
 * 1. Find initial market, start market maker
 * 2. Start periodic timer that evaluates markets and sets pendingSwitch
 * 3. Market maker runs continuously, exits when pendingSwitch exists AND neutral
 * 4. Execute the pending switch and restart market maker
 */
export async function runOrchestrator(config: OrchestratorConfig): Promise<void> {
  // Validate config
  validateOrchestratorConfig(config);

  // Print banner
  printOrchestratorBanner(config);

  // Initialize state
  const state = createInitialState();

  // Re-evaluation timer handle
  let reEvalTimer: NodeJS.Timeout | null = null;
  
  // Liquidation management timer handle
  let liqTimer: NodeJS.Timeout | null = null;
  
  // Client handle (for cleanup in finally block)
  let client: ClobClient | null = null;

  try {
    // Initialize client
    log("[Orchestrator] Initializing client...");
    client = await createAuthenticatedClobClient();
    log("[Orchestrator] Client initialized");

    // Check USDC balance
    const balance = await getUsdcBalance(client);
    log(`[Orchestrator] USDC balance: $${balance.balanceNumber.toFixed(2)}`);

    const minRequired = config.orderSize * 2;
    if (balance.balanceNumber < minRequired) {
      throw new Error(
        `Insufficient USDC: have $${balance.balanceNumber.toFixed(2)}, need at least $${minRequired.toFixed(2)}`
      );
    }

    // =========================================================================
    // POSITION DETECTION: Check for existing positions
    // =========================================================================
    log(`\n[Orchestrator] Checking for existing positions...`);

    const detectedPositions = await detectExistingPositions(client);

    // Check-only mode: report positions and exit
    if (config.checkPositionsOnly) {
      if (detectedPositions.length === 0) {
        log("[Orchestrator] No existing positions detected");
      } else {
        printPositionsSummary(detectedPositions);
      }
      log("[Orchestrator] Check complete (--check-positions-only mode)");
      return;
    }

    // Separate liquidation vs non-liquidation positions
    const liquidationPositions = detectedPositions.filter((p) => p.inLiquidation);
    const activePositions = detectedPositions.filter((p) => !p.inLiquidation);

    // =========================================================================
    // RESTORE LIQUIDATIONS: Auto-load markets already in liquidation mode
    // =========================================================================
    if (liquidationPositions.length > 0) {
      log(`\n[Orchestrator] Restoring ${liquidationPositions.length} liquidation(s) from previous session...`);
      
      const restored = await reconstructLiquidationMarkets(client, liquidationPositions, config);
      state.liquidationMarkets.push(...restored);
      
      log(`[Orchestrator] ✓ ${restored.length} liquidation(s) restored`);
      
      // Save liquidation state
      saveLiquidationsState(state);
    }

    // =========================================================================
    // HANDLE ACTIVE POSITIONS: Liquidate or exit
    // =========================================================================
    if (activePositions.length > 0) {
      log(`\n[Orchestrator] Found ${activePositions.length} non-liquidation position(s)`);
      
      if (config.ignorePositions) {
        // User wants to ignore positions (dangerous)
        log("[Orchestrator] ⚠️  --ignore-positions flag set");
        const confirmed = await promptIgnorePositions();
        
        if (!confirmed) {
          log("[Orchestrator] Position ignore cancelled - will liquidate instead");
          // Add to liquidation queue
          const newLiquidations = await reconstructLiquidationMarkets(client, activePositions, config);
          state.liquidationMarkets.push(...newLiquidations);
          saveLiquidationsState(state);
        } else {
          log("[Orchestrator] ⚠️  User confirmed ignoring positions");
          log("[Orchestrator] WARNING: Capital will be fragmented across markets!");
        }
      } else if (config.autoResume) {
        // Auto-liquidate mode (safe default for 24/7 operation)
        log(`[Orchestrator] Auto-liquidating ${activePositions.length} position(s) (--auto-resume enabled)`);
        
        const newLiquidations = await reconstructLiquidationMarkets(client, activePositions, config);
        state.liquidationMarkets.push(...newLiquidations);
        saveLiquidationsState(state);
        
        log(`[Orchestrator] ✓ ${newLiquidations.length} position(s) queued for liquidation`);
      } else {
        // Supervised mode - prompt user
        const action = await promptPositionAction(activePositions);
        
        if (action === "liquidate") {
          log(`[Orchestrator] User chose to liquidate all positions`);
          
          const newLiquidations = await reconstructLiquidationMarkets(client, activePositions, config);
          state.liquidationMarkets.push(...newLiquidations);
          saveLiquidationsState(state);
          
          log(`[Orchestrator] ✓ ${newLiquidations.length} position(s) queued for liquidation`);
        } else {
          // User chose to exit
          log("[Orchestrator] User chose to exit - stopping orchestrator");
          return;
        }
      }
    } else if (liquidationPositions.length === 0) {
      log("[Orchestrator] No existing positions detected");
    }

    // =========================================================================
    // STARTUP: Find best active market for trading
    // =========================================================================
    setPhase(state, "startup");
    log(`\n[Orchestrator] Finding best market for active trading...`);

    // Exclude markets currently in liquidation from discovery
    const excludeConditionIds = state.liquidationMarkets.map((lm) => lm.market.conditionId);

    const initialMarket = await findBestMarket(config.liquidity, {
      maxMinSize: config.orderSize,
      volatilityThresholds: config.volatilityFilter,
      excludeNegRisk: config.excludeNegRisk,
      excludeConditionIds,
      onFetchProgress: (fetched, total, filtered) => {
        printDiscoveryProgress("Fetch", `${fetched}/${total} markets, ${filtered} passed filters`);
      },
      onCompetitionProgress: (fetched, total) => {
        printDiscoveryProgress("Competition", `${fetched}/${total} orderbooks`);
      },
      onVolatilityProgress: (checked, total, filtered) => {
        printDiscoveryProgress("Volatility", `${checked}/${total} checked, ${filtered} filtered`);
      },
    });

    if (!initialMarket) {
      throw new Error("No eligible markets found during startup");
    }

    const initialConfig = createConfigForMarket(initialMarket, config, state);
    printSelectedMarket(initialMarket);

    // Set initial market and config
    state.currentMarket = initialMarket;
    state.currentConfig = initialConfig;
    state.marketsVisited.push(initialMarket.conditionId);

    if (config.onEvent) {
      config.onEvent({ type: "started", market: initialMarket });
    }

    // Validate the market maker config
    validateConfig(state.currentConfig);

    // =========================================================================
    // Start periodic re-evaluation timer
    // =========================================================================
    if (config.enableSwitching) {
      const intervalMinutes = config.reEvaluateIntervalMs / 60000;
      log(`[Orchestrator] Starting re-evaluation timer (every ${intervalMinutes.toFixed(1)} min)`);
      
      reEvalTimer = setInterval(() => {
        // Don't re-evaluate during startup or shutdown
        if (state.phase === "market_making" && state.running && client) {
          reEvaluateMarkets(client, state, config).catch((err) => {
            log(`[Orchestrator] Re-evaluation error: ${err}`);
          });
        }
      }, config.reEvaluateIntervalMs);
    } else {
      log(`[Orchestrator] Switching disabled - no re-evaluation timer`);
    }

    // =========================================================================
    // Start periodic liquidation management timer (every 30 seconds)
    // =========================================================================
    if (config.enableSwitching) {
      log(`[Orchestrator] Starting liquidation management timer (every 30s)`);
      
      liqTimer = setInterval(() => {
        if (state.phase === "market_making" && state.running && client) {
          manageLiquidations(client, state, config).catch((err) => {
            log(`[Orchestrator] Liquidation management error: ${err}`);
          });
        }
      }, 30_000);
    }

    // =========================================================================
    // Main loop
    // =========================================================================
    while (state.running) {
      try {
        // ===================================================================
        // RUN MARKET MAKER
        // ===================================================================
        if (!state.running) break;

        const result = await runOrchestratorCycle(client, state, config);

        log(`\n[Orchestrator] Market maker exited: ${result.reason}`);

        // Handle exit reason
        switch (result.reason) {
          case "neutral":
            // Neutral triggered by pending switch - execute the switch
            if (state.pendingSwitch && config.enableSwitching) {
              const pendingSwitch = state.pendingSwitch;
              const targetMarket = pendingSwitch.targetMarket;
              
              log(`[Orchestrator] Executing pending switch to: ${targetMarket.question}`);
              
              // CRITICAL: Cancel all orders from the old market before switching
              if (state.currentMarket && !config.dryRun) {
                try {
                  log(`[Orchestrator] Cancelling orders on old market...`);
                  await Promise.all([
                    cancelOrdersForToken(client, state.currentConfig!.market.yesTokenId),
                    cancelOrdersForToken(client, state.currentConfig!.market.noTokenId),
                  ]);
                  log(`[Orchestrator] Old market orders cancelled (YES + NO)`);
                } catch (error) {
                  log(`[Orchestrator] Warning: Failed to cancel old orders: ${error}`);
                  // Continue anyway - better to switch than to get stuck
                }
              } else if (config.dryRun) {
                log(`[Orchestrator] [DRY RUN] Would cancel orders on old market`);
              }
              
              if (config.onEvent && state.currentMarket) {
                config.onEvent({
                  type: "switching",
                  from: state.currentMarket,
                  to: targetMarket,
                });
              }

              // Update state
              state.currentMarket = targetMarket;
              state.currentConfig = createConfigForMarket(targetMarket, config, state);
              state.switchCount++;
              if (!state.marketsVisited.includes(targetMarket.conditionId)) {
                state.marketsVisited.push(targetMarket.conditionId);
              }
              state.pendingSwitch = null;

              // Validate new config
              validateConfig(state.currentConfig);
            } else {
              // Neutral without pending switch - this shouldn't happen with new logic
              // but handle gracefully by continuing
              log("[Orchestrator] Neutral position reached without pending switch - continuing");
              if (config.onEvent && state.currentMarket) {
                config.onEvent({
                  type: "neutral_detected",
                  market: state.currentMarket,
                });
              }
            }
            break;

          case "position_limit":
            log(`[Orchestrator] Position limit hit on: ${state.currentMarket!.question}`);
            
            // Calculate max buy price (break-even ceiling) for liquidation
            const tracker = result.positionTracker!;
            const netExposure = tracker.getNetExposure();
            const maxBuyPrice = calculateMaxBuyPrice(tracker, netExposure);
            
            if (maxBuyPrice !== null) {
              log(`[Orchestrator] Liquidation ceiling: max buy price = $${maxBuyPrice.toFixed(4)}`);
            }
            
            // Move current market to liquidation mode
            const liqMarket: LiquidationMarket = {
              market: state.currentMarket!,
              config: state.currentConfig!,
              tracker: result.positionTracker!, 
              startedAt: new Date(),
              stage: LiquidationStage.PASSIVE,
              activeOrderId: null,
              lastMidpoint: null,
              maxBuyPrice,
            };
            
            state.liquidationMarkets.push(liqMarket);
            log(`[Orchestrator] Added to liquidation queue (${state.liquidationMarkets.length} total)`);
            
            // Save liquidation state to disk
            saveLiquidationsState(state);
            
            // Find new best market (exclude markets in liquidation)
            const excludeConditionIds = state.liquidationMarkets.map(lm => lm.market.conditionId);
            const newMarket = await findBestMarket(config.liquidity, {
              maxMinSize: config.orderSize,
              volatilityThresholds: config.volatilityFilter,
              excludeNegRisk: config.excludeNegRisk,
              excludeConditionIds,
              onFetchProgress: (fetched, total, filtered) => {
                printDiscoveryProgress("Fetch", `${fetched}/${total} markets, ${filtered} passed filters`);
              },
              onCompetitionProgress: (fetched, total) => {
                printDiscoveryProgress("Competition", `${fetched}/${total} orderbooks`);
              },
              onVolatilityProgress: (checked, total, filtered) => {
                printDiscoveryProgress("Volatility", `${checked}/${total} checked, ${filtered} filtered`);
              },
            });
            
            if (!newMarket) {
              log(`[Orchestrator] No new markets available`);
              state.running = false;
              break;
            }
            
            // Switch to new active market
            state.currentMarket = newMarket;
            state.currentConfig = createConfigForMarket(newMarket, config, state);
            state.switchCount++;
            if (!state.marketsVisited.includes(newMarket.conditionId)) {
              state.marketsVisited.push(newMarket.conditionId);
            }
            
            // Validate new config
            validateConfig(state.currentConfig);
            
            log(`[Orchestrator] Starting new active market: ${newMarket.question}`);
            printSelectedMarket(newMarket);
            break;

          case "shutdown":
            // Exit loop
            state.running = false;
            break;

          case "error":
            log(`[Orchestrator] Error: ${result.error?.message}`);
            state.lastError = result.error?.message ?? "Unknown error";
            // Wait before retry
            await new Promise((r) => setTimeout(r, 10_000));
            break;

          case "timeout":
            log("[Orchestrator] Timeout, restarting market maker");
            break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`[Orchestrator] Cycle error: ${msg}`);
        state.lastError = msg;

        if (config.onEvent) {
          config.onEvent({ type: "error", error: msg, phase: state.phase });
        }

        // Wait before retry
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  } finally {
    // Clear re-evaluation timer
    if (reEvalTimer) {
      clearInterval(reEvalTimer);
      reEvalTimer = null;
    }

    // Clear liquidation timer
    if (liqTimer) {
      clearInterval(liqTimer);
      liqTimer = null;
    }

    // Cancel all active orders on shutdown
    if (client) {
      log("\n[Orchestrator] Shutting down, cancelling active orders...");
      
      // Cancel active market maker orders
      if (state.currentConfig) {
        const { yesTokenId, noTokenId } = state.currentConfig.market;
        try {
          await cancelOrdersForToken(client, yesTokenId);
          await cancelOrdersForToken(client, noTokenId);
          log(`[Orchestrator] Cancelled active market maker orders`);
        } catch (error) {
          log(`[Orchestrator] Warning: Failed to cancel market maker orders: ${error}`);
        }
      }
      
      // Cancel liquidation orders
      let liqOrdersCancelled = 0;
      for (const liqMarket of state.liquidationMarkets) {
        if (liqMarket.activeOrderId) {
          try {
            await cancelOrder(client, liqMarket.activeOrderId);
            liqOrdersCancelled++;
          } catch (error) {
            log(`[Orchestrator] Warning: Failed to cancel liquidation order ${liqMarket.activeOrderId}: ${error}`);
          }
        }
      }
      if (liqOrdersCancelled > 0) {
        log(`[Orchestrator] Cancelled ${liqOrdersCancelled} liquidation orders`);
      }
      
      // Note: We keep liquidation state in ./data/liquidations.json
      // On restart, positions will be detected and can resume properly
      log(`[Orchestrator] Liquidation state saved to disk (${state.liquidationMarkets.length} markets)`);
    }

    // Print summary
    setPhase(state, "shutdown");
    printSessionSummary(state);

    // Emit shutdown event
    if (config.onEvent) {
      const summary: OrchestratorSessionSummary = {
        totalRuntime: Date.now() - state.startTime.getTime(),
        switchCount: state.switchCount,
        marketsVisited: state.marketsVisited,
        totalFills: state.cumulativeStats.fillCount,
        totalVolume: state.cumulativeStats.totalVolume,
        totalMerges: state.cumulativeStats.mergeCount,
        totalMerged: state.cumulativeStats.totalMerged,
      };
      config.onEvent({ type: "shutdown", summary });
    }
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

/**
 * CLI entry point for orchestrator.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Market Maker Orchestrator

Automatically finds and switches between the best markets to maximize rewards.

Usage:
  npm run orchestrate [options]

Options:
  --liquidity <n>              Liquidity amount in USD (default: 100)
  --threshold <n>              Min improvement to switch (default: 0.2 = 20%)
  --re-evaluate-interval <n>   Minutes between market re-evaluation (default: 5)
  --order-size <n>             Order size in shares (default: 20)
  --spread <n>                 Spread percent 0-1 (default: 0.5)
  
  Volatility Filtering (default: enabled):
  --max-volatility <n>         Max price change threshold (default: 0.10 = 10%)
  --volatility-lookback <n>    Lookback window in minutes (default: 60)
  --no-volatility-filter       Disable volatility filtering entirely
  
  Position Handling (restart protection):
  --auto-resume                Auto-liquidate positions without prompting (24/7 mode)
  --ignore-positions           Force new market discovery (DANGEROUS, prompts for confirmation)
  --check-positions-only       Only check and report positions, don't start
  
  --enable-switching           Enable automatic market switching
  --no-dry-run                 Place real orders (careful!)
  --dry-run                    Simulate orders (default)
  --help, -h                   Show this help

How it works:
  1. On startup, checks for existing positions to prevent capital fragmentation
  2. Positions in liquidations.json: automatically restored to liquidation queue
  3. New positions found: prompts to liquidate (or auto-liquidates with --auto-resume)
  4. Liquidation runs passively in background (profit-protected exit orders)
  5. Finds best market for active trading (excluding liquidation markets)
  6. Every N minutes, re-evaluates and switches to better markets when neutral
  7. When position limits hit, moves market to liquidation + starts new market

Examples:
  npm run orchestrate                          # Dry run, log switching decisions
  npm run orchestrate -- --liquidity 200       # Higher liquidity
  npm run orchestrate -- --re-evaluate-interval 10  # Check every 10 min
  npm run orchestrate -- --max-volatility 0.15 # Allow 15% price changes
  npm run orchestrate -- --no-volatility-filter  # Disable volatility filter
  npm run orchestrate -- --check-positions-only  # Just check for positions
  npm run orchestrate -- --auto-resume         # Auto-resume mode (24/7)
  npm run orchestrate -- --enable-switching    # Enable switching (still dry run)
  npm run orchestrate -- --enable-switching --no-dry-run  # Full live mode
`);
    return;
  }

  // Parse args and create config
  const overrides = parseOrchestratorArgs(args);
  const config = createOrchestratorConfig(overrides);

  // Run orchestrator
  await runOrchestrator(config);
}

// Re-export types and config
export * from "./types.js";
export * from "./config.js";
