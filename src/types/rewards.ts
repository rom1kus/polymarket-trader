/**
 * Types for liquidity reward checking.
 *
 * Used by checkRewards script and reward calculation utilities.
 *
 * Terminology (from Polymarket docs):
 * - Q_one: Sum of scores for orders on the "bid side" (BUY on primary token)
 * - Q_two: Sum of scores for orders on the "ask side" (SELL on primary token)
 * - Q_min: Effective score after two-sided requirement consideration
 *
 * See src/utils/rewards.ts header for full documentation.
 */

/**
 * An open order from the CLOB API.
 */
export interface OpenOrder {
  /** Order ID */
  id: string;
  /** Token ID (asset) */
  asset_id: string;
  /** Buy or Sell side */
  side: "BUY" | "SELL";
  /** Order price as string */
  price: string;
  /** Original order size */
  original_size: string;
  /** Amount already matched */
  size_matched: string;
  /** Outcome name */
  outcome: string;
}

/**
 * Market reward parameters with current midpoint.
 * Combines Gamma API reward params with CLOB midpoint.
 */
export interface MarketRewardParamsWithMidpoint {
  /** Token ID for the market (first token if multiple) */
  tokenId: string;
  /** All token IDs for this market (YES and NO) */
  tokenIds: string[];
  /** Condition ID for the market */
  conditionId: string;
  /** Minimum order size for reward eligibility (in shares) */
  rewardsMinSize: number;
  /** Maximum spread from midpoint for rewards (in cents) */
  rewardsMaxSpread: number;
  /** Current midpoint from CLOB API (for primary token) */
  midpoint: number;
  /** Midpoint for each token (tokenId -> midpoint) */
  midpointByToken: Map<string, number>;
}

/**
 * Reward status for a single order.
 */
export interface OrderRewardStatus {
  /** Order ID */
  orderId: string;
  /** Buy or Sell side */
  side: "BUY" | "SELL";
  /** Order price */
  price: number;
  /** Remaining order size */
  size: number;
  /** Spread from midpoint in cents */
  spreadFromMid: number;
  /** Reward score (0 if not eligible) */
  score: number;
  /** Whether the order is eligible for rewards */
  eligible: boolean;
  /** Reason for ineligibility (if any) */
  reason?: string;
}

/**
 * Complete reward check result for a market.
 */
export interface RewardCheckResult {
  /** Market parameters including midpoint */
  market: MarketRewardParamsWithMidpoint;
  /** Status for each order */
  orders: OrderRewardStatus[];
  /** Whether two-sided liquidity is required (midpoint outside [0.10, 0.90]) */
  twoSidedRequired: boolean;
  /** Whether there are eligible orders contributing to Q_one */
  hasQOne: boolean;
  /** Whether there are eligible orders contributing to Q_two */
  hasQTwo: boolean;
  /**
   * Q_one: Total score from orders on the "bid side" of the market.
   * For primary token: BUY orders. For secondary token: SELL orders.
   */
  qOne: number;
  /**
   * Q_two: Total score from orders on the "ask side" of the market.
   * For primary token: SELL orders. For secondary token: BUY orders.
   */
  qTwo: number;
  /**
   * Q_min: Effective score after two-sided consideration.
   * - If midpoint in [0.10, 0.90]: max(min(Q_one, Q_two), max(Q_one/c, Q_two/c))
   * - If midpoint outside range: min(Q_one, Q_two)
   */
  effectiveScore: number;
  /** Scaling factor for single-sided penalty (c in formula, default 3.0) */
  scalingFactor: number;
  /** Overall eligibility status */
  eligible: boolean;
  /** Human-readable summary */
  summary: string;
}

/**
 * Reward check result with earning percentage comparison.
 * Extends RewardCheckResult with order book Q scores and API comparison.
 */
