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
  // Token ID for the outcome to trade (e.g., "Yes" token)
  // Get this from: npm run getEvent -- <event-slug>
  tokenId: "YOUR_TOKEN_ID_HERE",

  // Tick size - minimum price increment
  // Common values: "0.01" (1 cent), "0.001" (0.1 cent)
  tickSize: "0.01",

  // Whether this is a negative risk market
  // Multi-outcome events (like "Who will win?") are typically negRisk: true
  // Simple Yes/No markets are typically negRisk: false
  negRisk: false,

  // Minimum order size in shares
  minOrderSize: 5,

  // Maximum spread from midpoint for reward eligibility (in cents)
  // Most markets use 3 cents, but check the order book on Polymarket
  maxSpread: 3,
};

/**
 * Strategy parameter overrides (optional).
 * Uncomment and modify to override defaults.
 */
export const STRATEGY_OVERRIDES: Partial<Omit<MarketMakerConfig, "market">> = {
  // orderSize: 20,           // Place 20 shares per side
  // spreadPercent: 0.3,      // Quote at 30% of max spread (tighter, more rewards)
  // refreshIntervalMs: 60_000, // Refresh every 60 seconds
  // rebalanceThreshold: 0.01,  // Rebalance if midpoint moves 1 cent
};

/**
 * Final configuration used by the market maker.
 */
export const CONFIG = createMarketMakerConfig(MARKET_CONFIG, STRATEGY_OVERRIDES);
