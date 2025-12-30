/**
 * Configuration for the market maker strategy.
 *
 * Edit this file to configure the market and strategy parameters.
 */

import type { MarketMakerConfig } from "./types.js";
import type { MarketParams } from "@/types/strategy.js";

/**
 * Default strategy parameters.
 * These can be overridden when creating a config.
 */
export const DEFAULT_STRATEGY_PARAMS = {
  /** Size per order in shares */
  orderSize: 10,
  /** Quote at 50% of max spread from midpoint (closer = more rewards) */
  spreadPercent: 0.5,
  /** Refresh quotes every 30 seconds */
  refreshIntervalMs: 30_000,
  /** Rebalance if midpoint moves by 0.5 cents */
  rebalanceThreshold: 0.005,
} as const;

/**
 * Creates a market maker configuration.
 *
 * @param market - Market parameters (token ID, tick size, etc.)
 * @param overrides - Optional overrides for default strategy parameters
 * @returns Complete market maker configuration
 *
 * @example
 * const config = createMarketMakerConfig({
 *   tokenId: "71321...",
 *   tickSize: "0.01",
 *   negRisk: false,
 *   minOrderSize: 5,
 *   maxSpread: 3,
 * });
 */
export function createMarketMakerConfig(
  market: MarketParams,
  overrides?: Partial<Omit<MarketMakerConfig, "market">>
): MarketMakerConfig {
  return {
    market,
    orderSize: overrides?.orderSize ?? DEFAULT_STRATEGY_PARAMS.orderSize,
    spreadPercent: overrides?.spreadPercent ?? DEFAULT_STRATEGY_PARAMS.spreadPercent,
    refreshIntervalMs: overrides?.refreshIntervalMs ?? DEFAULT_STRATEGY_PARAMS.refreshIntervalMs,
    rebalanceThreshold: overrides?.rebalanceThreshold ?? DEFAULT_STRATEGY_PARAMS.rebalanceThreshold,
  };
}

// =============================================================================
// MARKET CONFIGURATION
// =============================================================================
// Edit this section to configure the market you want to make markets on.
// You can get market data using: npm run getEvent -- <event-slug>
// =============================================================================

/**
 * The market to provide liquidity for.
 *
 * To find these values:
 * 1. Run: npm run getEvent -- <event-slug-or-url>
 * 2. Look for the token ID in the detailed output
 * 3. Check the market's tick size and whether it's negRisk
 */
export const MARKET_CONFIG: MarketParams = {
  // Trump/Netanyahu Event - "ISIS" market
  // Will Trump say "ISIS" during the Netanyahu meeting on Dec 29, 2025?
  tokenId: "7571086539767038280082354847097805299113400214070193326451269217051324225887",

  // Tick size - minimum price increment (from Gamma API)
  tickSize: "0.01",

  // Not a negative risk market (independent Yes/No)
  negRisk: false,

  // Minimum order size for rewards eligibility (from rewardsMinSize)
  minOrderSize: 20,

  // Maximum spread from midpoint for reward eligibility (from rewardsMaxSpread)
  maxSpread: 4.5,
};

/**
 * Strategy parameter overrides.
 */
export const STRATEGY_OVERRIDES: Partial<Omit<MarketMakerConfig, "market">> = {
  // 25 shares per side (above 20 minimum for rewards)
  orderSize: 25,
  // Quote at 50% of max spread (2.25c from midpoint)
  spreadPercent: 0.5,
  // Refresh every 30 seconds
  refreshIntervalMs: 30_000,
};

/**
 * Final configuration used by the market maker.
 */
export const CONFIG = createMarketMakerConfig(MARKET_CONFIG, STRATEGY_OVERRIDES);
