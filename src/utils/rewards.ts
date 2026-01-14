/**
 * Polymarket Liquidity Rewards Calculation
 * =========================================
 *
 * This module implements reward scoring based on Polymarket's official documentation.
 * Source: https://docs.polymarket.com/developers/market-makers/liquidity-rewards
 *
 * The program is inspired by dYdX's liquidity provider rewards with adaptations
 * for binary contract markets. Rewards are distributed daily at midnight UTC.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 1. ORDER BOOK MIRRORING (Binary Markets)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * In binary YES/NO markets, order books are MIRRORED:
 *   - A BUY YES @ price p appears as SELL NO @ price (1-p) in the NO order book
 *   - A SELL YES @ price p appears as BUY NO @ price (1-p) in the NO order book
 *
 * CRITICAL: We only need ONE order book (typically the YES/primary token).
 * Fetching both order books would DOUBLE-COUNT the same orders!
 *
 * Example:
 *   You place: BUY YES @ 0.45
 *   YES order book shows: BID @ 0.45
 *   NO order book shows:  ASK @ 0.55 (same order, mirrored)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 2. SCORING FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Formula: S(v,s) = ((v-s)/v)² × size
 *
 * Variables:
 *   v = max spread from midpoint (in cents, from rewardsMaxSpread config)
 *   s = order's spread from midpoint (in cents)
 *   size = order size in shares
 *
 * Properties:
 *   - Quadratic: orders closer to midpoint score EXPONENTIALLY higher
 *   - Orders at spread = 0 (exactly at midpoint): score = size
 *   - Orders at spread = v (at max spread): score = 0
 *   - Orders beyond max spread: score = 0 (not eligible)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 3. Q_ONE AND Q_TWO (Market Sides)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The docs define two aggregate scores representing each "side" of the market:
 *
 * For a BINARY market using a single token's order book:
 *   Q_one = sum of scores for all BIDS (buy orders on that token)
 *   Q_two = sum of scores for all ASKS (sell orders on that token)
 *
 * For MULTI-OUTCOME markets, the formulas include orders across complementary
 * markets (m and m'), but for binary markets this simplifies to the above
 * since the order books are mirrored.
 *
 * The docs formula for reference (multi-outcome):
 *   Q_one = Σ S(v, spread) × BidSize_m + Σ S(v, spread) × AskSize_m'
 *   Q_two = Σ S(v, spread) × AskSize_m + Σ S(v, spread) × BidSize_m'
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 4. Q_MIN CALCULATION (Two-Sided Requirement)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Polymarket incentivizes two-sided liquidity (both bids and asks).
 *
 * If midpoint ∈ [0.10, 0.90] (normal range):
 *   Q_min = max(min(Q_one, Q_two), max(Q_one/c, Q_two/c))
 *   where c = 3.0 (scaling factor)
 *
 *   This allows SINGLE-SIDED liquidity with a 3x penalty.
 *   Example: If you only have bids (Q_one=100, Q_two=0):
 *     Q_min = max(min(100,0), max(100/3, 0/3)) = max(0, 33.33) = 33.33
 *
 * If midpoint outside [0.10, 0.90] (extreme range):
 *   Q_min = min(Q_one, Q_two)
 *
 *   STRICT two-sided requirement. Single-sided = 0 score.
 *   Rationale: At extreme prices, manipulation risk is higher.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 5. TIME-WEIGHTED SAMPLING (Why Instant ≠ API)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL: The API uses time-weighted averages, NOT instant snapshots!
 *
 * Process:
 *   1. Q scores are sampled every MINUTE using random sampling
 *   2. Q_normal = your_Q_min / Σ(all_makers_Q_min) for that sample
 *   3. Q_epoch = Σ of 10,080 samples (7 days × 24 hours × 60 minutes)
 *   4. Q_final = Q_epoch / Σ(all_makers_Q_epoch)
 *   5. Your reward = Q_final × daily_reward_pool
 *
 * Implications:
 *   - Our instant calculations will DIFFER from API-reported percentages
 *   - The API accumulates your contribution over time
 *   - New orders take time to be reflected in earning percentage
 *   - Cancelled orders take time to stop affecting your percentage
 *   - Market movements cause continuous recalculation
 *
 * Minimum payout: $1 per day. Amounts below this are not paid.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 6. API ENDPOINT (Reverse-Engineered - NOT Official)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Endpoint: https://polymarket.com/api/rewards/markets
 *
 * WARNING: This is the frontend API, not officially documented.
 * It was reverse-engineered and may change without notice.
 *
 * Key response fields:
 *   - condition_id: Market identifier
 *   - rewards_max_spread: Max spread for eligibility (cents)
 *   - rewards_min_size: Min order size for eligibility (shares)
 *   - rewards_config[].rate_per_day: Daily reward pool (USD)
 *   - market_competitiveness: Total Q_min from OTHER makers (time-weighted)
 *   - earning_percentage: Your share of rewards (requires maker_address param)
 *   - spread: Current market spread
 *
 * Caveats:
 *   - market_competitiveness is time-weighted, not instant
 *   - Values may lag real order book by minutes
 *   - The endpoint requires no authentication for public data
 *   - Adding ?maker_address=0x... returns user-specific earning_percentage
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 7. EXAMPLE CALCULATIONS (From Official Docs)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * These examples can be used to verify the implementation.
 *
 * Example 1 - Q_one calculation:
 *   Orders: 100 BID @0.49, 200 BID @0.48, 100 ASK @0.51 (on complement)
 *   Midpoint: 0.50, maxSpread: 3c
 *
 *   Scores:
 *     ((3-1)/3)² × 100 = (2/3)² × 100 = 0.4444 × 100 = 44.44
 *     ((3-2)/3)² × 200 = (1/3)² × 200 = 0.1111 × 200 = 22.22
 *     ((3-1)/3)² × 100 = (2/3)² × 100 = 0.4444 × 100 = 44.44
 *   Q_one = 44.44 + 22.22 + 44.44 = 111.11
 *
 * Example 2 - Q_two calculation:
 *   Orders: 100 BID @0.485, 100 BID @0.48 (complement), 200 ASK @0.505 (complement)
 *   Midpoint: 0.50, maxSpread: 3c
 *
 *   Scores:
 *     ((3-1.5)/3)² × 100 = (1.5/3)² × 100 = 0.25 × 100 = 25.00
 *     ((3-2)/3)² × 100 = (1/3)² × 100 = 0.1111 × 100 = 11.11
 *     ((3-0.5)/3)² × 200 = (2.5/3)² × 200 = 0.6944 × 200 = 138.89
 *   Q_two = 25.00 + 11.11 + 138.89 = 175.00
 *
 * Example 3 - Individual score verification:
 *   calculateRewardScore(1, 3, 100) should return ≈ 44.44
 *   calculateRewardScore(2, 3, 200) should return ≈ 22.22
 *   calculateRewardScore(1.5, 3, 100) should return = 25.00
 *   calculateRewardScore(0.5, 3, 200) should return ≈ 138.89
 *   calculateRewardScore(3, 3, 100) should return = 0 (at max spread)
 *   calculateRewardScore(5, 3, 100) should return = 0 (beyond max spread)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 8. MAPPING USER ORDERS TO MARKET SIDES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * When evaluating a user's open orders (which may be on either YES or NO token),
 * we need to determine which "market side" (Q_one or Q_two) each order contributes to.
 *
 * For the PRIMARY token (typically YES, first token):
 *   BUY order  → contributes to Q_one (bid side)
 *   SELL order → contributes to Q_two (ask side)
 *
 * For the SECONDARY token (typically NO, second token):
 *   BUY order  → contributes to Q_two (equivalent to SELL on primary)
 *   SELL order → contributes to Q_one (equivalent to BUY on primary)
 *
 * This mapping is necessary because orders can be placed on either token,
 * but for Q_min calculation we need to aggregate by market side.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
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
  /** Q_one: Sum of scores for all bids within max spread */
  totalBidScore: number;
  /** Q_two: Sum of scores for all asks within max spread */
  totalAskScore: number;
  /** Q_min = min(Q_one, Q_two) - this is a simple min, NOT the formula with scaling factor */
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
 * @param minSize - Optional minimum size for reward eligibility (filters out small orders)
 * @returns Total Q score breakdown
 *
 * @example
 * const result = calculateTotalQScore(orderBook.bids, orderBook.asks, 0.55, 5);
 * console.log(`Total Q_min: ${result.totalQMin}`);
 *
 * @example
 * // Filter out orders below minimum size (20 shares)
 * const result = calculateTotalQScore(orderBook.bids, orderBook.asks, 0.55, 5, 20);
 */
