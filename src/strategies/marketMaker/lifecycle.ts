/**
 * Market Maker Lifecycle - Startup, shutdown, and validation functions.
 */

import { log, promptForNumber } from "@/utils/helpers.js";
import { cancelOrdersForToken } from "@/utils/orders.js";
import { getTokenBalance } from "@/utils/balance.js";
import { mergeNeutralPosition } from "@/utils/inventory.js";
import { PositionTracker } from "@/utils/positionTracker.js";
import type { SafeInstance } from "@/utils/ctf.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { JsonRpcProvider } from "@ethersproject/providers";
import type { MarketMakerConfig, MarketMakerState } from "./types.js";

/**
 * Validates the configuration before starting.
 */
export function validateConfig(config: MarketMakerConfig): void {
  if (
    config.market.yesTokenId === "YOUR_YES_TOKEN_ID_HERE" ||
    config.market.noTokenId === "YOUR_NO_TOKEN_ID_HERE" ||
    config.market.conditionId === "YOUR_CONDITION_ID_HERE"
  ) {
    throw new Error(
      "Please configure your market in src/strategies/marketMaker/config.ts\n" +
        "Run 'npm run selectMarket -- <event-slug>' to generate the configuration"
    );
  }

  if (config.orderSize < config.market.minOrderSize) {
    throw new Error(
      `Order size (${config.orderSize}) is below minimum (${config.market.minOrderSize})`
    );
  }

  if (config.spreadPercent <= 0 || config.spreadPercent > 1) {
    throw new Error("spreadPercent must be between 0 and 1");
  }
}

/**
 * Prints the startup banner.
 */
export function printBanner(config: MarketMakerConfig): void {
  console.log("\n" + "=".repeat(60));
  console.log("  MARKET MAKER BOT (USDC-Only Mode)");
  if (config.dryRun) {
    console.log("  *** DRY RUN MODE - No real orders will be placed ***");
  }
  console.log("=".repeat(60));
  console.log(`  YES Token: ${config.market.yesTokenId.substring(0, 20)}...`);
  console.log(`  NO Token: ${config.market.noTokenId.substring(0, 20)}...`);
  console.log(`  Order Size: ${config.orderSize} shares per side`);
  console.log(`  Spread: ${config.spreadPercent * 100}% of max (${config.market.maxSpread}c)`);
  console.log(`  Rebalance Threshold: ${config.rebalanceThreshold * 100} cents`);
  console.log(`  Tick Size: ${config.market.tickSize}`);
  console.log(`  Negative Risk: ${config.market.negRisk}`);
  console.log(`  Position Limit: ±${config.positionLimits.maxNetExposure} net exposure`);
  console.log("-".repeat(60));
  if (config.webSocket.enabled) {
    console.log(`  Mode: WebSocket (real-time)`);
    console.log(`  Debounce: ${config.webSocket.debounceMs}ms`);
    console.log(`  Fallback Polling: ${config.webSocket.fallbackPollingMs / 1000}s`);
  } else {
    console.log(`  Mode: Polling`);
    console.log(`  Refresh: every ${config.refreshIntervalMs / 1000}s`);
  }
  console.log("=".repeat(60));
  console.log("  Press Ctrl+C to stop\n");
}

/**
 * Creates empty session statistics.
 */
export function createEmptyStats(): import("./types.js").SessionStats {
  return {
    startTime: Date.now(),
    fillCount: 0,
    totalVolume: 0,
    mergeCount: 0,
    totalMerged: 0,
    rebalanceCount: 0,
    ordersPlaced: 0,
    ordersCancelled: 0,
  };
}

/**
 * Creates initial market maker state.
 */
export function createInitialState(): MarketMakerState {
  return {
    running: true,
    activeQuotes: { yesQuote: null, noQuote: null, lastMidpoint: 0 },
    cycleCount: 0,
    lastError: null,
    stats: createEmptyStats(),
  };
}

/**
 * Formats session duration as human-readable string.
 */
