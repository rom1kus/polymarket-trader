/**
 * Order book utilities for fetching pricing data from the CLOB API.
 *
 * Provides functions to fetch order book data (best bid/ask, midpoint, spread)
 * for markets.
 */

import { ClobClient, Side } from "@polymarket/clob-client";
import type { ParsedGammaMarket } from "@/types/gamma.js";
import type { OrderBookData } from "@/types/polymarket.js";
import { getYesOutcome, getMarketTitle } from "@/utils/markets.js";
import { config } from "@/config/index.js";
import {
  calculateTotalQScore,
  type OrderBookLevel,
  type TotalQScoreResult,
} from "@/utils/rewards.js";

/**
 * Options for fetching order book data.
 */
export interface FetchOrderBookOptions {
  /** Number of markets to fetch in parallel (default: 10) */
  batchSize?: number;
  /** Progress callback called after each batch */
  onProgress?: (fetched: number, total: number) => void;
}

/**
 * Fetches order book data for a single market.
 *
 * @param client - CLOB client instance
 * @param market - Parsed Gamma market
 * @returns Order book data for the market
 */
export async function fetchOrderBookForMarket(
  client: ClobClient,
  market: ParsedGammaMarket
): Promise<OrderBookData> {
  const yesOutcome = getYesOutcome(market);
  const tokenId = yesOutcome?.tokenId;
  const gammaPrice = yesOutcome?.price ?? 0;
  const title = getMarketTitle(market);

  if (!tokenId) {
    return {
      conditionId: market.conditionId,
      title,
      bestBid: null,
      bestAsk: null,
      midpoint: null,
      spread: null,
      gammaPrice,
    };
  }

  try {
    const [bidPrice, askPrice, midpoint, spread] = await Promise.all([
      client.getPrice(tokenId, Side.BUY).catch(() => null),
      client.getPrice(tokenId, Side.SELL).catch(() => null),
      client.getMidpoint(tokenId).catch(() => null),
      client.getSpread(tokenId).catch(() => null),
    ]);

    return {
      conditionId: market.conditionId,
      title,
      bestBid: bidPrice as string | null,
      bestAsk: askPrice as string | null,
      midpoint: midpoint as string | null,
      spread: spread as string | null,
      gammaPrice,
    };
  } catch {
    return {
      conditionId: market.conditionId,
      title,
      bestBid: null,
      bestAsk: null,
      midpoint: null,
      spread: null,
      gammaPrice,
    };
  }
}

/**
 * Fetches order book data for multiple markets from the CLOB API.
 *
 * Only fetches for active markets that have token IDs.
 * Falls back to Gamma API prices if CLOB data is unavailable.
 *
 * @param client - CLOB client instance
 * @param markets - Array of parsed Gamma markets
 * @param options - Fetch options (batch size, progress callback)
 * @returns Array of order book data for active markets
 *
 * @example
 * const client = createClobClient();
 * const orderBook = await fetchOrderBookData(client, markets, {
 *   onProgress: (fetched, total) => console.log(`${fetched}/${total}`)
 * });
 */
export async function fetchOrderBookData(
  client: ClobClient,
  markets: ParsedGammaMarket[],
  options: FetchOrderBookOptions = {}
): Promise<OrderBookData[]> {
  const { batchSize = 10, onProgress } = options;
  const results: OrderBookData[] = [];

  // Filter to active markets with Yes token IDs
  const activeMarkets = markets.filter((m) => {
    const yesToken = getYesOutcome(m);
    return m.active && m.acceptingOrders && yesToken?.tokenId;
  });

  // Batch requests for better performance
  for (let i = 0; i < activeMarkets.length; i += batchSize) {
    const batch = activeMarkets.slice(i, i + batchSize);

    const batchPromises = batch.map((market) =>
      fetchOrderBookForMarket(client, market)
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Report progress
    if (onProgress) {
      onProgress(Math.min(i + batchSize, activeMarkets.length), activeMarkets.length);
    }
  }

  return results;
}

/**
 * Sorts order book data by market probability (highest first).
 *
 * @param orderBookData - Order book data array
 * @param markets - Original markets to look up probability
 * @returns Sorted order book data
 */
export function sortOrderBookByProbability(
  orderBookData: OrderBookData[],
  markets: ParsedGammaMarket[]
): OrderBookData[] {
  return [...orderBookData].sort((a, b) => {
    const aMarket = markets.find((m) => m.conditionId === a.conditionId);
    const bMarket = markets.find((m) => m.conditionId === b.conditionId);
    const aPrice = aMarket ? (getYesOutcome(aMarket)?.price ?? 0) : 0;
    const bPrice = bMarket ? (getYesOutcome(bMarket)?.price ?? 0) : 0;
    return bPrice - aPrice;
  });
}

/**
 * Raw order book response from the CLOB API.
 */
export interface RawOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  asset_id: string;
  market: string; // conditionId
  hash: string;
  timestamp: string;
  last_trade_price?: string;
  min_order_size?: string;
}

