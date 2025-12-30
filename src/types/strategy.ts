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
 * Market parameters required for trading
 */
export interface MarketParams {
  /** Token ID for the outcome to trade (e.g., Yes token ID) */
  tokenId: string;
  /** Minimum price increment for the market */
  tickSize: TickSize;
  /** Whether this is a negative risk market */
  negRisk: boolean;
  /** Minimum order size in shares */
  minOrderSize: number;
  /** Maximum spread from midpoint for reward eligibility (in cents) */
  maxSpread: number;
}
