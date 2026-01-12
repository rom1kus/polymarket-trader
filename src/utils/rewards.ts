/**
 * Reward calculation utilities for Polymarket liquidity rewards.
 *
 * Polymarket uses a quadratic scoring formula to incentivize tighter spreads:
 * S(v,s) = ((v-s)/v)² × size
 *
 * Where:
 * - v = max spread from midpoint (in cents)
 * - s = order's spread from midpoint (in cents)
 * - size = order size in shares
 *
 * Orders closer to the midpoint earn exponentially more rewards.
 */

import type { ClobClient } from "@polymarket/clob-client";
import type {
  OpenOrder,
  MarketRewardParamsWithMidpoint,
  OrderRewardStatus,
  RewardCheckResult,
} from "@/types/rewards.js";
import { fetchMarketRewardParams } from "@/utils/gamma.js";
import { getMidpoint } from "@/utils/orders.js";

/**
 * Calculates the reward score for an order using Polymarket's quadratic formula.
 *
 * @param spreadCents - Spread from midpoint in cents
 * @param maxSpreadCents - Maximum spread for rewards in cents (from rewardsMaxSpread)
 * @param size - Order size in shares
 * @returns Reward score (0 if outside max spread, higher is better)
 *
 * @example
 * // Order 1 cent from midpoint, max spread 3 cents, size 100
 * calculateRewardScore(1, 3, 100); // Returns ~44.44
 *
 * @example
 * // Order exactly at max spread earns nothing
 * calculateRewardScore(3, 3, 100); // Returns 0
 */
export function calculateRewardScore(
  spreadCents: number,
  maxSpreadCents: number,
  size: number
): number {
  // Orders at or beyond max spread earn no rewards
  if (spreadCents >= maxSpreadCents) {
    return 0;
  }

  // Quadratic formula: ((v-s)/v)² × size
  const ratio = (maxSpreadCents - spreadCents) / maxSpreadCents;
  return ratio * ratio * size;
}

/**
 * Calculates the spread from midpoint in cents.
 *
 * @param price - Order price (0-1)
 * @param midpoint - Market midpoint (0-1)
 * @returns Spread in cents (absolute value)
 *
 * @example
 * calculateSpreadCents(0.48, 0.50); // Returns 2 (cents)
 */
export function calculateSpreadCents(price: number, midpoint: number): number {
  return Math.abs(price - midpoint) * 100;
}

/**
 * Determines if two-sided liquidity is required for reward eligibility.
 *
 * Per Polymarket docs, two-sided liquidity is required when the midpoint
 * is outside the [0.10, 0.90] range.
 *
 * @param midpoint - Current market midpoint (0-1)
 * @returns True if two-sided liquidity is required
 */
export function isTwoSidedRequired(midpoint: number): boolean {
  return midpoint < 0.1 || midpoint > 0.9;
}

/**
 * Calculates effective score considering single-sided penalty.
 *
 * From Polymarket docs:
 * - If midpoint in [0.10, 0.90]: Qmin = max(min(Qone, Qtwo), max(Qone/c, Qtwo/c))
 * - If midpoint outside: Qmin = min(Qone, Qtwo)
 *
 * @param buyScore - Total score from buy orders
 * @param sellScore - Total score from sell orders
 * @param midpoint - Market midpoint (0-1)
 * @param scalingFactor - Penalty factor for single-sided (default 3.0)
 * @returns Effective score after two-sided consideration
 */
export function calculateEffectiveScore(
  buyScore: number,
  sellScore: number,
  midpoint: number,
  scalingFactor: number = 3.0
): number {
  if (isTwoSidedRequired(midpoint)) {
    // Strict two-sided requirement
    return Math.min(buyScore, sellScore);
  }

  // Single-sided allowed with penalty
  return Math.max(
    Math.min(buyScore, sellScore),
    Math.max(buyScore / scalingFactor, sellScore / scalingFactor)
  );
}

/**
 * Default scaling factor for single-sided liquidity penalty.
 */
export const DEFAULT_SCALING_FACTOR = 3.0;

