/**
 * Market Maker Executor - Order placement and cancellation.
 *
 * Places BUY orders on both YES and NO tokens:
 * - BUY YES at (midpoint - offset) - equivalent to traditional bid
 * - BUY NO at (1 - (midpoint + offset)) - equivalent to traditional ask
 *
 * This approach is USDC-only and doesn't require holding tokens upfront.
 */

import { Side } from "@polymarket/clob-client";
import { placeOrder, cancelOrdersForToken } from "@/utils/orders.js";
import { log } from "@/utils/helpers.js";
import { getOrderTracker } from "@/utils/orderTracker.js";
import { generateQuotes, formatQuote, estimateRewardScore } from "./quoter.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerConfig, ActiveQuotes } from "./types.js";
import type { PositionTracker } from "@/utils/positionTracker.js";

/**
 * Result of checking position limits before placing quotes.
 *
 * canBuyYes: controls YES quote (buying YES increases net exposure)
 * canBuyNo: controls NO quote (buying NO decreases net exposure)
 */
export interface QuoteLimitCheck {
  /** Whether BUY YES is allowed (increases net exposure) */
  canBuyYes: boolean;
  /** Whether BUY NO is allowed (decreases net exposure) */
  canBuyNo: boolean;
  /** Reason if BUY YES is blocked */
  yesBlockedReason?: string;
  /** Reason if BUY NO is blocked */
  noBlockedReason?: string;
}

/**
 * Checks position limits to determine which sides can be quoted.
 *
 * - canQuoteBuy() controls YES quote (buying YES = positive exposure)
 * - canQuoteSell() controls NO quote (buying NO = negative exposure, same as selling YES)
 *
 * @param positionTracker - Position tracker instance (optional for backward compatibility)
 * @returns Limit check result
 */
export function checkPositionLimits(
  positionTracker: PositionTracker | null
): QuoteLimitCheck {
  if (!positionTracker) {
    // No position tracker - allow both sides
    return { canBuyYes: true, canBuyNo: true };
  }

  // canQuoteBuy controls YES (buying YES increases exposure)
  // canQuoteSell controls NO (buying NO decreases exposure, like selling YES)
  const yesCheck = positionTracker.canQuoteBuy();
  const noCheck = positionTracker.canQuoteSell();

  return {
    canBuyYes: yesCheck.allowed,
    canBuyNo: noCheck.allowed,
    yesBlockedReason: yesCheck.reason,
    noBlockedReason: noCheck.reason,
  };
}

