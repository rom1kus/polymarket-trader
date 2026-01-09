/**
 * Market Maker Lifecycle - Startup, shutdown, and validation functions.
 */

import { log } from "@/utils/helpers.js";
import { cancelOrdersForToken } from "@/utils/orders.js";
import { getTokenBalance } from "@/utils/balance.js";
import { PositionTracker } from "@/utils/positionTracker.js";
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
  console.log("  MARKET MAKER BOT");
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
  console.log(`  Auto-Split: ${config.inventory.autoSplitEnabled}`);
  console.log(`  Execution: Safe (Gnosis Safe) account`);
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
 * Creates initial market maker state.
 */
export function createInitialState(): MarketMakerState {
  return {
    running: true,
    activeQuotes: { bid: null, ask: null, lastMidpoint: 0 },
    cycleCount: 0,
    lastError: null,
  };
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
        await cancelOrdersForToken(client, config.market.yesTokenId);
        log("All orders cancelled");
      } else {
        log("[DRY RUN] Would cancel all orders");
      }
    } catch (error) {
      log(`Error cancelling orders: ${error}`);
    }

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

  // Log position summary
  log("Position status:\n" + tracker.formatStatus());

  return tracker;
}

