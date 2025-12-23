/**
 * Script to fetch and display detailed event data from Polymarket.
 *
 * Usage:
 *   npm run getEvent -- uefa-champions-league-winner
 *   npm run getEvent -- https://polymarket.com/event/uefa-champions-league-winner
 *
 * Fetches event metadata, all associated markets (outcomes), and displays:
 * - Event overview (title, description, volume, liquidity, dates)
 * - Summary table of all outcomes sorted by probability
 * - Detailed market data including condition IDs and token IDs for trading
 * - Order book data (best bid/ask) for each market from CLOB API
 */

import { createClobClient } from "@/utils/client.js";
import { fetchEventWithParsedMarkets, extractSlug } from "@/utils/gamma.js";
import {
  formatEventHeader,
  formatMarketsSummaryTable,
  formatMarketsDetailed,
} from "@/utils/formatters.js";
import type { ParsedGammaMarket } from "@/types/gamma.js";
import { Side } from "@polymarket/clob-client";

interface OrderBookData {
  conditionId: string;
  title: string;
  bestBid: string | null;
  bestAsk: string | null;
  midpoint: string | null;
  spread: string | null;
  gammaPrice: number; // Fallback price from Gamma API
}

/**
 * Fetches order book data for markets from the CLOB API.
 * Only fetches for active markets that have token IDs.
 * Falls back to Gamma API prices if CLOB data is unavailable.
 */
