/**
 * Market data utilities for working with Gamma API market data.
 *
 * Provides common operations for parsed market data.
 */

import type { ParsedGammaMarket, ParsedOutcome } from "@/types/gamma.js";

/**
 * Gets the "Yes" outcome from a parsed market.
 *
 * Most Polymarket markets have Yes/No outcomes, and the Yes outcome
 * represents the probability of the event occurring.
 *
 * @param market - Parsed Gamma market
 * @returns The Yes outcome, or undefined if not found
 *
 * @example
 * const yesOutcome = getYesOutcome(market);
 * if (yesOutcome) {
 *   console.log(`Probability: ${yesOutcome.price * 100}%`);
 * }
 */
export function getYesOutcome(
  market: ParsedGammaMarket
): ParsedOutcome | undefined {
  return market.parsedOutcomes.find((o) => o.outcome === "Yes");
}

/**
 * Gets the "No" outcome from a parsed market.
 *
 * @param market - Parsed Gamma market
 * @returns The No outcome, or undefined if not found
 */
export function getNoOutcome(
  market: ParsedGammaMarket
): ParsedOutcome | undefined {
  return market.parsedOutcomes.find((o) => o.outcome === "No");
}

/**
 * Gets the Yes probability (price) from a market.
 *
 * @param market - Parsed Gamma market
 * @returns Yes probability (0-1), or 0 if not found
 */
export function getYesProbability(market: ParsedGammaMarket): number {
  return getYesOutcome(market)?.price ?? 0;
}

/**
 * Sorts markets by Yes probability (highest first).
 *
 * @param markets - Array of parsed markets
 * @returns New sorted array (does not mutate input)
 *
 * @example
 * const sorted = sortMarketsByProbability(markets);
 * console.log(sorted[0]); // Most likely outcome
 */
export function sortMarketsByProbability(
  markets: ParsedGammaMarket[]
): ParsedGammaMarket[] {
  return [...markets].sort((a, b) => {
    const aPrice = getYesProbability(a);
    const bPrice = getYesProbability(b);
    return bPrice - aPrice;
  });
}

/**
 * Gets the title for a market, preferring groupItemTitle over question.
 *
 * @param market - Parsed Gamma market
 * @returns Market title
 */
export function getMarketTitle(market: ParsedGammaMarket): string {
  return market.groupItemTitle || market.question;
}
