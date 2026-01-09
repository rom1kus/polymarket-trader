/**
 * Configuration for the market maker strategy.
 *
 * Edit this file to configure the market and strategy parameters.
 *
 * To generate market configuration, run:
 *   npm run selectMarket -- <event-slug-or-url>
 */

import type { MarketMakerConfig, InventoryConfig, WebSocketConfig, PositionLimitsConfig } from "./types.js";
import type { MarketParams } from "@/types/strategy.js";

/**
 * Default inventory management parameters.
 */
export const DEFAULT_INVENTORY_PARAMS: InventoryConfig = {
  /**
   * Minimum tokens per side before warning/auto-split.
   * The effective minimum will be max(this, market.minOrderSize).
   */
  minTokenBalance: 25,
  /** Auto-split USDC when token balance falls below minimum */
  autoSplitEnabled: true,
  /** Keep 20% extra USDC as buffer for buy orders */
  usdcReserveMultiplier: 1.2,
};

/**
 * Default position limits for risk management.
 */
export const DEFAULT_POSITION_LIMITS: PositionLimitsConfig = {
  /**
   * Maximum net exposure (|yesTokens - noTokens|) before blocking one side.
   * E.g., 100 means stop buying YES when netExposure > 100,
   * and stop selling YES when netExposure < -100.
   */
  maxNetExposure: 10,
  /**
   * Warning threshold as percentage of max (0-1).
   * E.g., 0.8 means warn when at 80% of limit.
   */
  warnThreshold: 0.8,
};

/**
 * Default WebSocket configuration.
 */
export const DEFAULT_WEBSOCKET_PARAMS: WebSocketConfig = {
  /** Enable WebSocket for real-time price updates */
  enabled: true,
  /** Trailing debounce delay before rebalancing (ms) */
  debounceMs: 50,
  /** Fallback polling interval when WebSocket disconnected (ms) */
  fallbackPollingMs: 30_000,
  /** Ping interval to keep connection alive (ms) */
  pingIntervalMs: 10_000,
  /** Initial reconnect delay (ms) */
  reconnectDelayMs: 1_000,
  /** Maximum reconnect delay (ms) */
  maxReconnectDelayMs: 30_000,
};

/**
 * Default strategy parameters.
 * These can be overridden when creating a config.
 */
export const DEFAULT_STRATEGY_PARAMS = {
  /** Size per order in shares */
  orderSize: 10,
  /** Quote at 50% of max spread from midpoint (closer = more rewards) */
  spreadPercent: 0.5,
  /** Refresh quotes every 30 seconds (used when WebSocket is disabled) */
  refreshIntervalMs: 30_000,
  /** Rebalance if midpoint moves by 0.5 cents */
  rebalanceThreshold: 0.005,
  /** Inventory management settings */
  inventory: DEFAULT_INVENTORY_PARAMS,
  /** Position limits for risk management */
  positionLimits: DEFAULT_POSITION_LIMITS,
  /** WebSocket configuration */
  webSocket: DEFAULT_WEBSOCKET_PARAMS,
  /** Dry run mode - ENABLED BY DEFAULT FOR SAFETY */
  dryRun: true,
} as const;

/**
 * Creates a market maker configuration.
 *
 * @param market - Market parameters (token IDs, condition, tick size, etc.)
 * @param overrides - Optional overrides for default strategy parameters
 * @returns Complete market maker configuration
 *
 * @example
 * const config = createMarketMakerConfig({
 *   yesTokenId: "12345...",
 *   noTokenId: "67890...",
 *   conditionId: "0xabc...",
 *   tickSize: "0.01",
 *   negRisk: false,
 *   minOrderSize: 20,
 *   maxSpread: 4.5,
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
    inventory: overrides?.inventory ?? DEFAULT_STRATEGY_PARAMS.inventory,
    positionLimits: overrides?.positionLimits ?? DEFAULT_STRATEGY_PARAMS.positionLimits,
    webSocket: {
      ...DEFAULT_WEBSOCKET_PARAMS,
      ...overrides?.webSocket,
    },
    dryRun: overrides?.dryRun ?? DEFAULT_STRATEGY_PARAMS.dryRun,
  };
}

// =============================================================================
// MARKET CONFIGURATION
// =============================================================================
// Generate this configuration by running:
//   npm run selectMarket -- <event-slug-or-url>
//
// Example:
//   npm run selectMarket -- trump-netanyahu-meeting
// =============================================================================

/**
 * The market to provide liquidity for.
 *
 * IMPORTANT: Use 'npm run selectMarket' to generate these values.
 * Do not manually fill in token IDs as errors can cause loss of funds.
 */
export const MARKET_CONFIG: MarketParams = {
  // =========================================================================
  // TODO: Run 'npm run selectMarket -- <event-slug>' to generate this config
  // =========================================================================

  // YES token ID (first outcome)
  yesTokenId: "YOUR_YES_TOKEN_ID_HERE",

  // NO token ID (second outcome)
  noTokenId: "YOUR_NO_TOKEN_ID_HERE",

  // Condition ID for CTF operations (split/merge)
  conditionId: "YOUR_CONDITION_ID_HERE",

  // Tick size - minimum price increment
  tickSize: "0.01",

  // Not a negative risk market (binary Yes/No)
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
  // 20 shares per side (above 20 minimum for rewards)
  orderSize: 20,

  // Quote at 50% of max spread (e.g., 2.25c from midpoint if maxSpread=4.5)
  spreadPercent: 0.5,

  // Refresh every 30 seconds (fallback when WebSocket is disabled)
  refreshIntervalMs: 30_000,

  // Inventory management
  inventory: {
    minTokenBalance: 20,
    autoSplitEnabled: true,
    usdcReserveMultiplier: 1.2,
  },

  // Position limits for risk management
  positionLimits: {
    maxNetExposure: 10,  // Stop quoting one side at ±100 token exposure
    warnThreshold: 0.8,   // Warn at 80% of limit
  },

  // WebSocket configuration (real-time price updates)
  webSocket: {
    enabled: true,
    debounceMs: 50,           // 50ms trailing debounce
    fallbackPollingMs: 30_000, // Fall back to 30s polling if WS disconnects
    pingIntervalMs: 10_000,
    reconnectDelayMs: 1_000,
    maxReconnectDelayMs: 30_000,
  },

  // =========================================================================
  // DRY RUN MODE - Set to false for LIVE trading
  // =========================================================================
  // When true: Orders are simulated, splits are logged but not executed
  // When false: Real orders placed, real USDC split into tokens
  dryRun: true,
};

/**
 * Final configuration used by the market maker.
 */
export const CONFIG = createMarketMakerConfig(MARKET_CONFIG, STRATEGY_OVERRIDES);
