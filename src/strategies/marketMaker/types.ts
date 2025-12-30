/**
 * Types specific to the market maker strategy.
 */

import type { MarketParams } from "@/types/strategy.js";

/**
 * Configuration for the market maker strategy
 */
export interface MarketMakerConfig {
  /** Market parameters (token, tick size, etc.) */
  market: MarketParams;
  /** Size per order in shares */
  orderSize: number;
  /** Spread as percentage of maxSpread (0-1, e.g., 0.5 = 50%) */
  spreadPercent: number;
  /** How often to refresh quotes in milliseconds */
  refreshIntervalMs: number;
  /** Midpoint change threshold to trigger rebalance (e.g., 0.005 = 0.5 cents) */
  rebalanceThreshold: number;
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
