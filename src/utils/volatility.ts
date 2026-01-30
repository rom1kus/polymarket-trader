/**
 * Market volatility detection utilities.
 *
 * This module provides functions to fetch historical price data from the CLOB API
 * and calculate volatility metrics to filter out markets with excessive price movement.
 *
 * Primary use case: Prevent adverse selection by avoiding volatile markets during
 * market discovery (proactive approach as recommended in FINDINGS.md).
 */

import type {
  PriceSnapshot,
  PriceHistoryResponse,
  VolatilityMetrics,
  VolatilityThresholds,
} from "../types/polymarket.js";
import { config } from "../config/index.js";
import { log } from "./helpers.js";

/**
 * Fetches historical price data for a token from the CLOB API.
 *
 * @param tokenId - The CLOB token ID to fetch price history for
 * @param interval - Time interval ("1h", "6h", "1d", "1w", "max")
 * @param fetcher - Optional fetch function (for testing)
 * @returns Array of price snapshots sorted by timestamp (oldest first)
 *
 * @example
 * ```typescript
 * const history = await fetchPriceHistory(tokenId, "1h");
 * // Returns last hour of price data
 * ```
 */
export async function fetchPriceHistory(
  tokenId: string,
  interval: "1h" | "6h" | "1d" | "1w" | "max" = "1h",
  fetcher: typeof fetch = fetch
): Promise<PriceSnapshot[]> {
  const url = new URL(`${config.clobHost}/prices-history`);
  url.searchParams.set("market", tokenId);
  url.searchParams.set("interval", interval);

  const response = await fetcher(url.toString());

  if (!response.ok) {
    throw new Error(
      `Failed to fetch price history: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as PriceHistoryResponse;

  // Sort by timestamp (oldest first) for consistent processing
  return data.history.sort((a: PriceSnapshot, b: PriceSnapshot) => a.t - b.t);
}

/**
 * Calculates volatility metrics from price history.
 *
 * Analyzes price movement to determine if a market is experiencing
 * excessive volatility that could lead to adverse selection.
 *
 * @param priceHistory - Array of price snapshots (must be sorted by timestamp)
 * @param windowMinutes - Time window to analyze (filters recent data from history)
 * @returns Volatility metrics including price change %, max move, etc.
 *
 * @throws Error if insufficient data points (< 2)
 *
 * @example
 * ```typescript
 * const history = await fetchPriceHistory(tokenId, "1h");
 * const metrics = calculatePriceVolatility(history, 10); // Last 10 minutes
 * if (metrics.priceChangePercent > 0.15) {
 *   console.log("High volatility detected!");
 * }
 * ```
 */
export function calculatePriceVolatility(
  priceHistory: PriceSnapshot[],
  windowMinutes: number = 10
): VolatilityMetrics {
  if (priceHistory.length < 2) {
    throw new Error(
      `Need at least 2 price points to calculate volatility, got ${priceHistory.length}`
    );
  }

  // Filter to recent window (convert minutes to seconds)
  const windowSeconds = windowMinutes * 60;
  const now = Date.now() / 1000; // Current time in seconds
  const cutoffTime = now - windowSeconds;

  const recentHistory = priceHistory.filter((point) => point.t >= cutoffTime);

  if (recentHistory.length < 2) {
    throw new Error(
      `Need at least 2 price points in the ${windowMinutes}-minute window, got ${recentHistory.length}`
    );
  }

  // Calculate overall price change (first to last)
  const firstPrice = recentHistory[0].p;
  const lastPrice = recentHistory[recentHistory.length - 1].p;
  const priceChangePercent = Math.abs((lastPrice - firstPrice) / firstPrice);

  // Calculate largest single move between consecutive points
  let maxMove = 0;
  for (let i = 1; i < recentHistory.length; i++) {
    const move = Math.abs(
      (recentHistory[i].p - recentHistory[i - 1].p) / recentHistory[i - 1].p
    );
    maxMove = Math.max(maxMove, move);
  }

  // Calculate actual time window covered
  const actualWindowMinutes =
    (recentHistory[recentHistory.length - 1].t - recentHistory[0].t) / 60;

  return {
    priceChangePercent,
    maxMove,
    timeWindowMinutes: actualWindowMinutes,
    dataPoints: recentHistory.length,
  };
}

/**
 * Determines if a market is safe to trade based on volatility thresholds.
 *
 * Fetches price history and calculates volatility metrics. Returns false
 * if the market exceeds the volatility threshold, indicating it's too
 * dangerous for market making (risk of adverse selection).
 *
 * @param tokenId - The CLOB token ID to check
 * @param thresholds - Volatility thresholds configuration
 * @param fetcher - Optional fetch function (for testing)
 * @returns true if market is safe (low volatility), false if too volatile
 *
 * @throws Error if price history fetch fails or insufficient data
 *
 * @example
 * ```typescript
 * const thresholds = {
 *   maxPriceChangePercent: 0.10,  // 10% max change (conservative)
 *   lookbackMinutes: 10,
 * };
 *
 * const safe = await isMarketSafe(tokenId, thresholds);
 * if (!safe) {
 *   console.log("Market filtered due to high volatility");
 * }
 * ```
 */
export async function isMarketSafe(
  tokenId: string,
  thresholds: VolatilityThresholds,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  try {
    // Fetch 1 hour of price history (provides buffer for analysis)
    const history = await fetchPriceHistory(tokenId, "1h", fetcher);

    // Calculate volatility for the specified lookback window
    const metrics = calculatePriceVolatility(
      history,
      thresholds.lookbackMinutes
    );

    // Market is safe if price change is within threshold
    return metrics.priceChangePercent <= thresholds.maxPriceChangePercent;
  } catch (error) {
    // On any error (API failure, insufficient data), consider market unsafe
    // This is a conservative approach per user's requirement (skip on error)
    throw error; // Re-throw to let caller handle logging
  }
}

/**
 * Checks volatility for a market with detailed logging.
 *
 * Convenience wrapper around isMarketSafe that adds logging for debugging.
 * Use this when you want visibility into why a market was filtered.
 *
 * @param tokenId - The CLOB token ID to check
 * @param marketName - Human-readable market name for logging
 * @param thresholds - Volatility thresholds configuration
 * @param fetcher - Optional fetch function (for testing)
 * @returns true if safe, false if volatile or error occurred
 *
 * @example
 * ```typescript
 * const safe = await checkMarketVolatility(
 *   tokenId,
 *   "Will BTC hit $100k?",
 *   { maxPriceChangePercent: 0.10, lookbackMinutes: 10 }
 * );
 * ```
 */
export async function checkMarketVolatility(
  tokenId: string,
  marketName: string,
  thresholds: VolatilityThresholds,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  try {
    const history = await fetchPriceHistory(tokenId, "1h", fetcher);
    const metrics = calculatePriceVolatility(
      history,
      thresholds.lookbackMinutes
    );

    const changePercent = (metrics.priceChangePercent * 100).toFixed(1);
    const thresholdPercent = (thresholds.maxPriceChangePercent * 100).toFixed(
      1
    );

    if (metrics.priceChangePercent > thresholds.maxPriceChangePercent) {
      log(
        `  ❌ Filtered "${marketName}" - ${changePercent}% move in ${metrics.timeWindowMinutes.toFixed(1)} min (threshold: ${thresholdPercent}%)`
      );
      return false;
    }

    log(`  ✅ "${marketName}" - ${changePercent}% move (safe)`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`  ⚠️ Skipping "${marketName}" - volatility check failed: ${message}`);
    return false; // Skip market on error (conservative approach)
  }
}
