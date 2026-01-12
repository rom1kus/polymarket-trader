/**
 * Quote generation logic for market making.
 *
 * Generates BUY orders for both YES and NO tokens to earn liquidity rewards.
 * Uses the reward utilities for score calculations.
 *
 * The strategy places:
 * - BUY YES at (midpoint - offset) - equivalent to a traditional bid
 * - BUY NO at (1 - (midpoint + offset)) - equivalent to a traditional ask
 *
 * This approach is economically equivalent to bid/ask on YES token but
 * doesn't require holding YES/NO tokens upfront - only USDC.
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
 * Generates YES and NO quotes around the midpoint.
 *
 * The strategy places BUY orders on both tokens to earn rewards:
 * - BUY YES at (midpoint - offset) - traditional bid equivalent
 * - BUY NO at (1 - (midpoint + offset)) - mirrored ask equivalent
 *
 * This is economically equivalent to bid/ask on YES token but
 * doesn't require holding tokens upfront - only USDC.
 *
 * @param midpoint - Current market midpoint for YES token (0-1)
 * @param config - Market maker configuration
 * @returns Generated YES and NO quotes
 *
 * @example
 * // Midpoint at 0.50, max spread 3 cents, spread percent 50%
 * // YES quote: BUY @ 0.485 (1.5c below midpoint)
 * // NO quote: BUY @ 0.485 (= 1 - 0.515, mirrored ask)
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

  // YES quote: BUY at (midpoint - offset)
  // This is the traditional "bid" - buying YES tokens below midpoint
  const rawYesPrice = midpoint - offset;
  const yesPrice = clampPrice(roundToTick(rawYesPrice, tickSize));
  // Ensure YES price is below midpoint
  const finalYesPrice = Math.min(yesPrice, clampPrice(roundToTick(midpoint - tickSize, tickSize)));

  // NO quote: BUY at (1 - (midpoint + offset))
  // This is equivalent to SELL YES at (midpoint + offset)
  // Since YES + NO = 1, if we want to "sell YES at 0.55", we "buy NO at 0.45"
  const rawNoPrice = 1 - (midpoint + offset);
  const noPrice = clampPrice(roundToTick(rawNoPrice, tickSize));
  // Ensure NO price is below NO midpoint (which is 1 - midpoint)
  const noMidpoint = 1 - midpoint;
  const finalNoPrice = Math.min(noPrice, clampPrice(roundToTick(noMidpoint - tickSize, tickSize)));

  return {
    yesQuote: {
      side: "BUY",
      price: finalYesPrice,
      size: orderSize,
    },
    noQuote: {
      side: "BUY",
      price: finalNoPrice,
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
 * @param tokenType - "YES" or "NO" to indicate which token
 * @param midpoint - Market midpoint for YES token
 * @param maxSpreadCents - Maximum spread for rewards (in cents)
 * @returns Estimated reward score (higher is better)
 */
export function estimateRewardScore(
  quote: QuoteLevel,
  tokenType: "YES" | "NO",
  midpoint: number,
  maxSpreadCents: number
): number {
  // For NO token, the relevant midpoint is (1 - yesMidpoint)
  const relevantMidpoint = tokenType === "YES" ? midpoint : 1 - midpoint;
  const spreadCents = calculateSpreadCents(quote.price, relevantMidpoint);
  return calculateRewardScore(spreadCents, maxSpreadCents, quote.size);
}

/**
 * Formats a quote for display.
 *
 * @param quote - Quote to format
 * @param tokenType - "YES" or "NO" to indicate which token
 * @param midpoint - Market midpoint for YES token (used to calculate spread)
 * @returns Formatted string
 */
export function formatQuote(
  quote: QuoteLevel,
  tokenType: "YES" | "NO",
  midpoint: number
): string {
  // For NO token, the relevant midpoint is (1 - yesMidpoint)
  const relevantMidpoint = tokenType === "YES" ? midpoint : 1 - midpoint;
  const spreadCents = calculateSpreadCents(quote.price, relevantMidpoint);
  return `BUY ${tokenType} ${quote.size} @ $${quote.price.toFixed(4)} (${spreadCents.toFixed(1)}c from mid)`;
}
