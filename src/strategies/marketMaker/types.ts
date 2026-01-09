/**
 * Types specific to the market maker strategy.
 */

import type { MarketParams } from "@/types/strategy.js";
import type { InventoryConfig } from "@/types/inventory.js";
import type { PositionLimitsConfig } from "@/types/fills.js";

// Re-export for convenience
export type { InventoryConfig } from "@/types/inventory.js";
export type { PositionLimitsConfig } from "@/types/fills.js";

/**
 * WebSocket configuration options.
 */
export interface WebSocketConfig {
  /**
   * Enable WebSocket for real-time price updates.
   * When enabled, the strategy uses WebSocket for midpoint updates instead of polling.
   * Falls back to polling if WebSocket disconnects.
   * @default true
   */
  enabled: boolean;

  /**
   * Trailing debounce delay in milliseconds before rebalancing.
   * Waits until no new midpoint updates for this duration before triggering rebalance.
   * Lower values = faster reaction, higher values = less order churn.
   * @default 50
   */
  debounceMs: number;

  /**
   * Fallback polling interval when WebSocket is disconnected (in milliseconds).
   * Used as a safety net when WebSocket is unavailable.
   * @default 30000
   */
  fallbackPollingMs: number;

  /**
   * Ping interval to keep WebSocket connection alive (in milliseconds).
   * @default 10000
   */
  pingIntervalMs: number;

  /**
   * Initial reconnect delay in milliseconds (uses exponential backoff).
   * @default 1000
   */
  reconnectDelayMs: number;

  /**
   * Maximum reconnect delay in milliseconds.
   * @default 30000
   */
  maxReconnectDelayMs: number;
}

/**
 * Configuration for the market maker strategy.
 */
export interface MarketMakerConfig {
  /** Market parameters (tokens, condition, tick size, etc.) */
  market: MarketParams;
  /** Size per order in shares */
  orderSize: number;
  /** Spread as percentage of maxSpread (0-1, e.g., 0.5 = 50%) */
  spreadPercent: number;
  /** How often to refresh quotes in milliseconds (used when WebSocket is disabled) */
  refreshIntervalMs: number;
  /** Midpoint change threshold to trigger rebalance (e.g., 0.005 = 0.5 cents) */
  rebalanceThreshold: number;
  /** Inventory management settings */
  inventory: InventoryConfig;
  /** Position limits for risk management */
  positionLimits: PositionLimitsConfig;
  /** WebSocket configuration for real-time price updates */
  webSocket: WebSocketConfig;
  /**
   * Dry run mode - simulate without placing real orders or executing splits.
   * Set to true for safe testing.
   */
  dryRun: boolean;
}

/**
 * A single quote level (bid or ask)
 */
export interface QuoteLevel {
  side: "BUY" | "SELL";
  price: number;
  size: number;
}

/**
 * Generated quotes for market making
 */
export interface Quotes {
  bid: QuoteLevel;
  ask: QuoteLevel;
  midpoint: number;
}

/**
 * Tracks currently active orders
 */
export interface ActiveQuotes {
  bid: { orderId: string; price: number } | null;
  ask: { orderId: string; price: number } | null;
  lastMidpoint: number;
}

/**
 * State of the market maker
 */
export interface MarketMakerState {
  running: boolean;
  activeQuotes: ActiveQuotes;
  cycleCount: number;
  lastError: string | null;
}