export interface RewardCheckResultWithEarnings extends RewardCheckResult {
  /** Condition ID for the market */
  conditionId: string;
  /**
   * Total Q_min from the order book (instant snapshot).
   * Note: This differs from API's time-weighted value.
   */
  totalQMin: number;
  /** Q_one from order book (total bid side score) */
  orderBookQOne: number;
  /** Q_two from order book (total ask side score) */
  orderBookQTwo: number;
  /** Our calculated earning percentage (instant) */
  ourEarningPct: number;
  /** API-reported earning percentage (time-weighted, undefined if not available) */
  apiEarningPct?: number;
  /** Daily reward rate for this market in USD (undefined if not available) */
  ratePerDay?: number;
}

/**
 * Market with reward parameters from Gamma API.
 * Used for finding high-reward markets.
 */
export interface MarketWithRewards {
  /** Market ID */
  id: string;
  /** Market question/title */
  question: string;
  /** Condition ID for trading */
  conditionId: string;
  /** Event slug for the parent event */
  eventSlug: string;
  /** Event title */
  eventTitle: string;
  /** Market slug */
  slug: string;
  /** Group item title (for multi-outcome events) */
  groupItemTitle?: string;
  /** CLOB token IDs (comma-separated or JSON array) */
  clobTokenIds?: string;
  /** Whether market is active */
  active: boolean;
  /** Whether market is closed */
  closed: boolean;
  /** Whether market accepts orders */
  acceptingOrders: boolean;
  /** Whether order book is enabled */
  enableOrderBook: boolean;
  /** Whether this is a negative risk market */
  negRisk?: boolean;
  /** Liquidity in USD */
  liquidityNum: number;
  /** 24h volume in USD */
  volume24hr: number;
  /** Minimum order size for reward eligibility (shares) */
  rewardsMinSize: number;
  /** Maximum spread from midpoint for rewards (cents) */
  rewardsMaxSpread: number;
  /** Current spread from order book */
  spread?: number;
  /** Competitiveness score (0-1, lower = less competition) */
  competitive?: number;
  /** Daily reward amount in USD (if available from API) */
  rewardsDaily?: number;
  /** Current midpoint price from token prices (0-1) */
  midpoint?: number;
}

/**
 * Score breakdown for market attractiveness.
 * @deprecated Use EarningPotentialScore for more meaningful ranking based on estimated earnings.
 */
export interface MarketAttractivenessScore {
  /** Overall attractiveness score (higher = better) */
  total: number;
  /** Score component from spread tolerance */
  spreadScore: number;
  /** Score component from min size requirement */
  sizeScore: number;
  /** Score component from liquidity */
  liquidityScore: number;
  /** Score component from competition (inverted) */
  competitionScore: number;
  /** Score component from daily rewards (if available) */
  rewardsScore: number;
}

/**
 * Score breakdown for market earning potential.
 * Based on actual reward mechanics and estimated daily earnings.
 */
export interface EarningPotentialScore {
  /** Estimated daily earnings in USD for a fixed liquidity amount */
  estimatedDailyEarnings: number;
  /** Earning efficiency ($/day per unit liquidity) - primary ranking metric */
  earningEfficiency: number;
  /** Ease of participation score (0-100) based on spread tolerance and min size */
  easeOfParticipation: number;
  /** Total score for ranking (earnings-weighted) */
  totalScore: number;
  /** Whether the market is compatible with the given liquidity amount */
  compatible: boolean;
  /** Reason for incompatibility (if any) */
  incompatibleReason?: string;
}

/**
 * Market with calculated attractiveness score.
 * @deprecated Use RankedMarketByEarnings for more meaningful ranking.
 */
export interface RankedMarket extends MarketWithRewards {
  /** Calculated attractiveness score breakdown */
  attractiveness: MarketAttractivenessScore;
}

/**
 * Market with calculated earning potential score.
 * Used for ranking markets by expected daily earnings.
 */
export interface RankedMarketByEarnings extends MarketWithRewards {
  /** Calculated earning potential breakdown */
  earningPotential: EarningPotentialScore;
}
