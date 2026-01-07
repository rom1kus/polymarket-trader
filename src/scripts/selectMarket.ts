/**
 * Script to select a market and generate configuration for the market maker.
 *
 * Usage:
 *   npm run selectMarket -- <event-slug-or-url> [market-index]
 *
 * Examples:
 *   npm run selectMarket -- trump-netanyahu-meeting
 *   npm run selectMarket -- https://polymarket.com/event/trump-netanyahu-meeting
 *   npm run selectMarket -- trump-netanyahu-meeting 0  # Select first market
 *
 * This script:
 * 1. Fetches event data from the Gamma API
 * 2. Lists all available markets in the event
 * 3. Outputs TypeScript configuration to paste into config.ts
 */

import { fetchEventWithParsedMarkets, extractSlug } from "@/utils/gamma.js";
import type { ParsedGammaMarket } from "@/types/gamma.js";

/**
 * Formats a market for display in the selection list.
 */
function formatMarketOption(market: ParsedGammaMarket, index: number): string {
  const title = market.groupItemTitle || market.question;
  const yesOutcome = market.parsedOutcomes.find((o) => o.outcome === "Yes");
  const price = yesOutcome ? `${(yesOutcome.price * 100).toFixed(1)}%` : "N/A";
  return `  [${index}] ${title} (${price})`;
}

/**
 * Generates the MarketParams configuration code.
 */
function generateConfigCode(market: ParsedGammaMarket, eventTitle: string): string {
  const yesOutcome = market.parsedOutcomes.find((o) => o.outcome === "Yes");
  const noOutcome = market.parsedOutcomes.find((o) => o.outcome === "No");

  if (!yesOutcome || !noOutcome) {
    throw new Error("Market does not have Yes/No outcomes");
  }

  const title = market.groupItemTitle || market.question;
  const tickSize = market.orderPriceMinTickSize?.toString() || "0.01";
  const minOrderSize = market.orderMinSize || 0;
  const negRisk = market.negRisk || false;

  // Calculate maxSpread from market data if available
  // Default to 4.5 cents if not specified
  const maxSpread = 4.5;

  return `export const MARKET_CONFIG: MarketParams = {
  // ${title}
  // Event: ${eventTitle}

  // YES token ID (first outcome)
  yesTokenId: "${yesOutcome.tokenId}",

  // NO token ID (second outcome)
  noTokenId: "${noOutcome.tokenId}",

  // Condition ID for CTF operations (split/merge)
  conditionId: "${market.conditionId}",

  // Tick size - minimum price increment
  tickSize: "${tickSize}",

  // Negative risk market (multi-outcome)
  negRisk: ${negRisk},

  // Minimum order size for rewards eligibility
  minOrderSize: ${minOrderSize},

  // Maximum spread from midpoint for reward eligibility (cents)
  // Check Gamma API for current rewardsMaxSpread value
  maxSpread: ${maxSpread},
};`;
}

/**
 * Main script logic.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npm run selectMarket -- <event-slug-or-url> [market-index]");
    console.log("");
    console.log("Examples:");
    console.log("  npm run selectMarket -- trump-netanyahu-meeting");
    console.log("  npm run selectMarket -- https://polymarket.com/event/trump-netanyahu-meeting");
    console.log("  npm run selectMarket -- trump-netanyahu-meeting 0");
    process.exit(1);
  }

  const input = args[0];
  const marketIndex = args[1] !== undefined ? parseInt(args[1], 10) : undefined;

  try {
    const slug = extractSlug(input);
    console.log(`\nFetching event: ${slug}\n`);

    // Fetch event data
    const event = await fetchEventWithParsedMarkets(slug);

    console.log("=".repeat(70));
    console.log(`  EVENT: ${event.title}`);
    console.log("=".repeat(70));
    console.log(`  Markets: ${event.markets.length}`);
    console.log(`  Volume: $${event.volume.toLocaleString()}`);
    console.log(`  Liquidity: $${event.liquidity.toLocaleString()}`);
    console.log("");

    // Filter to only active, binary markets with proper token IDs
    const validMarkets = event.markets.filter((m) => {
      const hasYes = m.parsedOutcomes.some((o) => o.outcome === "Yes" && o.tokenId);
      const hasNo = m.parsedOutcomes.some((o) => o.outcome === "No" && o.tokenId);
      return m.active && !m.closed && hasYes && hasNo && m.conditionId;
    });

    if (validMarkets.length === 0) {
      console.log("No valid markets found in this event.");
      console.log("Markets must be active, binary (Yes/No), and have token IDs.");
      process.exit(1);
    }

    // If market index is provided, generate config directly
    if (marketIndex !== undefined) {
      if (marketIndex < 0 || marketIndex >= validMarkets.length) {
        console.log(`Invalid market index: ${marketIndex}`);
        console.log(`Valid range: 0 to ${validMarkets.length - 1}`);
        process.exit(1);
      }

      const selectedMarket = validMarkets[marketIndex];
      console.log(`Selected market: ${selectedMarket.groupItemTitle || selectedMarket.question}`);
      console.log("");
      console.log("-".repeat(70));
      console.log("  COPY THE FOLLOWING TO src/strategies/marketMaker/config.ts");
      console.log("-".repeat(70));
      console.log("");
      console.log(generateConfigCode(selectedMarket, event.title));
      console.log("");
      console.log("-".repeat(70));
      return;
    }

    // List all markets for selection
    console.log("Available markets:");
    console.log("");
    validMarkets.forEach((market, index) => {
      console.log(formatMarketOption(market, index));
    });
    console.log("");
    console.log("-".repeat(70));
    console.log("  To generate config, run:");
    console.log(`  npm run selectMarket -- ${slug} <index>`);
    console.log("");
    console.log("  Example:");
    console.log(`  npm run selectMarket -- ${slug} 0`);
    console.log("-".repeat(70));

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
