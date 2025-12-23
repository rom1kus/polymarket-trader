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