/**
 * Order book summary with bids and asks at each price level.
 * Matches @polymarket/clob-client OrderBookSummary.
 */
export interface OrderBookLevel {
  price: string;
  size: string;
}

/**
 * Result of calculating total Q score from the order book.
 */
export interface TotalQScoreResult {
  /** Sum of scores for all bids within max spread */
  totalBidScore: number;
  /** Sum of scores for all asks within max spread */
  totalAskScore: number;
  /** Q_min = min(totalBidScore, totalAskScore) */
  totalQMin: number;
  /** Number of bid levels within reward range */
  eligibleBidLevels: number;
  /** Number of ask levels within reward range */
  eligibleAskLevels: number;
}

/**
 * Calculates the total Q score for an entire order book.
 *
 * Scores all bids and asks within the max spread from midpoint using
 * the Polymarket quadratic formula: S(v,s) = ((v-s)/v)² × size
 *
 * @param bids - Array of bid levels (price, size)
 * @param asks - Array of ask levels (price, size)
 * @param midpoint - Current market midpoint (0-1)
 * @param maxSpreadCents - Maximum spread for rewards (in cents)
 * @returns Total Q score breakdown
 *
 * @example
 * const result = calculateTotalQScore(orderBook.bids, orderBook.asks, 0.55, 5);
 * console.log(`Total Q_min: ${result.totalQMin}`);
 */
export function calculateTotalQScore(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  midpoint: number,
  maxSpreadCents: number
): TotalQScoreResult {
  let totalBidScore = 0;
  let totalAskScore = 0;
  let eligibleBidLevels = 0;
  let eligibleAskLevels = 0;

  // Score all bids
  for (const bid of bids) {
    const price = parseFloat(bid.price);
    const size = parseFloat(bid.size);
    const spreadCents = calculateSpreadCents(price, midpoint);

    if (spreadCents < maxSpreadCents) {
      const score = calculateRewardScore(spreadCents, maxSpreadCents, size);
      totalBidScore += score;
      eligibleBidLevels++;
    }
  }

  // Score all asks
  for (const ask of asks) {
    const price = parseFloat(ask.price);
    const size = parseFloat(ask.size);
    const spreadCents = calculateSpreadCents(price, midpoint);

    if (spreadCents < maxSpreadCents) {
      const score = calculateRewardScore(spreadCents, maxSpreadCents, size);
      totalAskScore += score;
      eligibleAskLevels++;
    }
  }

  return {
    totalBidScore,
    totalAskScore,
    totalQMin: Math.min(totalBidScore, totalAskScore),
    eligibleBidLevels,
    eligibleAskLevels,
  };
}

/**
 * Calculates earning percentage from your Q_min and total Q_min.
 *
 * @param yourQMin - Your Q_min score
 * @param totalQMin - Total Q_min from the order book
 * @returns Earning percentage (0-100)
 */
export function calculateEarningPercentage(
  yourQMin: number,
  totalQMin: number
): number {
  if (totalQMin === 0) return 0;
  return (yourQMin / totalQMin) * 100;
}

/**
 * Estimates daily earnings for a given liquidity amount in a market.
 *
 * This uses the Polymarket quadratic reward formula:
 * - Your Q score = ((maxSpread - spread) / maxSpread)² × size
 * - Your earning % = yourQScore / totalMarketQScore
 * - Daily earnings = earningPercent × dailyRewardPool
 *
 * For estimation, we assume:
 * - Orders placed at half the max spread (reasonable competitive position)
 * - Two-sided liquidity (full score, no penalty)
 * - Size is the liquidity amount (assuming ~$0.50 per share at midpoint)
 *
 * @param rewardsDaily - Total daily reward pool in USD
 * @param marketCompetitiveness - Market competitiveness from API (represents one side's Q score)
 * @param liquidityAmount - Amount of liquidity to deploy in USD
 * @param spreadFromMid - Assumed spread from midpoint in cents (default: half of maxSpread for reasonable estimate)
 * @param maxSpread - Maximum spread for rewards in cents
 * @returns Estimated daily earnings in USD
 *
 * @example
 * // Market with $500/day rewards, 200 competition, $100 liquidity at 2.5c spread (half of 5c max)
 * estimateDailyEarnings(500, 200, 100, 2.5, 5); // Returns ~$1.25
 */
