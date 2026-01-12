/**
 * Types for liquidity reward checking.
 *
 * Used by checkRewards script and reward calculation utilities.
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
  /** Whether two-sided liquidity is required */
  twoSidedRequired: boolean;
  /** Whether there are eligible buy orders */
  hasBuySide: boolean;
  /** Whether there are eligible sell orders */
  hasSellSide: boolean;
  /** Total score from buy orders */
  totalBuyScore: number;
  /** Total score from sell orders */
  totalSellScore: number;
  /** Effective score after two-sided consideration */
  effectiveScore: number;
  /** Scaling factor for single-sided penalty */
  scalingFactor: number;
  /** Overall eligibility status */
  eligible: boolean;
  /** Human-readable summary */
  summary: string;
}

/**
 * Reward check result with earning percentage comparison.
 * Extends RewardCheckResult with order book Q_min and API comparison.
 */
export interface RewardCheckResultWithEarnings extends RewardCheckResult {
  /** Condition ID for the market */
  conditionId: string;
  /** Total Q_min from the order book (min of bid/ask scores) */
  totalQMin: number;
  /** Total bid score from order book */
  orderBookBidScore: number;
  /** Total ask score from order book */
  orderBookAskScore: number;
  /** Our calculated earning percentage */
  ourEarningPct: number;
  /** API-reported earning percentage (undefined if not available) */
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
}

/**
 * Score breakdown for market attractiveness.
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
 * Market with calculated attractiveness score.
 */
export interface RankedMarket extends MarketWithRewards {
  /** Calculated attractiveness score breakdown */
  attractiveness: MarketAttractivenessScore;
}