async function fetchOrderBookData(
  markets: ParsedGammaMarket[]
): Promise<OrderBookData[]> {
  const clobClient = createClobClient();
  const results: OrderBookData[] = [];

  // Filter to active markets with Yes token IDs
  const activeMarkets = markets.filter((m) => {
    const yesToken = m.parsedOutcomes.find((o) => o.outcome === "Yes");
    return m.active && m.acceptingOrders && yesToken?.tokenId;
  });

  console.log(
    `\nFetching order book data for ${activeMarkets.length} active markets...`
  );

  // Batch requests for better performance
  const batchSize = 10;
  for (let i = 0; i < activeMarkets.length; i += batchSize) {
    const batch = activeMarkets.slice(i, i + batchSize);

    const batchPromises = batch.map(async (market) => {
      const yesToken = market.parsedOutcomes.find((o) => o.outcome === "Yes");
      const tokenId = yesToken?.tokenId;
      const gammaPrice = yesToken?.price ?? 0;

      if (!tokenId) {
        return {
          conditionId: market.conditionId,
          title: market.groupItemTitle || market.question,
          bestBid: null,
          bestAsk: null,
          midpoint: null,
          spread: null,
          gammaPrice,
        };
      }

      try {
        const [bidPrice, askPrice, midpoint, spread] = await Promise.all([
          clobClient.getPrice(tokenId, Side.BUY).catch(() => null),
          clobClient.getPrice(tokenId, Side.SELL).catch(() => null),
          clobClient.getMidpoint(tokenId).catch(() => null),
          clobClient.getSpread(tokenId).catch(() => null),
        ]);

        return {
          conditionId: market.conditionId,
          title: market.groupItemTitle || market.question,
          bestBid: bidPrice,
          bestAsk: askPrice,
          midpoint: midpoint,
          spread: spread,
          gammaPrice,
        };
      } catch {
        return {
          conditionId: market.conditionId,
          title: market.groupItemTitle || market.question,
          bestBid: null,
          bestAsk: null,
          midpoint: null,
          spread: null,
          gammaPrice,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Progress indicator
    process.stdout.write(
      `\r  Fetched ${Math.min(i + batchSize, activeMarkets.length)}/${activeMarkets.length} markets`
    );
  }

  console.log(""); // New line after progress

  return results;
}

/**
 * Formats order book data as a table.
 * Shows CLOB order book data with Gamma price as fallback.
 */
function formatOrderBookTable(data: OrderBookData[]): string {
  const lines: string[] = [];

  // Check if any CLOB data is available (valid non-null, non-empty values)
  const hasClobData = data.some(
    (item) =>
      (item.bestBid && item.bestBid !== "0" && !isNaN(parseFloat(item.bestBid))) ||
      (item.bestAsk && item.bestAsk !== "0" && !isNaN(parseFloat(item.bestAsk))) ||
      (item.midpoint && item.midpoint !== "0" && !isNaN(parseFloat(item.midpoint)))
  );

  lines.push(`\n${"─".repeat(78)}`);
  lines.push("  PRICING DATA");
  lines.push(`${"─".repeat(78)}`);

  if (!hasClobData) {
    lines.push("");
    lines.push(
      "  Note: CLOB order book unavailable for this event (negative risk market)."
    );
    lines.push("  Showing prices from Gamma API instead.");
  }

  lines.push("");
  lines.push(
    "  " +
      "Outcome".padEnd(22) +
      "Price".padEnd(10) +
      "Best Bid".padEnd(12) +
      "Best Ask".padEnd(12) +
      "Midpoint".padEnd(12) +
      "Spread"
  );
  lines.push("  " + "-".repeat(73));

  for (const item of data) {
    const title = item.title.substring(0, 20);
    const gammaPrice = `${(item.gammaPrice * 100).toFixed(1)}%`;
    const bid =
      item.bestBid && !isNaN(parseFloat(item.bestBid))
        ? `$${parseFloat(item.bestBid).toFixed(3)}`
        : "-";
    const ask =
      item.bestAsk && !isNaN(parseFloat(item.bestAsk))
        ? `$${parseFloat(item.bestAsk).toFixed(3)}`
        : "-";
    const mid =
      item.midpoint && !isNaN(parseFloat(item.midpoint))
        ? `$${parseFloat(item.midpoint).toFixed(3)}`
        : "-";
    const spread =
      item.spread && !isNaN(parseFloat(item.spread))
        ? `$${parseFloat(item.spread).toFixed(3)}`
        : "-";

    lines.push(
      "  " +
        title.padEnd(22) +
        gammaPrice.padEnd(10) +
        bid.padEnd(12) +
        ask.padEnd(12) +
        mid.padEnd(12) +
        spread
    );
  }

  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  // Get slug from command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npm run getEvent -- <slug-or-url>");
    console.log("");
    console.log("Examples:");
    console.log("  npm run getEvent -- uefa-champions-league-winner");
    console.log(
      "  npm run getEvent -- https://polymarket.com/event/uefa-champions-league-winner"
    );
    process.exit(1);
  }

  const input = args[0];

  try {
    const slug = extractSlug(input);
    console.log(`\nFetching event: ${slug}`);

    // Fetch event data from Gamma API
    const event = await fetchEventWithParsedMarkets(slug);

    // Display event header
    console.log(formatEventHeader(event));

    // Display summary table
    console.log(formatMarketsSummaryTable(event.markets));

    // Display detailed market data
    console.log(formatMarketsDetailed(event.markets));

    // Fetch and display order book data from CLOB API
    const orderBookData = await fetchOrderBookData(event.markets);

    // Sort by the same order as the summary table (by probability)
    const sortedOrderBook = orderBookData.sort((a, b) => {
      const aMarket = event.markets.find((m) => m.conditionId === a.conditionId);
      const bMarket = event.markets.find((m) => m.conditionId === b.conditionId);
      const aPrice =
        aMarket?.parsedOutcomes.find((o) => o.outcome === "Yes")?.price ?? 0;
      const bPrice =
        bMarket?.parsedOutcomes.find((o) => o.outcome === "Yes")?.price ?? 0;
      return bPrice - aPrice;
    });

    console.log(formatOrderBookTable(sortedOrderBook));

    // Final summary
    console.log(`${"─".repeat(78)}`);
    console.log(`  Event URL: https://polymarket.com/event/${event.slug}`);
    console.log(`  Gamma API: https://gamma-api.polymarket.com/events/slug/${event.slug}`);
    console.log(`${"─".repeat(78)}\n`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("An unexpected error occurred");
    }
    process.exit(1);
  }
}

main();