export function estimateDailyEarnings(
  rewardsDaily: number,
  marketCompetitiveness: number,
  liquidityAmount: number,
  spreadFromMid: number,
  maxSpread: number
): number {
  if (rewardsDaily <= 0 || marketCompetitiveness <= 0 || maxSpread <= 0) {
    return 0;
  }

  // Calculate the Q score for our liquidity
  // Assuming ~$0.50 per share at midpoint, so $100 liquidity ≈ 200 shares
  const sharesPerDollar = 2; // Approximate shares per $1 at midpoint
  const shares = liquidityAmount * sharesPerDollar;
  
  // Q score using quadratic formula: ((v-s)/v)² × size
  const yourQScore = calculateRewardScore(spreadFromMid, maxSpread, shares);

  // Total market Q score (API returns one side, multiply by 2 for both sides)
  // Add our Q score to the total since we'd be contributing to it
  const totalQScore = marketCompetitiveness * 2 + yourQScore;

  // Our earning percentage
  const earningPct = calculateEarningPercentage(yourQScore, totalQScore);

  // Daily earnings
  return (earningPct / 100) * rewardsDaily;
}

/**
 * Default liquidity amount for earning estimates (in USD).
 */
export const DEFAULT_ESTIMATE_LIQUIDITY = 100;

/**
 * Calculates the earning potential score for market ranking.
 *
 * This provides a comprehensive score that combines:
 * 1. Primary: Estimated daily earnings per $100 liquidity
 * 2. Secondary: Ease of participation (spread tolerance, min size requirements)
 *
 * @param rewardsDaily - Total daily reward pool in USD
 * @param marketCompetitiveness - Market competitiveness from API
 * @param maxSpread - Maximum spread for rewards in cents
 * @param minSize - Minimum order size for rewards in shares
 * @param liquidityAmount - Liquidity amount for estimate (default $100)
 * @returns Earning potential breakdown
 */
export function calculateEarningPotential(
  rewardsDaily: number,
  marketCompetitiveness: number,
  maxSpread: number,
  minSize: number,
  liquidityAmount: number = DEFAULT_ESTIMATE_LIQUIDITY
): {
  estimatedDailyEarnings: number;
  earningEfficiency: number;
  easeOfParticipation: number;
  totalScore: number;
} {
  // Assume orders at half the max spread for a reasonable competitive position
  const assumedSpread = maxSpread / 2;
  
  // Calculate estimated daily earnings
  const estimatedDailyEarnings = estimateDailyEarnings(
    rewardsDaily,
    marketCompetitiveness,
    liquidityAmount,
    assumedSpread,
    maxSpread
  );

  // Earning efficiency: $/day per $100 liquidity (normalized)
  // This is the primary ranking metric
  const earningEfficiency = estimatedDailyEarnings;

  // Ease of participation score (0-100):
  // - Higher maxSpread = easier to stay in range (0-50 pts)
  // - Lower minSize = easier to meet minimum (0-50 pts)
  const spreadEase = Math.min((maxSpread / 10) * 50, 50);
  const sizeEase = Math.max(50 - (minSize / 100) * 50, 0);
  const easeOfParticipation = spreadEase + sizeEase;

  // Total score: primarily based on earnings, with small ease bonus
  // Earnings are typically 0-10 $/day, ease is 0-100
  // We weight earnings heavily (10x) so a $1 difference >> ease score
  const totalScore = earningEfficiency * 10 + easeOfParticipation * 0.01;

  return {
    estimatedDailyEarnings,
    earningEfficiency,
    easeOfParticipation,
    totalScore,
  };
}

