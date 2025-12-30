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
  /** Token ID for the market */
  tokenId: string;
  /** Minimum order size for reward eligibility (in shares) */
  rewardsMinSize: number;
  /** Maximum spread from midpoint for rewards (in cents) */
  rewardsMaxSpread: number;
  /** Current midpoint from CLOB API */
  midpoint: number;
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
