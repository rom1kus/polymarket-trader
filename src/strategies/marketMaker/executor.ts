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
import type { PositionTracker } from "@/utils/positionTracker.js";

/**
 * Result of checking position limits before placing quotes.
 */
export interface QuoteLimitCheck {
  /** Whether BUY side is allowed */
  canBuy: boolean;
  /** Whether SELL side is allowed */
  canSell: boolean;
  /** Reason if BUY is blocked */
  buyBlockedReason?: string;
  /** Reason if SELL is blocked */
  sellBlockedReason?: string;
}

/**
 * Checks position limits to determine which sides can be quoted.
 *
 * @param positionTracker - Position tracker instance (optional for backward compatibility)
 * @returns Limit check result
 */
export function checkPositionLimits(
  positionTracker: PositionTracker | null
): QuoteLimitCheck {
  if (!positionTracker) {
    // No position tracker - allow both sides
    return { canBuy: true, canSell: true };
  }

  const buyCheck = positionTracker.canQuoteBuy();
  const sellCheck = positionTracker.canQuoteSell();

  return {
    canBuy: buyCheck.allowed,
    canSell: sellCheck.allowed,
    buyBlockedReason: buyCheck.reason,
    sellBlockedReason: sellCheck.reason,
  };
}

/**
 * Places bid and ask orders with position limit checking.
 * In dry run mode, logs the orders but doesn't place them.
 *
 * @param client - Authenticated CLOB client
 * @param config - Market maker configuration
 * @param midpoint - Current market midpoint
 * @param positionTracker - Position tracker for limit checking (optional)
 * @returns Active quotes result
 */
export async function placeQuotes(
  client: ClobClient,
  config: MarketMakerConfig,
  midpoint: number,
  positionTracker: PositionTracker | null = null
): Promise<ActiveQuotes> {
  const quotes = generateQuotes(midpoint, config);

  // Check position limits
  const limits = checkPositionLimits(positionTracker);

  // Log position status if tracker is available
  if (positionTracker) {
    const status = positionTracker.getLimitStatus();
    if (status.isWarning || status.isLimitReached) {
      log(`  Position: ${status.netExposure >= 0 ? "+" : ""}${status.netExposure.toFixed(1)} (${status.utilizationPercent.toFixed(0)}% of limit)`);
    }
  }

  // Determine which sides to quote
  const quoteBid = limits.canBuy;
  const quoteAsk = limits.canSell;

  // If both sides blocked, return early
  if (!quoteBid && !quoteAsk) {
    log(`  Both sides blocked by position limits:`);
    log(`    BUY: ${limits.buyBlockedReason}`);
    log(`    SELL: ${limits.sellBlockedReason}`);
    return {
      bid: null,
      ask: null,
      lastMidpoint: midpoint,
    };
  }

  // Log what we're quoting
  log(`  Placing quotes:`);
  if (quoteBid) {
    log(`    ${formatQuote(quotes.bid, midpoint)}`);
  } else {
    log(`    BUY: BLOCKED - ${limits.buyBlockedReason}`);
  }
  if (quoteAsk) {
    log(`    ${formatQuote(quotes.ask, midpoint)}`);
  } else {
    log(`    SELL: BLOCKED - ${limits.sellBlockedReason}`);
  }

  // Estimate reward scores for active sides
  if (quoteBid && quoteAsk) {
    const bidScore = estimateRewardScore(quotes.bid, midpoint, config.market.maxSpread);
    const askScore = estimateRewardScore(quotes.ask, midpoint, config.market.maxSpread);
    log(`    Estimated scores: Bid=${bidScore.toFixed(1)}, Ask=${askScore.toFixed(1)}`);
  } else if (quoteBid) {
    const bidScore = estimateRewardScore(quotes.bid, midpoint, config.market.maxSpread);
    log(`    Estimated score: Bid=${bidScore.toFixed(1)} (one-sided)`);
  } else if (quoteAsk) {
    const askScore = estimateRewardScore(quotes.ask, midpoint, config.market.maxSpread);
    log(`    Estimated score: Ask=${askScore.toFixed(1)} (one-sided)`);
  }

  // Dry run mode - don't actually place orders
  if (config.dryRun) {
    log(`    [DRY RUN] Orders simulated, not placed`);
    return {
      bid: quoteBid ? { orderId: "dry-run-bid", price: quotes.bid.price } : null,
      ask: quoteAsk ? { orderId: "dry-run-ask", price: quotes.ask.price } : null,
      lastMidpoint: midpoint,
    };
  }

  // Place orders (only the allowed sides)
  const orderPromises: Promise<{ side: "BUY" | "SELL"; result: Awaited<ReturnType<typeof placeOrder>> }>[] = [];

  if (quoteBid) {
    orderPromises.push(
      placeOrder(client, {
        tokenId: config.market.yesTokenId,
        price: quotes.bid.price,
        size: quotes.bid.size,
        side: Side.BUY,
        tickSize: config.market.tickSize,
        negRisk: config.market.negRisk,
      }).then((result) => ({ side: "BUY" as const, result }))
    );
  }

  if (quoteAsk) {
    orderPromises.push(
      placeOrder(client, {
        tokenId: config.market.yesTokenId,
        price: quotes.ask.price,
        size: quotes.ask.size,
        side: Side.SELL,
        tickSize: config.market.tickSize,
        negRisk: config.market.negRisk,
      }).then((result) => ({ side: "SELL" as const, result }))
    );
  }

  const results = await Promise.all(orderPromises);

  // Process results
  let bidResult: { orderId: string; price: number } | null = null;
  let askResult: { orderId: string; price: number } | null = null;

  for (const { side, result } of results) {
    if (side === "BUY") {
      if (result.success && result.orderId) {
        log(`    Bid placed: ${result.orderId.substring(0, 16)}...`);
        bidResult = { orderId: result.orderId, price: quotes.bid.price };
      } else {
        log(`    Bid failed: ${result.errorMsg}`);
      }
    } else {
      if (result.success && result.orderId) {
        log(`    Ask placed: ${result.orderId.substring(0, 16)}...`);
        askResult = { orderId: result.orderId, price: quotes.ask.price };
      } else {
        log(`    Ask failed: ${result.errorMsg}`);
      }
    }
  }

  return {
    bid: bidResult,
    ask: askResult,
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
