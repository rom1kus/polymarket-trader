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
