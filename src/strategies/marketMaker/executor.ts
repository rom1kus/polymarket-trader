/**
 * Market Maker Executor - Order placement, cancellation, and CTF operations.
 */

import { Side } from "@polymarket/clob-client";
import { placeOrder, cancelOrdersForToken } from "@/utils/orders.js";
import { log } from "@/utils/helpers.js";
import { approveAndSplitFromSafe, type SafeInstance } from "@/utils/ctf.js";
import { generateQuotes, formatQuote, estimateRewardScore } from "./quoter.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { JsonRpcProvider } from "@ethersproject/providers";
import type { MarketMakerConfig, ActiveQuotes } from "./types.js";

/**
 * Places bid and ask orders.
 * In dry run mode, logs the orders but doesn't place them.
 */
export async function placeQuotes(
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
export async function cancelExistingOrders(
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
export async function executeSplitIfNeeded(
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
