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
  formatOrderBookTable,
} from "@/utils/formatters.js";
import {
  fetchOrderBookData,
  sortOrderBookByProbability,
} from "@/utils/orderbook.js";

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

    // Fetch order book data from CLOB API
    const clobClient = createClobClient();
    console.log(`\nFetching order book data...`);

    const orderBookData = await fetchOrderBookData(clobClient, event.markets, {
      onProgress: (fetched, total) => {
        process.stdout.write(`\r  Fetched ${fetched}/${total} markets`);
      },
    });
    console.log(""); // New line after progress

    // Sort by probability and display
    const sortedOrderBook = sortOrderBookByProbability(orderBookData, event.markets);
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