function formatDuration(startTime: number): string {
  const durationMs = Date.now() - startTime;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Prints the session statistics summary on shutdown.
 */
function printSessionSummary(state: MarketMakerState): void {
  const { stats } = state;
  const duration = formatDuration(stats.startTime);
  
  console.log("\n" + "=".repeat(60));
  console.log("  SESSION SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Duration: ${duration}`);
  console.log(`  Cycles: ${state.cycleCount}`);
  console.log("-".repeat(60));
  console.log("  TRADING:");
  console.log(`    Fills: ${stats.fillCount}`);
  console.log(`    Volume: $${stats.totalVolume.toFixed(2)}`);
  console.log(`    Orders Placed: ${stats.ordersPlaced}`);
  console.log(`    Orders Cancelled: ${stats.ordersCancelled}`);
  console.log("-".repeat(60));
  console.log("  MERGE OPERATIONS:");
  console.log(`    Merges: ${stats.mergeCount}`);
  console.log(`    USDC Freed: $${stats.totalMerged.toFixed(2)}`);
  console.log("=".repeat(60));
}

/**
 * Creates a shutdown handler that cancels orders and exits gracefully.
 */
export function createShutdownHandler(
  state: MarketMakerState,
  client: ClobClient,
  config: MarketMakerConfig,
  cleanup?: () => void
): () => Promise<void> {
  return async () => {
    log("\nShutting down...");
    state.running = false;

    // Run additional cleanup if provided
    if (cleanup) {
      cleanup();
    }

    try {
      if (!config.dryRun) {
        log("Cancelling all orders...");
        // Cancel orders on both YES and NO tokens
        await Promise.all([
          cancelOrdersForToken(client, config.market.yesTokenId),
          cancelOrdersForToken(client, config.market.noTokenId),
        ]);
        log("All orders cancelled (YES + NO)");
      } else {
        log("[DRY RUN] Would cancel all orders");
      }
    } catch (error) {
      log(`Error cancelling orders: ${error}`);
    }

    // Print session summary
    printSessionSummary(state);

    console.log("\nGoodbye!");
    process.exit(0);
  };
}

/**
 * Registers shutdown handlers for SIGINT and SIGTERM.
 */
export function registerShutdownHandlers(handler: () => Promise<void>): void {
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

/**
 * Creates and initializes a PositionTracker for position limit management.
 *
 * Fetches current token balances from the CLOB API and initializes
 * the tracker with the current position. On subsequent runs, it will
 * also reconcile with persisted fills.
 *
 * If the position has pre-existing tokens without cost basis, prompts
 * the user to provide average cost for P&L tracking.
 *
 * @param client - Authenticated CLOB client
 * @param config - Market maker configuration
 * @returns Initialized position tracker, or null if position limits disabled
 */
export async function createPositionTracker(
  client: ClobClient,
  config: MarketMakerConfig
): Promise<PositionTracker | null> {
  // Skip if position limits are not configured
  if (!config.positionLimits) {
    log("Position limits not configured, skipping position tracking");
    return null;
  }

  // Skip if maxNetExposure is 0 or Infinity (disabled)
  if (
    config.positionLimits.maxNetExposure === 0 ||
    !isFinite(config.positionLimits.maxNetExposure)
  ) {
    log("Position limits disabled (maxNetExposure = 0 or Infinity)");
    return null;
  }

  log("Initializing position tracker...");

  // Create tracker instance
  const tracker = new PositionTracker(
    config.market.conditionId,
    config.market.yesTokenId,
    config.market.noTokenId,
    config.positionLimits
  );

  // Fetch current balances from CLOB API
  const [yesInfo, noInfo] = await Promise.all([
    getTokenBalance(client, config.market.yesTokenId),
    getTokenBalance(client, config.market.noTokenId),
  ]);

  // Initialize tracker with current balances
  const result = tracker.initialize(yesInfo.balanceNumber, noInfo.balanceNumber);

  if (result.warning) {
    log(`Position reconciliation warning: ${result.warning}`);
  }

  // Check if we need cost basis for pre-existing position
  if (result.needsCostBasis && tracker.needsInitialCostBasis()) {
    await promptForInitialCostBasis(tracker, yesInfo.balanceNumber, noInfo.balanceNumber);
  }

  // Log position summary
  log("Position status:\n" + tracker.formatStatus());

  return tracker;
}

/**
 * Prompts the user to enter initial cost basis for pre-existing tokens.
 *
 * This is called when the bot starts with tokens that weren't acquired
 * through tracked fills.
 *
 * @param tracker - Position tracker to set cost basis on
 * @param yesBalance - Current YES token balance
 * @param noBalance - Current NO token balance
 */
async function promptForInitialCostBasis(
  tracker: PositionTracker,
  yesBalance: number,
  noBalance: number
): Promise<void> {
  console.log("\n" + "-".repeat(60));
  console.log("  INITIAL COST BASIS REQUIRED");
  console.log("-".repeat(60));
  console.log("  You have pre-existing tokens without cost basis information.");
  console.log("  For accurate P&L tracking, please provide the average cost");
  console.log("  you paid for these tokens (0-1, e.g., 0.52 for 52 cents).");
  console.log("  Enter 'skip' or press Enter to use N/A (P&L will be incomplete).");
  console.log("-".repeat(60) + "\n");

  let yesCost: number | null = null;
  let noCost: number | null = null;

  if (yesBalance > 0.001) {
    yesCost = await promptForNumber(
      `  YES tokens (${yesBalance.toFixed(2)}) - Enter average cost (0-1) or skip: `,
      0,
      1
    );
  }

  if (noBalance > 0.001) {
    noCost = await promptForNumber(
      `  NO tokens (${noBalance.toFixed(2)}) - Enter average cost (0-1) or skip: `,
      0,
      1
    );
  }

  // Set the cost basis (even if both null, this records user was prompted)
  tracker.setInitialCostBasis(yesCost, noCost);

  console.log("-".repeat(60) + "\n");
}

/**
 * Result of a merge check operation.
 */
export interface MergeCheckResult {
  /** Whether a merge was performed */
  merged: boolean;
  /** Amount that was merged (0 if no merge) */
  amount: number;
  /** Error message if merge failed */
  error?: string;
}

/**
 * Checks if neutral position should be merged and executes merge if needed.
 *
 * This function is called at the start of each rebalance cycle, before
 * placing orders. It checks if there's a neutral position (YES > 0 && NO > 0)
 * that exceeds the configured minimum merge amount, and if so, merges it
 * back to USDC.
 *
 * The merge operation:
 * 1. Converts equal amounts of YES + NO tokens back to USDC
 * 2. Updates the position tracker's economics (proportional cost reduction)
 * 3. Frees up locked capital for trading
 *
 * @param positionTracker - Position tracker instance (null if tracking disabled)
 * @param safe - Safe instance for CTF operations (null if merge disabled)
 * @param config - Market maker configuration
 * @returns Result with merged amount (0 if no merge needed or disabled)
 */
export async function checkAndMergeNeutralPosition(
  positionTracker: PositionTracker | null,
  safe: SafeInstance | null,
  config: MarketMakerConfig
): Promise<MergeCheckResult> {
  // Skip if position tracking is disabled
  if (!positionTracker) {
    return { merged: false, amount: 0 };
  }

  // Skip if merge is disabled
  if (!config.merge.enabled) {
    return { merged: false, amount: 0 };
  }

  // Get current position state
  const positionState = positionTracker.getPositionState();
  const neutralPosition = positionState.neutralPosition;

  // Skip if neutral position is below threshold
  if (neutralPosition <= config.merge.minMergeAmount) {
    return { merged: false, amount: 0 };
  }

  // Calculate amount to merge (floor to avoid dust)
  // Merge the full neutral position to maximize USDC freed
  const mergeAmount = Math.floor(neutralPosition * 100) / 100; // Round to 2 decimals

  if (mergeAmount <= 0) {
    return { merged: false, amount: 0 };
  }

  log(`Neutral position detected: ${neutralPosition.toFixed(2)} tokens (YES=${positionState.yesTokens.toFixed(2)}, NO=${positionState.noTokens.toFixed(2)})`);
  log(`Merging ${mergeAmount.toFixed(2)} tokens back to USDC...`);

  // Check if we have a Safe instance
  if (!safe) {
    // Dry run mode - no Safe available
    log(`[DRY RUN] Would merge ${mergeAmount.toFixed(2)} tokens back to USDC`);
    
    // Still update position tracker to simulate the merge
    positionTracker.processMerge(mergeAmount);
    
    return { merged: true, amount: mergeAmount };
  }

  // Execute the merge
  const result = await mergeNeutralPosition(
    safe,
    config.market.conditionId,
    mergeAmount,
    config.dryRun
  );

  if (!result.success) {
    log(`Merge failed: ${result.error}`);
    return { merged: false, amount: 0, error: result.error };
  }

  // Update position tracker with the merge
  positionTracker.processMerge(mergeAmount);

  return { merged: true, amount: mergeAmount };
}

