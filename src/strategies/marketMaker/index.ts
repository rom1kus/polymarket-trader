/**
 * Market Maker Strategy - Main Entry Point
 *
 * A market maker bot that places two-sided limit orders around the
 * current midpoint to earn Polymarket liquidity rewards.
 *
 * Features:
 * - Pre-flight checks (balance validation, MATIC for gas)
 * - Auto-split USDC into YES+NO tokens for two-sided liquidity
 * - All CTF operations executed through Safe (Gnosis Safe) account
 * - Dry run mode for safe testing
 * - Periodic inventory checks with auto-topup
 *
 * Usage:
 *   1. Run: npm run selectMarket -- <event-slug> to generate config
 *   2. Edit src/strategies/marketMaker/config.ts with your parameters
 *   3. Set dryRun: false when ready for live trading
 *   4. Run: npm run marketMaker
 *   5. Press Ctrl+C to stop (will cancel all orders before exiting)
 */

import { Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { placeOrder, cancelOrdersForToken, getMidpoint } from "@/utils/orders.js";
import { sleep, log } from "@/utils/helpers.js";
import { env } from "@/utils/env.js";
import {
  getPolygonProvider,
  approveAndSplitFromSafe,
  createSafeForCtf,
  type SafeInstance,
} from "@/utils/ctf.js";
import {
  runPreFlightChecks,
  formatInventoryStatus,
} from "@/utils/inventory.js";
import { generateQuotes, shouldRebalance, formatQuote, estimateRewardScore } from "./quoter.js";
import { CONFIG } from "./config.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { JsonRpcProvider } from "@ethersproject/providers";
import type { MarketMakerConfig, ActiveQuotes, MarketMakerState } from "./types.js";

/**
 * Validates the configuration before starting.
 */
function validateConfig(config: MarketMakerConfig): void {
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
 * Places bid and ask orders.
 * In dry run mode, logs the orders but doesn't place them.
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

  // Dry run mode - don't actually place orders
  if (config.dryRun) {
    log(`    [DRY RUN] Orders simulated, not placed`);
    return {
      bid: { orderId: "dry-run-bid", price: quotes.bid.price },
      ask: { orderId: "dry-run-ask", price: quotes.ask.price },
      lastMidpoint: midpoint,
    };
  }

  // Place orders in parallel
  const [bidResult, askResult] = await Promise.all([
    placeOrder(client, {
      tokenId: config.market.yesTokenId,
      price: quotes.bid.price,
      size: quotes.bid.size,
      side: Side.BUY,
      tickSize: config.market.tickSize,
      negRisk: config.market.negRisk,
    }),
    placeOrder(client, {
      tokenId: config.market.yesTokenId,
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
 * Cancels existing orders for the market.
 * In dry run mode, logs but doesn't cancel.
 */
async function cancelExistingOrders(
  client: ClobClient,
  config: MarketMakerConfig
): Promise<void> {
  if (config.dryRun) {
    log("  [DRY RUN] Would cancel existing orders");
    return;
  }
  await cancelOrdersForToken(client, config.market.yesTokenId);
  log("  Cancelled existing orders");
}

/**
 * Executes the split operation if needed via Safe account.
 * In dry run mode, logs but doesn't execute.
 */
async function executeSplitIfNeeded(
  safe: SafeInstance,
  safeAddress: string,
  provider: JsonRpcProvider,
  config: MarketMakerConfig,
  splitAmount: number
): Promise<void> {
  if (splitAmount <= 0) {
    return;
  }

  log(`  Splitting $${splitAmount.toFixed(2)} USDC into YES+NO tokens via Safe...`);

  if (config.dryRun) {
    log(`  [DRY RUN] Would split $${splitAmount.toFixed(2)} USDC`);
    return;
  }

  // Execute approval + split through Safe (batched for efficiency)
  const result = await approveAndSplitFromSafe(
    safe,
    safeAddress,
    config.market.conditionId,
    splitAmount,
    provider
  );

  if (!result.success) {
    throw new Error(`Failed to split USDC: ${result.error}`);
  }

  log(`  Split complete: ${result.transactionHash}`);
}

/**
 * Prints the startup banner.
 */
function printBanner(config: MarketMakerConfig): void {
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
  console.log(`  Refresh: every ${config.refreshIntervalMs / 1000}s`);
  console.log(`  Rebalance Threshold: ${config.rebalanceThreshold * 100} cents`);
  console.log(`  Tick Size: ${config.market.tickSize}`);
  console.log(`  Negative Risk: ${config.market.negRisk}`);
  console.log(`  Auto-Split: ${config.inventory.autoSplitEnabled}`);
  console.log(`  Execution: Safe (Gnosis Safe) account`);
  console.log("=".repeat(60));
  console.log("  Press Ctrl+C to stop\n");
}

/**
 * Main market maker loop.
 */
async function runMarketMaker(config: MarketMakerConfig): Promise<void> {
  // Validate configuration
  validateConfig(config);

  // Print startup banner
  printBanner(config);

  // Initialize client and Safe wallet
  log("Initializing authenticated client...");
  const client = await createAuthenticatedClobClient();
  log("Client initialized successfully");

  // Initialize Safe for CTF operations
  log("Initializing Safe wallet for CTF operations...");
  const safeAddress = env.POLYMARKET_PROXY_ADDRESS;
  const signerAddress = new Wallet(env.FUNDER_PRIVATE_KEY).address;
  const safe = await createSafeForCtf({
    signerPrivateKey: env.FUNDER_PRIVATE_KEY,
    safeAddress,
  });
  const provider = getPolygonProvider();
  log(`Safe initialized: ${safeAddress}`);
  log(`Signer (gas payer): ${signerAddress}`);

  // =========================================================================
  // PRE-FLIGHT CHECKS
  // =========================================================================
  log("\nRunning pre-flight checks...");

  const preflight = await runPreFlightChecks(
    client,
    config.market,
    config.orderSize,
    config.inventory,
    signerAddress,  // Use signer address for MATIC gas balance check
    provider
  );

  // Show current inventory
  log("\nCurrent inventory:");
  console.log(formatInventoryStatus(preflight.status));

  // Show warnings
  for (const warning of preflight.warnings) {
    log(`  WARNING: ${warning}`);
  }

  // Fail on errors
  if (!preflight.ready) {
    log("\nPre-flight checks FAILED:");
    for (const error of preflight.errors) {
      log(`  ERROR: ${error}`);
    }
    throw new Error("Pre-flight checks failed. Cannot start market maker.");
  }

  // Execute split if needed
  if (preflight.deficit && preflight.deficit.splitAmount > 0) {
    await executeSplitIfNeeded(
      safe,
      safeAddress,
      provider,
      config,
      preflight.deficit.splitAmount
    );
  }

  log("\nPre-flight checks PASSED\n");

  // =========================================================================
  // MAIN LOOP
  // =========================================================================

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

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Main loop
  while (state.running) {
    state.cycleCount++;

    try {
      // 1. Get current midpoint
      const midpoint = await getMidpoint(client, config.market.yesTokenId);
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
          await cancelExistingOrders(client, config);
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

      // 5. Periodic inventory check (every 10 cycles if autoSplit enabled)
      if (config.inventory.autoSplitEnabled && state.cycleCount % 10 === 0) {
        log("  Checking inventory...");
        const inventoryCheck = await runPreFlightChecks(
          client,
          config.market,
          config.orderSize,
          config.inventory,
          signerAddress,  // Use signer address for MATIC gas balance check
          provider
        );

        if (inventoryCheck.deficit && inventoryCheck.deficit.splitAmount > 0) {
          log(`  Inventory low, topping up...`);
          await executeSplitIfNeeded(
            safe,
            safeAddress,
            provider,
            config,
            inventoryCheck.deficit.splitAmount
          );
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ERROR: ${errorMsg}`);
      state.lastError = errorMsg;
    }

    // 6. Wait for next cycle
    await sleep(config.refreshIntervalMs);
  }
}

// Entry point
runMarketMaker(CONFIG).catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
