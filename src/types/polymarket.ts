/**
 * Custom Polymarket types not exported by @polymarket/clob-client
 *
 * These types supplement the library-exported types (Token, Chain, PaginationPayload, etc.)
 * for API responses where the library uses `any` or doesn't provide specific types.
 */

import type { Token, PaginationPayload } from "@polymarket/clob-client";

/**
 * Market data from CLOB API.
 * Not exported by @polymarket/clob-client - their getMarkets() returns PaginationPayload with data: any[]
 */
export interface Market {
  condition_id: string;
  question: string;
  description?: string;
  tokens: Token[];
  active: boolean;
  closed: boolean;
  end_date_iso?: string;
}

/**
 * Response from getMarkets() with properly typed Market data.
 * Extends PaginationPayload but replaces the `any[]` data with `Market[]`
 */
export interface MarketsResponse extends Omit<PaginationPayload, "data"> {
  data: Market[];
}

/**
 * Order book pricing data for a market.
 * Combines CLOB order book data with Gamma API fallback prices.
 */
export interface OrderBookData {
  /** Condition ID for the market */
  conditionId: string;
  /** Market title (groupItemTitle or question) */
  title: string;
  /** Best bid price from CLOB (null if unavailable) */
  bestBid: string | null;
  /** Best ask price from CLOB (null if unavailable) */
  bestAsk: string | null;
  /** Midpoint price from CLOB (null if unavailable) */
  midpoint: string | null;
  /** Spread from CLOB (null if unavailable) */
  spread: string | null;
  /** Fallback price from Gamma API (always available) */
  gammaPrice: number;
}

/**
 * Price snapshot at a specific point in time.
 * Returned by CLOB /prices-history endpoint.
 */
export interface PriceSnapshot {
  /** Unix timestamp in seconds */
  t: number;
  /** Price at this timestamp */
  p: number;
}

/**
 * Volatility metrics calculated from price history.
 */
export interface VolatilityMetrics {
  /** Percentage change from first to last price (e.g., 0.15 = 15%) */
  priceChangePercent: number;
  /** Largest single move between consecutive points (e.g., 0.08 = 8%) */
  maxMove: number;
  /** Time window analyzed in minutes */
  timeWindowMinutes: number;
  /** Number of data points analyzed */
  dataPoints: number;
}

/**
 * Thresholds for determining if a market is too volatile.
 */
export interface VolatilityThresholds {
  /** Maximum allowed price change percentage (e.g., 0.15 = 15%) */
  maxPriceChangePercent: number;
  /** Time window to analyze in minutes (e.g., 10) */
  lookbackMinutes: number;
}

/**
 * Price history response from CLOB API /prices-history endpoint.
 */
export interface PriceHistoryResponse {
  history: PriceSnapshot[];
}
