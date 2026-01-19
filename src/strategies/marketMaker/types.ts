/**
 * Types specific to the market maker strategy.
 */

import type { MarketParams } from "@/types/strategy.js";
import type { PositionLimitsConfig } from "@/types/fills.js";

// Re-export for convenience
export type { PositionLimitsConfig } from "@/types/fills.js";

/**
 * Configuration for automatic merging of neutral positions.
 *
 * When enabled, the strategy will automatically merge equal amounts of
 * YES + NO tokens back into USDC, freeing up locked capital for trading.
 */
export interface MergeConfig {
  /**
   * Enable automatic merging of neutral positions.
   * When true, neutral positions are merged before placing orders.
   * @default true
   */
  enabled: boolean;

  /**
   * Minimum neutral position to trigger merge.
   * Neutral position = min(yesTokens, noTokens).
   * Set to 0 to merge any neutral position.
   * @default 0
   */
  minMergeAmount: number;
}

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
 *
 * The strategy operates in USDC-only mode - it places BUY orders on both
 * YES and NO tokens rather than holding tokens upfront.
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
  /** Position limits for risk management */
  positionLimits: PositionLimitsConfig;
  /** WebSocket configuration for real-time price updates */
  webSocket: WebSocketConfig;
  /** Merge configuration for automatic neutral position consolidation */
  merge: MergeConfig;
  /**
   * Dry run mode - simulate without placing real orders.
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
 * Generated quotes for market making.
 *
 * The strategy places BUY orders on both YES and NO tokens:
 * - yesQuote: BUY YES at (midpoint - offset)
 * - noQuote: BUY NO at (1 - (midpoint + offset)) - mirrored price
 *
 * This is economically equivalent to the old bid/ask approach but
 * doesn't require holding YES/NO tokens upfront - only USDC.
 */
export interface Quotes {
  /** BUY YES order at bid price */
  yesQuote: QuoteLevel;
  /** BUY NO order at mirrored ask price */
  noQuote: QuoteLevel;
  midpoint: number;
}

/**
 * Tracks currently active orders.
 *
 * Both orders are BUY orders on different tokens:
 * - yesQuote: BUY YES order
 * - noQuote: BUY NO order
 */
export interface ActiveQuotes {
  yesQuote: { orderId: string; price: number } | null;
  noQuote: { orderId: string; price: number } | null;
  lastMidpoint: number;
}

/**
 * Session statistics for tracking trading activity.
 */
export interface SessionStats {
  /** Start time of the session */
  startTime: number;
  /** Number of fills received this session */
  fillCount: number;
  /** Total volume traded (buys + sells) */
  totalVolume: number;
  /** Number of merges performed this session */
  mergeCount: number;
  /** Total amount of tokens merged (USDC freed) */
  totalMerged: number;
  /** Number of rebalances performed */
  rebalanceCount: number;
  /** Number of orders placed */
  ordersPlaced: number;
  /** Number of orders cancelled */
  ordersCancelled: number;
}

/**
 * State of the market maker
 */
export interface MarketMakerState {
  running: boolean;
  activeQuotes: ActiveQuotes;
  cycleCount: number;
  lastError: string | null;
  /** Session statistics for shutdown summary */
  stats: SessionStats;
}

// =============================================================================
// Orchestrator Integration Types
// =============================================================================

/**
 * Reason why the market maker stopped.
 * Used by the orchestrator to determine next action.
 */
export type MarketMakerExitReason =
  | "neutral"   // Position reached market-neutral state (netExposure === 0)
  | "shutdown"  // User-initiated shutdown (SIGINT/SIGTERM)
  | "error"     // Unrecoverable error
  | "timeout";  // Timeout waiting for condition (future use)

/**
 * Result returned when market maker exits.
 * Used by the orchestrator to make switching decisions.
 */
export interface MarketMakerResult {
  /** Why the market maker stopped */
  reason: MarketMakerExitReason;

  /**
   * Final position state (if available).
   * Contains yesTokens, noTokens, netExposure, neutralPosition.
   */
  finalPosition?: {
    yesTokens: number;
    noTokens: number;
    netExposure: number;
    neutralPosition: number;
  };

  /** Error details (if reason === "error") */
  error?: Error;

  /** Session statistics */
  stats?: SessionStats;
}

/**
 * Position state passed to orchestrator callbacks.
 */
export interface PositionSnapshot {
  yesTokens: number;
  noTokens: number;
  netExposure: number;
  neutralPosition: number;
}

/**
 * Extended configuration for market maker when run by orchestrator.
 * Adds options for orchestrator integration.
 */
export interface OrchestratableMarketMakerConfig extends MarketMakerConfig {
  /**
   * Callback when neutral position is detected (for logging/notification).
   * Called during rebalance cycle when netExposure === 0 && neutralPosition > 0.
   */
  onNeutralPosition?: (position: PositionSnapshot) => void;

  /**
   * Called after each fill to check if orchestrator wants to switch markets.
   * Returns true if market maker should stop (pending switch is ready).
   * The orchestrator sets this to check: pendingSwitch exists AND currently neutral.
   */
  onCheckPendingSwitch?: (position: PositionSnapshot) => boolean;
}
