/**
 * Shared types for trading strategies.
 *
 * These types are used across different strategy implementations.
 */

import type { TickSize } from "@polymarket/clob-client";

/**
 * Base configuration for any strategy
 */
export interface StrategyConfig {
  /** Strategy name for identification */
  name: string;
  /** Whether the strategy is enabled */
  enabled: boolean;
}

/**
 * Market parameters required for trading and CTF operations.
 *
 * These parameters can be obtained using the `selectMarket` script:
 * ```
 * npm run selectMarket -- <event-slug-or-url>
 * ```
 */
export interface MarketParams {
  /** YES token ID (first outcome) - for buy/sell YES */
  yesTokenId: string;
  /** NO token ID (second outcome) - for buy/sell NO */
  noTokenId: string;
  /**
   * Condition ID for CTF operations (split/merge/redeem).
   * This is the parent condition that both YES and NO tokens derive from.
   */
  conditionId: string;
  /** Minimum price increment for the market */
  tickSize: TickSize;
  /** Whether this is a negative risk market (multi-outcome) */
  negRisk: boolean;
  /** Minimum order size in shares (from rewardsMinSize) */
  minOrderSize: number;
  /** Maximum spread from midpoint for reward eligibility (in cents) */
  maxSpread: number;
  /** Daily reward pool in USD (for actual earnings calculation) */
  rewardsDaily?: number;
}