/**
 * Fetches reward parameters for a market including current midpoint for all tokens.
 *
 * Combines Gamma API reward params with CLOB midpoint data for each token.
 *
 * @param client - Authenticated CLOB client
 * @param tokenIds - Token IDs for the market (YES and NO tokens)
 * @param conditionId - Condition ID for the market
 * @returns Market reward parameters with midpoints for all tokens
 */
export async function getMarketRewardParamsWithMidpoint(
  client: ClobClient,
  tokenIds: string[],
  conditionId: string
): Promise<MarketRewardParamsWithMidpoint> {
  const primaryTokenId = tokenIds[0];

  // Fetch gamma params and midpoints for all tokens in parallel
  const [gammaParams, ...midpoints] = await Promise.all([
    fetchMarketRewardParams(primaryTokenId),
    ...tokenIds.map((tid) => getMidpoint(client, tid)),
  ]);

  // Build midpoint map for each token
  const midpointByToken = new Map<string, number>();
  tokenIds.forEach((tid, index) => {
    midpointByToken.set(tid, midpoints[index]);
  });

  return {
    ...gammaParams,
    tokenIds,
    conditionId,
    midpoint: midpoints[0], // Primary token midpoint for backward compatibility
    midpointByToken,
  };
}

/**
 * Evaluates reward eligibility for a single order.
 *
 * @param order - The open order to evaluate
 * @param params - Market reward parameters
 * @returns Order reward status
 */
export function evaluateOrderReward(
  order: OpenOrder,
  params: MarketRewardParamsWithMidpoint
): OrderRewardStatus {
  const price = parseFloat(order.price);
  const size = parseFloat(order.original_size) - parseFloat(order.size_matched);

  // Use the midpoint specific to this order's token
  const tokenMidpoint =
    params.midpointByToken.get(order.asset_id) ?? params.midpoint;
  const spreadFromMid = calculateSpreadCents(price, tokenMidpoint);

  let eligible = true;
  let reason: string | undefined;

  // Check minimum size
  if (size < params.rewardsMinSize) {
    eligible = false;
    reason = `Size ${size} < min ${params.rewardsMinSize}`;
  }

  // Check max spread
  if (spreadFromMid > params.rewardsMaxSpread) {
    eligible = false;
    reason = `Spread ${spreadFromMid.toFixed(2)}c > max ${params.rewardsMaxSpread}c`;
  }

  const score = eligible
    ? calculateRewardScore(spreadFromMid, params.rewardsMaxSpread, size)
    : 0;

  return {
    orderId: order.id,
    side: order.side,
    price,
    size,
    spreadFromMid,
    score,
    eligible,
    reason,
  };
}

/**
 * Checks reward eligibility for a group of orders on the same market (conditionId).
 *
 * When orders span multiple tokens (YES/NO), the order's effective "market side"
 * is determined by both its side (BUY/SELL) and which token it's on:
 * - BUY on YES token (or first token) = bid side
 * - SELL on YES token (or first token) = ask side
 * - BUY on NO token (or second token) = ask side (mirrored)
 * - SELL on NO token (or second token) = bid side (mirrored)
 *
 * @param orders - Array of open orders for a market (may span YES and NO tokens)
 * @param params - Market reward parameters with midpoint
 * @param scalingFactor - Single-sided penalty factor (default 3.0)
 * @returns Complete reward check result
 */