/**
 * Result of fetching order book with competition calculation.
 */
export interface OrderBookWithCompetition {
  tokenId: string;
  conditionId: string;
  midpoint: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  qScore: TotalQScoreResult;
}

/**
 * Fetches raw order book from the CLOB API (no authentication required).
 *
 * @param tokenId - Token ID to fetch order book for
 * @param fetcher - Optional fetch function for testing
 * @returns Raw order book data
 *
 * @example
 * const orderBook = await fetchRawOrderBook("1234567890...");
 * console.log(`Best bid: ${orderBook.bids[0].price}`);
 */
export async function fetchRawOrderBook(
  tokenId: string,
  fetcher: typeof fetch = fetch
): Promise<RawOrderBook | null> {
  try {
    const url = `${config.clobHost}/book?token_id=${tokenId}`;
    const response = await fetcher(url);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as RawOrderBook;
  } catch {
    return null;
  }
}

/**
 * Fetches order book and calculates real competition (Q score) from live data.
 *
 * This is more accurate than the API's market_competitiveness field which
 * appears to be stale or calculated differently.
 *
 * @param tokenId - Token ID to fetch order book for
 * @param midpoint - Market midpoint price (0-1)
 * @param maxSpreadCents - Maximum spread for rewards (in cents)
 * @param minSize - Minimum order size for rewards (in shares)
 * @param fetcher - Optional fetch function for testing
 * @returns Order book with calculated Q score, or null if fetch failed
 *
 * @example
 * const result = await fetchOrderBookWithCompetition(
 *   "1234567890...",
 *   0.55,  // 55% midpoint
 *   4.5,   // 4.5 cents max spread
 *   50     // 50 shares min size
 * );
 * console.log(`Real competition: ${result.qScore.totalQMin}`);
 */
export async function fetchOrderBookWithCompetition(
  tokenId: string,
  midpoint: number,
  maxSpreadCents: number,
  minSize: number,
  fetcher: typeof fetch = fetch
): Promise<OrderBookWithCompetition | null> {
  const orderBook = await fetchRawOrderBook(tokenId, fetcher);

  if (!orderBook) {
    return null;
  }

  const qScore = calculateTotalQScore(
    orderBook.bids,
    orderBook.asks,
    midpoint,
    maxSpreadCents,
    minSize
  );

  return {
    tokenId,
    conditionId: orderBook.market,
    midpoint,
    bids: orderBook.bids,
    asks: orderBook.asks,
    qScore,
  };
}

/**
 * Options for batch fetching order books with competition.
 */
export interface FetchCompetitionOptions {
  /** Number of markets to fetch in parallel (default: 10) */
  batchSize?: number;
  /** Progress callback called after each batch */
  onProgress?: (fetched: number, total: number) => void;
  /** Optional fetch function for testing */
  fetcher?: typeof fetch;
}

/**
 * Market info required for fetching competition.
 */
export interface MarketForCompetition {
  tokenId: string;
  conditionId: string;
  midpoint: number;
  maxSpreadCents: number;
  minSize: number;
}

/**
 * Fetches order books and calculates real competition for multiple markets.
 *
 * Batches requests to avoid overwhelming the API.
 *
 * @param markets - Array of markets to fetch competition for
 * @param options - Fetch options (batch size, progress callback)
 * @returns Map of conditionId to Q score result
 *
 * @example
 * const competitionMap = await fetchBatchCompetition(markets, {
 *   batchSize: 20,
 *   onProgress: (fetched, total) => console.log(`${fetched}/${total}`)
 * });
 * const realCompetition = competitionMap.get(market.conditionId)?.totalQMin ?? 0;
 */
export async function fetchBatchCompetition(
  markets: MarketForCompetition[],
  options: FetchCompetitionOptions = {}
): Promise<Map<string, TotalQScoreResult>> {
  const { batchSize = 10, onProgress, fetcher = fetch } = options;
  const results = new Map<string, TotalQScoreResult>();

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    const batchPromises = batch.map(async (market) => {
      const result = await fetchOrderBookWithCompetition(
        market.tokenId,
        market.midpoint,
        market.maxSpreadCents,
        market.minSize,
        fetcher
      );
      return { conditionId: market.conditionId, result };
    });

    const batchResults = await Promise.all(batchPromises);

    for (const { conditionId, result } of batchResults) {
      if (result) {
        results.set(conditionId, result.qScore);
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, markets.length), markets.length);
    }
  }

  return results;
}
