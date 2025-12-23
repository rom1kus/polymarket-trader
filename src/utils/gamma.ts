/**
 * Utilities for interacting with the Polymarket Gamma API.
 *
 * The Gamma API provides event and market metadata, complementing the CLOB API
 * which handles trading operations.
 */

import { config } from "@/config/index.js";
import type {
  GammaEvent,
  GammaMarket,
  ParsedGammaEvent,
  ParsedGammaMarket,
  ParsedOutcome,
} from "@/types/gamma.js";

/**
 * Extracts the slug from a Polymarket URL or returns the input if already a slug.
 *
 * @param input - URL like "https://polymarket.com/event/uefa-champions-league-winner" or slug "uefa-champions-league-winner"
 * @returns The extracted slug
 *
 * @example
 * extractSlug("https://polymarket.com/event/uefa-champions-league-winner") // "uefa-champions-league-winner"
 * extractSlug("uefa-champions-league-winner") // "uefa-champions-league-winner"
 */
export function extractSlug(input: string): string {
  // Check if it's a URL
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const url = new URL(input);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Expected format: /event/{slug}
    if (pathParts[0] === "event" && pathParts[1]) {
      return pathParts[1];
    }

    throw new Error(
      `Invalid Polymarket URL format: ${input}. Expected format: https://polymarket.com/event/{slug}`
    );
  }

  // Assume it's already a slug
  return input;
}

/**
 * Parses outcome prices and token IDs from a GammaMarket into structured data.
 *
 * The Gamma API returns outcomes, prices, and token IDs as JSON array strings.
 * This function parses them into a structured array.
 *
 * @param market - The market to parse
 * @returns Array of parsed outcomes with price and token ID
 */
export function parseMarketOutcomes(market: GammaMarket): ParsedOutcome[] {
  const outcomes = market.outcomes
    ? (JSON.parse(market.outcomes) as string[])
    : [];
  const prices = market.outcomePrices
    ? (JSON.parse(market.outcomePrices) as string[])
    : [];

  // clobTokenIds can be either a JSON array string or comma-separated
  let tokenIds: string[] = [];
  if (market.clobTokenIds) {
    const trimmed = market.clobTokenIds.trim();
    if (trimmed.startsWith("[")) {
      // It's a JSON array
      tokenIds = JSON.parse(trimmed) as string[];
    } else {
      // It's comma-separated
      tokenIds = trimmed.split(",").map((id) => id.trim());
    }
  }

  return outcomes.map((outcome, index) => ({
    outcome,
    price: prices[index] ? parseFloat(prices[index]) : 0,
    tokenId: tokenIds[index] || "",
  }));
}

/**
 * Enhances a GammaMarket with parsed outcome data.
 *
 * @param market - The market to enhance
 * @returns Market with parsedOutcomes array
 */
export function parseGammaMarket(market: GammaMarket): ParsedGammaMarket {
  return {
    ...market,
    parsedOutcomes: parseMarketOutcomes(market),
  };
}

/**
 * Fetches an event by its slug from the Gamma API.
 *
 * @param slug - The event slug (e.g., "uefa-champions-league-winner")
 * @returns The event data with associated markets
 * @throws Error if the event is not found or request fails
 *
 * @example
 * const event = await fetchEventBySlug("uefa-champions-league-winner");
 * console.log(event.title); // "UEFA Champions League Winner"
 * console.log(event.markets.length); // 31 (one per team)
 */
export async function fetchEventBySlug(slug: string): Promise<GammaEvent> {
  const url = `${config.gammaHost}/events/slug/${encodeURIComponent(slug)}`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Event not found: ${slug}`);
    }
    throw new Error(
      `Failed to fetch event: ${response.status} ${response.statusText}`
    );
  }

  const event = (await response.json()) as GammaEvent;
  return event;
}

/**
 * Fetches an event by slug and parses all market outcomes.
 *
 * @param slugOrUrl - Event slug or full Polymarket URL
 * @returns Event with parsed market data
 */
export async function fetchEventWithParsedMarkets(
  slugOrUrl: string
): Promise<ParsedGammaEvent> {
  const slug = extractSlug(slugOrUrl);
  const event = await fetchEventBySlug(slug);

  return {
    ...event,
    markets: event.markets.map(parseGammaMarket),
  };
}