export function checkOrdersRewardEligibility(
  orders: OpenOrder[],
  params: MarketRewardParamsWithMidpoint,
  scalingFactor: number = DEFAULT_SCALING_FACTOR
): RewardCheckResult {
  const orderStatuses: OrderRewardStatus[] = [];
  let totalBuyScore = 0; // Bid side (YES bids + NO asks)
  let totalSellScore = 0; // Ask side (YES asks + NO bids)
  let hasBuySide = false;
  let hasSellSide = false;

  // Determine the primary token (first token is typically YES)
  const primaryTokenId = params.tokenIds[0];

  for (const order of orders) {
    const status = evaluateOrderReward(order, params);
    orderStatuses.push(status);

    // Determine effective market side based on token and order side
    // For primary token (YES): BUY = bid side, SELL = ask side
    // For secondary token (NO): BUY = ask side (mirrored), SELL = bid side (mirrored)
    const isPrimaryToken = order.asset_id === primaryTokenId;
    const isBidSide =
      (isPrimaryToken && order.side === "BUY") ||
      (!isPrimaryToken && order.side === "SELL");

    if (isBidSide) {
      totalBuyScore += status.score;
      if (status.eligible) hasBuySide = true;
    } else {
      totalSellScore += status.score;
      if (status.eligible) hasSellSide = true;
    }
  }

  const twoSidedRequired = isTwoSidedRequired(params.midpoint);
  const effectiveScore = calculateEffectiveScore(
    totalBuyScore,
    totalSellScore,
    params.midpoint,
    scalingFactor
  );
  const eligible = effectiveScore > 0;

  // Build summary
  let summary: string;
  if (!eligible) {
    if (twoSidedRequired && (!hasBuySide || !hasSellSide)) {
      summary = `NOT ELIGIBLE: Two-sided required (midpoint ${(params.midpoint * 100).toFixed(1)}c), but missing ${!hasBuySide ? "BUY" : "SELL"} side`;
    } else if (orderStatuses.every((o) => !o.eligible)) {
      summary = `NOT ELIGIBLE: All orders outside reward parameters`;
    } else {
      summary = `NOT ELIGIBLE: Unknown reason`;
    }
  } else {
    const singleSidedPenalty =
      !hasBuySide || !hasSellSide
        ? ` (single-sided, score reduced by ${scalingFactor}x)`
        : "";
    summary = `ELIGIBLE: Effective score = ${effectiveScore.toFixed(2)}${singleSidedPenalty}`;
  }

  return {
    market: params,
    orders: orderStatuses,
    twoSidedRequired,
    hasBuySide,
    hasSellSide,
    totalBuyScore,
    totalSellScore,
    effectiveScore,
    scalingFactor,
    eligible,
    summary,
  };
}

/**
 * Checks reward eligibility for all open orders.
 *
 * Groups orders by conditionId (market) and evaluates each group.
 * This combines orders from both YES and NO tokens into a single result
 * per market, matching how Polymarket reports earnings.
 *
 * @param client - Authenticated CLOB client
 * @param orders - Array of all open orders
 * @param conditionId - Optional filter for specific market
 * @returns Array of reward check results (one per market/conditionId)
 */
export async function checkAllOrdersRewardEligibility(
  client: ClobClient,
  orders: OpenOrder[],
  conditionId?: string
): Promise<RewardCheckResult[]> {
  // First pass: collect unique tokenIds and fetch their conditionIds
  const tokenIds = [...new Set(orders.map((o) => o.asset_id))];

  // Fetch order books to get conditionId for each token (with caching)
  const tokenToCondition = new Map<string, string>();
  for (const tid of tokenIds) {
    const orderBook = await client.getOrderBook(tid);
    tokenToCondition.set(tid, orderBook.market); // orderBook.market is conditionId
  }

  // Group orders by conditionId
  const ordersByCondition = new Map<string, OpenOrder[]>();
  const tokensByCondition = new Map<string, Set<string>>();

  for (const order of orders) {
    const cid = tokenToCondition.get(order.asset_id)!;
    if (conditionId && cid !== conditionId) continue;

    if (!ordersByCondition.has(cid)) {
      ordersByCondition.set(cid, []);
      tokensByCondition.set(cid, new Set());
    }
    ordersByCondition.get(cid)!.push(order);
    tokensByCondition.get(cid)!.add(order.asset_id);
  }

  const results: RewardCheckResult[] = [];

  // Process each conditionId's orders
  for (const [cid, conditionOrders] of ordersByCondition) {
    const conditionTokenIds = [...tokensByCondition.get(cid)!];

    // Fetch params using first token (reward params are shared across tokens in same market)
    const params = await getMarketRewardParamsWithMidpoint(
      client,
      conditionTokenIds,
      cid
    );

    const result = checkOrdersRewardEligibility(conditionOrders, params);
    results.push(result);
  }

  return results;
}
