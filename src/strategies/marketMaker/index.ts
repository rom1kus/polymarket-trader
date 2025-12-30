/**
 * Market Maker Strategy - Main Entry Point
 *
 * A simple market maker bot that places two-sided limit orders around the
 * current midpoint to earn Polymarket liquidity rewards.
 *
 * Usage:
 *   1. Edit src/strategies/marketMaker/config.ts with your market parameters
 *   2. Run: npm run marketMaker
 *   3. Press Ctrl+C to stop (will cancel all orders before exiting)
 *
 * How it works:
 *   - Fetches current midpoint from CLOB API
 *   - Places bid and ask orders within the reward-eligible spread
 *   - Periodically refreshes quotes to stay near the midpoint
 *   - Cancels and replaces orders when midpoint moves significantly
 */

import { ClobClient, Side } from "@polymarket/clob-client";
import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { placeOrder, cancelOrdersForToken } from "@/utils/orders.js";
import { generateQuotes, shouldRebalance, formatQuote, estimateRewardScore } from "./quoter.js";
import { CONFIG } from "./config.js";
import type { MarketMakerConfig, ActiveQuotes, MarketMakerState } from "./types.js";

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Formats a timestamp for logging.
 */
function timestamp(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Logs a message with timestamp.
 */
function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

/**
 * Fetches the current midpoint for a token.
 */
async function getMidpoint(client: ClobClient, tokenId: string): Promise<number> {
  const response = await client.getMidpoint(tokenId);
  // API returns { mid: string } object
  const midValue = typeof response === "object" && response !== null && "mid" in response
    ? (response as { mid: string }).mid
    : String(response);
  return parseFloat(midValue);
}

/**
 * Validates the configuration before starting.
 */
function validateConfig(config: MarketMakerConfig): void {
  if (config.market.tokenId === "YOUR_TOKEN_ID_HERE") {
    throw new Error(
      "Please configure your market in src/strategies/marketMaker/config.ts\n" +
        "Run 'npm run getEvent -- <event-slug>' to find token IDs"
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
 * Places bid and ask orders.
 */
async function placeQuotes(
  client: ClobClient,
  config: MarketMakerConfig,
  midpoint: number
): Promise<ActiveQuotes> {
  const quotes = generateQuotes(midpoint, config);

  log(`  Placing quotes:`);
  log(`    ${formatQuote(quotes.bid, midpoint)}`);
  log(`    ${formatQuote(quotes.ask, midpoint)}`);

  // Estimate reward scores
  const bidScore = estimateRewardScore(quotes.bid, midpoint, config.market.maxSpread);
  const askScore = estimateRewardScore(quotes.ask, midpoint, config.market.maxSpread);
  log(`    Estimated scores: Bid=${bidScore.toFixed(1)}, Ask=${askScore.toFixed(1)}`);

  // Place orders in parallel
  const [bidResult, askResult] = await Promise.all([
    placeOrder(client, {
      tokenId: config.market.tokenId,
      price: quotes.bid.price,
      size: quotes.bid.size,
      side: Side.BUY,
      tickSize: config.market.tickSize,
      negRisk: config.market.negRisk,
    }),
    placeOrder(client, {
      tokenId: config.market.tokenId,
      price: quotes.ask.price,
      size: quotes.ask.size,
      side: Side.SELL,
      tickSize: config.market.tickSize,
      negRisk: config.market.negRisk,
    }),
  ]);

  // Log results
  if (bidResult.success) {
    log(`    Bid placed: ${bidResult.orderId?.substring(0, 16)}...`);
  } else {
    log(`    Bid failed: ${bidResult.errorMsg}`);
  }

  if (askResult.success) {
    log(`    Ask placed: ${askResult.orderId?.substring(0, 16)}...`);
  } else {
    log(`    Ask failed: ${askResult.errorMsg}`);
  }

  return {
    bid: bidResult.success && bidResult.orderId
      ? { orderId: bidResult.orderId, price: quotes.bid.price }
      : null,
    ask: askResult.success && askResult.orderId
      ? { orderId: askResult.orderId, price: quotes.ask.price }
      : null,
    lastMidpoint: midpoint,
  };
}

/**
 * Main market maker loop.
 */
async function runMarketMaker(config: MarketMakerConfig): Promise<void> {
  // Validate configuration
  validateConfig(config);

  console.log("\n" + "=".repeat(60));
  console.log("  MARKET MAKER BOT");
  console.log("=".repeat(60));
  console.log(`  Token: ${config.market.tokenId.substring(0, 20)}...`);
  console.log(`  Order Size: ${config.orderSize} shares per side`);
  console.log(`  Spread: ${config.spreadPercent * 100}% of max (${config.market.maxSpread}c)`);
  console.log(`  Refresh: every ${config.refreshIntervalMs / 1000}s`);
  console.log(`  Rebalance Threshold: ${config.rebalanceThreshold * 100} cents`);
  console.log(`  Tick Size: ${config.market.tickSize}`);
  console.log(`  Negative Risk: ${config.market.negRisk}`);
  console.log("=".repeat(60));
  console.log("  Press Ctrl+C to stop\n");

  // Initialize client
  log("Initializing authenticated client...");
  const client = await createAuthenticatedClobClient();
  log("Client initialized successfully");

  // Initialize state
  const state: MarketMakerState = {
    running: true,
    activeQuotes: { bid: null, ask: null, lastMidpoint: 0 },
    cycleCount: 0,
    lastError: null,
  };

  // Graceful shutdown handler
  const shutdown = async () => {
    log("\nShutting down...");
    state.running = false;

    try {
      log("Cancelling all orders...");
      await cancelOrdersForToken(client, config.market.tokenId);
      log("All orders cancelled");
    } catch (error) {
      log(`Error cancelling orders: ${error}`);
    }

    console.log("\nGoodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Main loop
  while (state.running) {
    state.cycleCount++;

    try {
      // 1. Get current midpoint
      const midpoint = await getMidpoint(client, config.market.tokenId);
      log(`Cycle #${state.cycleCount} | Midpoint: $${midpoint.toFixed(4)}`);

      // 2. Check if we need to rebalance
      const hasQuotes = state.activeQuotes.bid !== null || state.activeQuotes.ask !== null;
      const needsRebalance =
        !hasQuotes ||
        shouldRebalance(midpoint, state.activeQuotes.lastMidpoint, config.rebalanceThreshold);

      if (needsRebalance) {
        const reason = !hasQuotes ? "No active quotes" : "Midpoint moved";
        log(`  ${reason}, rebalancing...`);

        // 3. Cancel existing orders
        if (hasQuotes) {
          await cancelOrdersForToken(client, config.market.tokenId);
          log("  Cancelled existing orders");
        }

        // 4. Place new quotes
        state.activeQuotes = await placeQuotes(client, config, midpoint);
        state.lastError = null;
      } else {
        const bidInfo = state.activeQuotes.bid
          ? `$${state.activeQuotes.bid.price.toFixed(4)}`
          : "none";
        const askInfo = state.activeQuotes.ask
          ? `$${state.activeQuotes.ask.price.toFixed(4)}`
          : "none";
        log(`  Quotes still valid (Bid: ${bidInfo}, Ask: ${askInfo})`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ERROR: ${errorMsg}`);
      state.lastError = errorMsg;
    }

    // 5. Wait for next cycle
    await sleep(config.refreshIntervalMs);
  }
}

// Entry point
runMarketMaker(CONFIG).catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