export function calculateTotalQScore(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  midpoint: number,
  maxSpreadCents: number,
  minSize: number = 0
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

    // Must be within max spread AND meet minimum size
    if (spreadCents < maxSpreadCents && size >= minSize) {
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

    // Must be within max spread AND meet minimum size
    if (spreadCents < maxSpreadCents && size >= minSize) {
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
 * - Two-sided liquidity if required (midpoint outside [0.10, 0.90])
 * - Size is calculated from liquidity / midpoint price
 *
 * @param rewardsDaily - Total daily reward pool in USD
 * @param marketCompetitiveness - Market competitiveness from API (total Q_min from other makers)
 * @param liquidityAmount - Amount of liquidity to deploy in USD
 * @param spreadFromMid - Assumed spread from midpoint in cents (default: half of maxSpread for reasonable estimate)
 * @param maxSpread - Maximum spread for rewards in cents
 * @param midpoint - Current market midpoint price (0-1), defaults to 0.5
 * @param minSize - Minimum order size for rewards (in shares)
 * @returns Object with estimated daily earnings and compatibility info
 *
 * @example
 * // Market with $500/day rewards, 200 competition, $100 liquidity at 2.5c spread (half of 5c max)
 * estimateDailyEarnings(500, 200, 100, 2.5, 5, 0.5, 20);
 */
export function estimateDailyEarnings(
  rewardsDaily: number,
  marketCompetitiveness: number,
  liquidityAmount: number,
  spreadFromMid: number,
  maxSpread: number,
  midpoint: number = 0.5,
  minSize: number = 0
): { earnings: number; compatible: boolean; reason?: string } {
  if (rewardsDaily <= 0 || marketCompetitiveness <= 0 || maxSpread <= 0) {
    return { earnings: 0, compatible: false, reason: "Missing reward data" };
  }

  if (midpoint <= 0 || midpoint >= 1) {
    return { earnings: 0, compatible: false, reason: "Invalid midpoint" };
  }

  // Check if two-sided liquidity is required
  const twoSidedRequired = isTwoSidedRequired(midpoint);

  // Calculate shares from liquidity
  // For YES side: shares = liquidity / yesPricePerShare
  // For NO side: shares = liquidity / noPricePerShare = liquidity / (1 - midpoint)
  // If two-sided required, split liquidity between both sides
  let yesShares: number;
  let noShares: number;

  if (twoSidedRequired) {
    // Split liquidity 50/50 between YES and NO sides
    const halfLiquidity = liquidityAmount / 2;
    yesShares = halfLiquidity / midpoint;
    noShares = halfLiquidity / (1 - midpoint);
  } else {
    // Single-sided: put all liquidity on the cheaper side for more shares
    // We'll calculate as if placing on YES side for simplicity
    yesShares = liquidityAmount / midpoint;
    noShares = 0;
  }

  // Check minSize compatibility
  // For single-sided, only yesShares needs to meet minSize
  // For two-sided, BOTH sides need to meet minSize
  if (twoSidedRequired) {
    if (yesShares < minSize || noShares < minSize) {
      const minRequired = Math.max(
        minSize * midpoint,
        minSize * (1 - midpoint)
      ) * 2; // *2 because split 50/50
      return {
        earnings: 0,
        compatible: false,
        reason: `Two-sided required: need $${minRequired.toFixed(0)} min liquidity`,
      };
    }
  } else {
    if (yesShares < minSize) {
      const minRequired = minSize * midpoint;
      return {
        earnings: 0,
        compatible: false,
        reason: `Need $${minRequired.toFixed(0)} min for ${minSize} shares`,
      };
    }
  }

  // Calculate Q scores using quadratic formula: ((v-s)/v)² × size
  const yesQScore = calculateRewardScore(spreadFromMid, maxSpread, yesShares);
  const noQScore = twoSidedRequired
    ? calculateRewardScore(spreadFromMid, maxSpread, noShares)
    : 0;

  // Calculate our effective Q_min
  let yourQScore: number;
  if (twoSidedRequired) {
    // Strict two-sided: Q_min = min(Q_one, Q_two)
    yourQScore = Math.min(yesQScore, noQScore);
  } else {
    // Single-sided allowed with 3x penalty
    // Q_min = max(min(Q_one, Q_two), max(Q_one/3, Q_two/3))
    yourQScore = calculateEffectiveScore(yesQScore, noQScore, midpoint);
  }

  // Total market Q score = market_competitiveness (other makers) + our Q score
  const totalQScore = marketCompetitiveness + yourQScore;

  // Our earning percentage
  const earningPct = calculateEarningPercentage(yourQScore, totalQScore);

  // Daily earnings
  const earnings = (earningPct / 100) * rewardsDaily;

  return { earnings, compatible: true };
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
 * @param midpoint - Current market midpoint price (0-1), defaults to 0.5
 * @returns Earning potential breakdown with compatibility info
 */
export function calculateEarningPotential(
  rewardsDaily: number,
  marketCompetitiveness: number,
  maxSpread: number,
  minSize: number,
  liquidityAmount: number = DEFAULT_ESTIMATE_LIQUIDITY,
  midpoint: number = 0.5
): {
  estimatedDailyEarnings: number;
  earningEfficiency: number;
  easeOfParticipation: number;
  totalScore: number;
  compatible: boolean;
  incompatibleReason?: string;
} {
  // Assume orders at half the max spread for a reasonable competitive position
  const assumedSpread = maxSpread / 2;
  
  // Calculate estimated daily earnings with new signature
  const result = estimateDailyEarnings(
    rewardsDaily,
    marketCompetitiveness,
    liquidityAmount,
    assumedSpread,
    maxSpread,
    midpoint,
    minSize
  );

  const estimatedDailyEarnings = result.earnings;

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
    compatible: result.compatible,
    incompatibleReason: result.reason,
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
 * Maps user orders to market sides (Q_one and Q_two):
 * - BUY on primary token (YES)  → Q_one (bid side)
 * - SELL on primary token (YES) → Q_two (ask side)
 * - BUY on secondary token (NO) → Q_two (equivalent to SELL on primary)
 * - SELL on secondary token (NO) → Q_one (equivalent to BUY on primary)
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
  let qOne = 0; // Bid side score (YES BUYs + NO SELLs)
  let qTwo = 0; // Ask side score (YES SELLs + NO BUYs)
  let hasQOne = false;
  let hasQTwo = false;

  // Determine the primary token (first token is typically YES)
  const primaryTokenId = params.tokenIds[0];

  for (const order of orders) {
    const status = evaluateOrderReward(order, params);
    orderStatuses.push(status);

    // Determine effective market side based on token and order side
    // For primary token (YES): BUY = Q_one (bid side), SELL = Q_two (ask side)
    // For secondary token (NO): BUY = Q_two (mirrored), SELL = Q_one (mirrored)
    const isPrimaryToken = order.asset_id === primaryTokenId;
    const isQOneSide =
      (isPrimaryToken && order.side === "BUY") ||
      (!isPrimaryToken && order.side === "SELL");

    if (isQOneSide) {
      qOne += status.score;
      if (status.eligible) hasQOne = true;
    } else {
      qTwo += status.score;
      if (status.eligible) hasQTwo = true;
    }
  }

  const twoSidedRequired = isTwoSidedRequired(params.midpoint);
  const effectiveScore = calculateEffectiveScore(
    qOne,
    qTwo,
    params.midpoint,
    scalingFactor
  );
  const eligible = effectiveScore > 0;

  // Build summary
  let summary: string;
  if (!eligible) {
    if (twoSidedRequired && (!hasQOne || !hasQTwo)) {
      summary = `NOT ELIGIBLE: Two-sided required (midpoint ${(params.midpoint * 100).toFixed(1)}%), but missing ${!hasQOne ? "Q_one (bid side)" : "Q_two (ask side)"}`;
    } else if (orderStatuses.every((o) => !o.eligible)) {
      summary = `NOT ELIGIBLE: All orders outside reward parameters`;
    } else {
      summary = `NOT ELIGIBLE: Unknown reason`;
    }
  } else {
    const singleSidedPenalty =
      !hasQOne || !hasQTwo
        ? ` (single-sided, /${scalingFactor} penalty applied)`
        : "";
    summary = `ELIGIBLE: Q_min = ${effectiveScore.toFixed(2)}${singleSidedPenalty}`;
  }

  return {
    market: params,
    orders: orderStatuses,
    twoSidedRequired,
    hasQOne,
    hasQTwo,
    qOne,
    qTwo,
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
