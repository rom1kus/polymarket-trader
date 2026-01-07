/**
 * Market Maker Lifecycle - Startup, shutdown, and validation functions.
 */

import { log } from "@/utils/helpers.js";
import { cancelOrdersForToken } from "@/utils/orders.js";
import type { ClobClient } from "@polymarket/clob-client";
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
