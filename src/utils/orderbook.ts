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