/**
 * Places YES and NO orders with position limit checking.
 * Both orders are BUY orders on different tokens.
 * In dry run mode, logs the orders but doesn't place them.
 *
 * @param client - Authenticated CLOB client
 * @param config - Market maker configuration
 * @param midpoint - Current market midpoint for YES token
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
  const quoteYes = limits.canBuyYes;
  const quoteNo = limits.canBuyNo;

  // If both sides blocked, return early
  if (!quoteYes && !quoteNo) {
    log(`  Both sides blocked by position limits:`);
    log(`    BUY YES: ${limits.yesBlockedReason}`);
    log(`    BUY NO: ${limits.noBlockedReason}`);
    return {
      yesQuote: null,
      noQuote: null,
      lastMidpoint: midpoint,
    };
  }

  // Log what we're quoting
  log(`  Placing quotes:`);
  if (quoteYes) {
    log(`    ${formatQuote(quotes.yesQuote, "YES", midpoint)}`);
  } else {
    log(`    BUY YES: BLOCKED - ${limits.yesBlockedReason}`);
  }
  if (quoteNo) {
    log(`    ${formatQuote(quotes.noQuote, "NO", midpoint)}`);
  } else {
    log(`    BUY NO: BLOCKED - ${limits.noBlockedReason}`);
  }

  // Estimate reward scores for active sides
  if (quoteYes && quoteNo) {
    const yesScore = estimateRewardScore(quotes.yesQuote, "YES", midpoint, config.market.maxSpread);
    const noScore = estimateRewardScore(quotes.noQuote, "NO", midpoint, config.market.maxSpread);
    log(`    Estimated scores: YES=${yesScore.toFixed(1)}, NO=${noScore.toFixed(1)}`);
  } else if (quoteYes) {
    const yesScore = estimateRewardScore(quotes.yesQuote, "YES", midpoint, config.market.maxSpread);
    log(`    Estimated score: YES=${yesScore.toFixed(1)} (one-sided)`);
  } else if (quoteNo) {
    const noScore = estimateRewardScore(quotes.noQuote, "NO", midpoint, config.market.maxSpread);
    log(`    Estimated score: NO=${noScore.toFixed(1)} (one-sided)`);
  }

  // Dry run mode - don't actually place orders
  if (config.dryRun) {
    log(`    [DRY RUN] Orders simulated, not placed`);
    return {
      yesQuote: quoteYes ? { orderId: "dry-run-yes", price: quotes.yesQuote.price } : null,
      noQuote: quoteNo ? { orderId: "dry-run-no", price: quotes.noQuote.price } : null,
      lastMidpoint: midpoint,
    };
  }

  // Place orders (only the allowed sides)
  // Both orders are BUY orders, but on different tokens
  const orderPromises: Promise<{ token: "YES" | "NO"; result: Awaited<ReturnType<typeof placeOrder>> }>[] = [];

  // Get the order tracker for tracking placed orders
  const orderTracker = getOrderTracker();

  if (quoteYes) {
    orderPromises.push(
      placeOrder(client, {
        tokenId: config.market.yesTokenId,
        price: quotes.yesQuote.price,
        size: quotes.yesQuote.size,
        side: Side.BUY,
        tickSize: config.market.tickSize,
        negRisk: config.market.negRisk,
      }).then((result) => ({ token: "YES" as const, result }))
    );
  }

  if (quoteNo) {
    orderPromises.push(
      placeOrder(client, {
        tokenId: config.market.noTokenId,
        price: quotes.noQuote.price,
        size: quotes.noQuote.size,
        side: Side.BUY,
        tickSize: config.market.tickSize,
        negRisk: config.market.negRisk,
      }).then((result) => ({ token: "NO" as const, result }))
    );
  }

  const results = await Promise.all(orderPromises);

  // Process results
  let yesResult: { orderId: string; price: number } | null = null;
  let noResult: { orderId: string; price: number } | null = null;

  for (const { token, result } of results) {
    if (token === "YES") {
      if (result.success && result.orderId) {
        log(`    BUY YES placed: ${result.orderId.substring(0, 16)}...`);
        yesResult = { orderId: result.orderId, price: quotes.yesQuote.price };
        
        // Track the order for fill attribution
        orderTracker.trackOrder(result.orderId, {
          tokenId: config.market.yesTokenId,
          tokenType: "YES",
          side: "BUY",
          price: quotes.yesQuote.price,
          size: quotes.yesQuote.size,
        });
      } else {
        log(`    BUY YES failed: ${result.errorMsg}`);
      }
    } else {
      if (result.success && result.orderId) {
        log(`    BUY NO placed: ${result.orderId.substring(0, 16)}...`);
        noResult = { orderId: result.orderId, price: quotes.noQuote.price };
        
        // Track the order for fill attribution
        orderTracker.trackOrder(result.orderId, {
          tokenId: config.market.noTokenId,
          tokenType: "NO",
          side: "BUY",
          price: quotes.noQuote.price,
          size: quotes.noQuote.size,
        });
      } else {
        log(`    BUY NO failed: ${result.errorMsg}`);
      }
    }
  }

  return {
    yesQuote: yesResult,
    noQuote: noResult,
    lastMidpoint: midpoint,
  };
}

/**
 * Cancels existing orders for the market.
 * Cancels orders on BOTH YES and NO tokens.
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

  // Cancel orders on both tokens in parallel
  await Promise.all([
    cancelOrdersForToken(client, config.market.yesTokenId),
    cancelOrdersForToken(client, config.market.noTokenId),
  ]);

  log("  Cancelled existing orders (YES + NO)");
}
