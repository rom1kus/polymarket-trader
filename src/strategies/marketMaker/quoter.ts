/**
 * Quote generation logic for market making.
 *
 * Generates bid and ask quotes around the current midpoint to earn liquidity rewards.
 * Uses the reward utilities for score calculations.
 */

import type { MarketMakerConfig, Quotes, QuoteLevel } from "./types.js";
import { calculateRewardScore, calculateSpreadCents } from "@/utils/rewards.js";

/**
 * Rounds a price to the nearest tick size.
 *
 * @param price - Price to round
 * @param tickSize - Tick size as a number (e.g., 0.01)
 * @returns Price rounded to nearest tick
 */
function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

/**
 * Clamps a price to the valid range [0.01, 0.99].
 *
 * @param price - Price to clamp
 * @returns Price within valid range
 */
function clampPrice(price: number): number {
  return Math.max(0.01, Math.min(0.99, price));
}

/**
 * Generates bid and ask quotes around the midpoint.
 *
 * The strategy places quotes within the max spread to earn rewards.
 * Quotes closer to the midpoint earn higher rewards (quadratic scoring).
 *
 * @param midpoint - Current market midpoint (0-1)
 * @param config - Market maker configuration
 * @returns Generated bid and ask quotes
 *
 * @example
 * // Midpoint at 0.50, max spread 3 cents, spread percent 50%
 * // Bid will be at 0.485, Ask at 0.515 (1.5 cents from midpoint)
 * const quotes = generateQuotes(0.50, config);
 */
export function generateQuotes(
  midpoint: number,
  config: MarketMakerConfig
): Quotes {
  const { market, orderSize, spreadPercent } = config;

  // Calculate offset from midpoint
  // maxSpread is in cents (e.g., 3), convert to price units (0.03)
  const maxSpreadPrice = market.maxSpread / 100;
  const offset = maxSpreadPrice * spreadPercent;

  // Parse tick size for rounding
  const tickSize = parseFloat(market.tickSize);

  // Calculate bid and ask prices
  const rawBidPrice = midpoint - offset;
  const rawAskPrice = midpoint + offset;

  // Round to tick size and clamp to valid range
  const bidPrice = clampPrice(roundToTick(rawBidPrice, tickSize));
  const askPrice = clampPrice(roundToTick(rawAskPrice, tickSize));

  // Ensure bid < ask (can happen at extreme prices)
  const finalBidPrice = Math.min(bidPrice, midpoint - tickSize);
  const finalAskPrice = Math.max(askPrice, midpoint + tickSize);

  return {
    bid: {
      side: "BUY",
      price: clampPrice(roundToTick(finalBidPrice, tickSize)),
      size: orderSize,
    },
    ask: {
      side: "SELL",
      price: clampPrice(roundToTick(finalAskPrice, tickSize)),
      size: orderSize,
    },
    midpoint,
  };
}

/**
 * Determines if quotes need to be refreshed based on midpoint movement.
 *
 * @param currentMidpoint - Current market midpoint
 * @param lastQuotedMidpoint - Midpoint when quotes were last placed
 * @param threshold - Minimum change to trigger rebalance
 * @returns True if quotes should be refreshed
 */
export function shouldRebalance(
  currentMidpoint: number,
  lastQuotedMidpoint: number,
  threshold: number
): boolean {
  return Math.abs(currentMidpoint - lastQuotedMidpoint) >= threshold;
}

/**
 * Estimates the reward score for a quote.
 * Uses the shared reward calculation from @/utils/rewards.
 *
 * @param quote - The quote level
 * @param midpoint - Market midpoint
 * @param maxSpreadCents - Maximum spread for rewards (in cents)
 * @returns Estimated reward score (higher is better)
 */
export function estimateRewardScore(
  quote: QuoteLevel,
  midpoint: number,
  maxSpreadCents: number
): number {
  const spreadCents = calculateSpreadCents(quote.price, midpoint);
  return calculateRewardScore(spreadCents, maxSpreadCents, quote.size);
}

/**
 * Formats a quote for display.
 *
 * @param quote - Quote to format
 * @param midpoint - Market midpoint
 * @returns Formatted string
 */
export function formatQuote(quote: QuoteLevel, midpoint: number): string {
  const spreadCents = calculateSpreadCents(quote.price, midpoint);
  return `${quote.side} ${quote.size} @ $${quote.price.toFixed(4)} (${spreadCents.toFixed(1)}c from mid)`;
}
