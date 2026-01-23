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
import { log, formatDuration } from "@/utils/helpers.js";
import { getUsdcBalance } from "@/utils/balance.js";
import { findBestMarket, discoverMarkets, type RankedMarketByEarnings } from "@/utils/marketDiscovery.js";
import { generateMarketConfig, formatMarketConfig } from "@/utils/marketConfigGenerator.js";
import { calculateActualEarnings } from "@/utils/rewards.js";
import { getMidpoint } from "@/utils/orders.js";
import { createMarketMakerConfig } from "../marketMaker/config.js";
import { validateConfig, printBanner } from "../marketMaker/lifecycle.js";
import { runWithWebSocket } from "../marketMaker/modes/index.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerResult, OrchestratableMarketMakerConfig, SessionStats } from "../marketMaker/types.js";
import type {
  OrchestratorState,
  OrchestratorPhase,
  SwitchDecision,
  OrchestratorSessionSummary,
  OrchestratorEvent,
  PendingSwitch,
} from "./types.js";
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

  console.log("");
  console.log(SEPARATOR);
  console.log("  SESSION SUMMARY");
  console.log(SEPARATOR);
  console.log(`  Runtime:        ${formatDuration(runtime)}`);
  console.log(`  Markets:        ${state.marketsVisited.length} visited`);
  console.log(`  Switches:       ${state.switchCount}`);
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

  // Setup shutdown handling
  let shutdownRequested = false;
  const handleShutdown = () => {
    if (shutdownRequested) {
      log("\nForce shutdown...");
      process.exit(1);
    }
    shutdownRequested = true;
    state.running = false;
    log("\n[Orchestrator] Shutdown requested, finishing current cycle...");
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  try {
    // Initialize client
    log("[Orchestrator] Initializing client...");
    const client = await createAuthenticatedClobClient();
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
    // STARTUP: Find initial market
    // =========================================================================
    setPhase(state, "startup");
    log(`\n[Orchestrator] Finding best market...`);

    const initialMarket = await findBestMarket(config.liquidity, {
      maxMinSize: config.orderSize, // Filter out markets where minSize > our orderSize
      volatilityThresholds: config.volatilityFilter, // Filter volatile markets
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

    // Set initial market
    printSelectedMarket(initialMarket);
    state.currentMarket = initialMarket;
    state.currentConfig = createConfigForMarket(initialMarket, config, state);
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
        if (state.phase === "market_making" && state.running) {
          reEvaluateMarkets(client, state, config).catch((err) => {
            log(`[Orchestrator] Re-evaluation error: ${err}`);
          });
        }
      }, config.reEvaluateIntervalMs);
    } else {
      log(`[Orchestrator] Switching disabled - no re-evaluation timer`);
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

    // Cleanup
    process.off("SIGINT", handleShutdown);
    process.off("SIGTERM", handleShutdown);
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
  
  --enable-switching           Enable automatic market switching
  --no-dry-run                 Place real orders (careful!)
  --dry-run                    Simulate orders (default)
  --help, -h                   Show this help

How it works:
  1. Finds the best market based on earning potential
  2. Runs market maker continuously
  3. Every N minutes, checks if a better market exists
  4. If better market found, sets "pending switch"
  5. When position becomes neutral AND pending switch exists, switches markets

Examples:
  npm run orchestrate                          # Dry run, log switching decisions
  npm run orchestrate -- --liquidity 200       # Higher liquidity
  npm run orchestrate -- --re-evaluate-interval 10  # Check every 10 min
  npm run orchestrate -- --max-volatility 0.15 # Allow 15% price changes
  npm run orchestrate -- --no-volatility-filter  # Disable volatility filter
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
