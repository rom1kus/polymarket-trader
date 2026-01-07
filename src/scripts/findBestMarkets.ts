/**
 * Script to find the best markets for liquidity rewards.
 *
 * Usage:
 *   npm run findBestMarkets
 *   npm run findBestMarkets -- --limit 50
 *   npm run findBestMarkets -- --max-size 20
 *   npm run findBestMarkets -- --json
 *
 * This script:
 * 1. Fetches active markets with reward programs from Polymarket rewards API
 * 2. Calculates an "attractiveness score" for each market based on:
 *    - Higher rewardsMaxSpread = more forgiving spread requirements
 *    - Lower rewardsMinSize = easier to participate
 *    - Lower competitive score = less competition
 *    - Daily rewards amount
 * 3. Ranks and displays the top markets
 */

import {
  fetchMarketsWithRewards,
  type FetchMarketsWithRewardsOptions,
} from "@/utils/gamma.js";
import type {
  MarketWithRewards,
  RankedMarket,
  MarketAttractivenessScore,
} from "@/types/rewards.js";
import { formatCurrency } from "@/utils/formatters.js";

/**
 * Calculates the attractiveness score for a market.
 *
 * Higher score = more attractive for market making.
 *
 * Scoring breakdown:
 * - spreadScore: 0-40 points (higher maxSpread = more forgiving = better)
 * - sizeScore: 0-30 points (lower minSize = easier to participate = better)
 * - competitionScore: 0-20 points (lower competition = better)
 * - rewardsScore: 0-10 points (daily rewards amount)
 */
function calculateAttractiveness(
  market: MarketWithRewards
): MarketAttractivenessScore {
  // Spread score: max spread of 10c = 40 points, 0c = 0 points
  // Most markets have maxSpread between 2-6 cents
  const spreadScore = Math.min((market.rewardsMaxSpread / 10) * 40, 40);

  // Size score: minSize of 0 = 30 points, 200+ = 0 points
  // Inverted: lower is better
  const sizeScore = Math.max(30 - (market.rewardsMinSize / 200) * 30, 0);

  // Liquidity score: Not available from rewards API, set to 0
  const liquidityScore = 0;

  // Competition score: Lower competition value = better
  // competitive=0 = 20 points, competitive>=100 = 0 points (logarithmic scale)
  let competitionScore = 10; // Default if not available
  if (market.competitive !== undefined) {
    if (market.competitive === 0) {
      competitionScore = 20;
    } else {
      // Use logarithmic scale: comp=1 → ~17pts, comp=10 → ~10pts, comp=100 → ~3pts
      competitionScore = Math.max(20 - Math.log10(market.competitive + 1) * 10, 0);
    }
  }

  // Rewards score: If daily rewards are available from API
  // $100/day = 10 points, logarithmic scale
  const rewardsScore = market.rewardsDaily
    ? Math.min(Math.log10(Math.max(market.rewardsDaily, 1)) * 5, 10)
    : 0;

  const total =
    spreadScore + sizeScore + liquidityScore + competitionScore + rewardsScore;

  return {
    total,
    spreadScore,
    sizeScore,
    liquidityScore,
    competitionScore,
    rewardsScore,
  };
}

/**
 * Ranks markets by attractiveness score.
 */
function rankMarkets(markets: MarketWithRewards[]): RankedMarket[] {
  return markets
    .map((market) => ({
      ...market,
      attractiveness: calculateAttractiveness(market),
    }))
    .sort((a, b) => b.attractiveness.total - a.attractiveness.total);
}

/**
 * Formats a single market for console display.
 */
function formatMarketRow(market: RankedMarket, rank: number): string {
  const title = (market.groupItemTitle || market.question).slice(0, 45);
  const paddedTitle = title.padEnd(45);
  const score = market.attractiveness.total.toFixed(1).padStart(5);
  const maxSpread = `${market.rewardsMaxSpread}c`.padStart(4);
  const minSize = market.rewardsMinSize.toFixed(0).padStart(4);
  const daily = market.rewardsDaily ? `$${market.rewardsDaily}`.padStart(6) : "   N/A";
  // Competition is a raw value where lower = less competition
  const competition =
    market.competitive !== undefined
      ? market.competitive.toFixed(0).padStart(6)
      : "   N/A";

  return `${String(rank).padStart(3)}. ${paddedTitle} | ${score} | ${maxSpread} | ${minSize} | ${daily} | ${competition}`;
}

/**
 * Formats the header for the markets table.
 */
function formatTableHeader(): string {
  const header =
    "  #  Market                                         | Score | Sprd | Size |  $/day |   Comp";
  const separator = "-".repeat(header.length);
  return `${header}\n${separator}`;
}

/**
 * Formats the full results for console display.
 */
function formatResults(markets: RankedMarket[], limit: number): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("=".repeat(97));
  lines.push("  TOP MARKETS FOR LIQUIDITY REWARDS");
  lines.push("=".repeat(97));
  lines.push("");
  lines.push("Score breakdown: Spread (40) + Size (30) + Competition (20) + Daily Rewards (10)");
  lines.push("");
  lines.push(formatTableHeader());

  const displayMarkets = markets.slice(0, limit);
  displayMarkets.forEach((market, index) => {
    lines.push(formatMarketRow(market, index + 1));
  });

  lines.push("");
  lines.push("-".repeat(97));
  lines.push("");
  lines.push("Legend:");
  lines.push("  Score = Overall attractiveness (higher = better)");
  lines.push("  Sprd  = Max spread from midpoint for rewards (higher = more forgiving)");
  lines.push("  Size  = Min order size for rewards (lower = easier)");
  lines.push("  $/day = Daily rewards budget");
  lines.push("  Comp  = Competition level (lower = less crowded, 0 = no competition)");
  lines.push("");
  lines.push("To use a market, run:");
  lines.push("  npm run selectMarket -- <event-slug>");
  lines.push("");

  return lines.join("\n");
}

/**
 * Formats detailed info for a single market.
 */
function formatMarketDetails(market: RankedMarket): string {
  const lines: string[] = [];
  const title = market.groupItemTitle || market.question;

  lines.push("");
  lines.push(`Market: ${title}`);
  lines.push(`Event: ${market.eventTitle}`);
  lines.push(`Slug: ${market.eventSlug}`);
  lines.push("");
  lines.push("Reward Parameters:");
  lines.push(`  Max Spread: ${market.rewardsMaxSpread} cents`);
  lines.push(`  Min Size: ${market.rewardsMinSize} shares`);
  if (market.rewardsDaily) {
    lines.push(`  Daily Rewards: ${formatCurrency(market.rewardsDaily)}`);
  }
  lines.push("");
  lines.push("Market Stats:");
  lines.push(`  Liquidity: ${formatCurrency(market.liquidityNum)}`);
  lines.push(`  24h Volume: ${formatCurrency(market.volume24hr)}`);
  if (market.competitive !== undefined) {
    lines.push(`  Competition: ${(market.competitive * 100).toFixed(0)}%`);
  }
  if (market.spread !== undefined) {
    lines.push(`  Current Spread: ${market.spread} cents`);
  }
  lines.push("");
  lines.push("Attractiveness Score Breakdown:");
  lines.push(`  Total: ${market.attractiveness.total.toFixed(1)} / 100`);
  lines.push(`  Spread Score: ${market.attractiveness.spreadScore.toFixed(1)} / 40`);
  lines.push(`  Size Score: ${market.attractiveness.sizeScore.toFixed(1)} / 20`);
  lines.push(`  Liquidity Score: ${market.attractiveness.liquidityScore.toFixed(1)} / 20`);
  lines.push(`  Competition Score: ${market.attractiveness.competitionScore.toFixed(1)} / 10`);
  lines.push(`  Rewards Score: ${market.attractiveness.rewardsScore.toFixed(1)} / 10`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Parse command line arguments.
 */
function parseArgs(): {
  limit: number;
  maxMinSize: number | null;
  json: boolean;
  details: number | null;
} {
  const args = process.argv.slice(2);
  let limit = 20;
  let maxMinSize: number | null = null;
  let json = false;
  let details: number | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if ((arg === "--max-min-size" || arg === "--max-size") && args[i + 1]) {
      maxMinSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--details" && args[i + 1]) {
      details = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: npm run findBestMarkets [options]

Options:
  --limit <n>          Number of markets to display (default: 20)
  --max-size <n>       Max "Min Shares" requirement for rewards (e.g., 20 = only markets requiring <=20 shares)
  --json               Output as JSON instead of table
  --details <n>        Show detailed info for market at rank n
  --help, -h           Show this help message

Examples:
  npm run findBestMarkets
  npm run findBestMarkets -- --max-size 20        # Markets where you only need 20 shares to earn rewards
  npm run findBestMarkets -- --max-size 50 --limit 50
  npm run findBestMarkets -- --details 1
  npm run findBestMarkets -- --json
`);
      process.exit(0);
    }
  }

  return { limit, maxMinSize, json, details };
}

/**
 * Main script logic.
 */
async function main(): Promise<void> {
  const { limit, maxMinSize, json, details } = parseArgs();

  try {
    console.log("\nFetching markets with active reward programs...\n");

    const options: FetchMarketsWithRewardsOptions = {
      limit: 500, // Fetch more to capture all reward markets
      maxMinSize: maxMinSize ?? undefined,
    };

    const markets = await fetchMarketsWithRewards(options);

    if (markets.length === 0) {
      console.log("No markets found with active reward programs.");
      console.log("Try adjusting --min-liquidity or --max-liquidity filters.");
      process.exit(1);
    }

    const rankedMarkets = rankMarkets(markets);

    // Show details for a specific market
    if (details !== null) {
      if (details < 1 || details > rankedMarkets.length) {
        console.log(`Invalid rank: ${details}`);
        console.log(`Valid range: 1 to ${rankedMarkets.length}`);
        process.exit(1);
      }
      console.log(formatMarketDetails(rankedMarkets[details - 1]));
      return;
    }

    // JSON output
    if (json) {
      console.log(JSON.stringify(rankedMarkets.slice(0, limit), null, 2));
      return;
    }

    // Table output
    const filterStr = maxMinSize !== null ? ` (min shares <= ${maxMinSize})` : "";
    console.log(`Found ${markets.length} markets with active rewards${filterStr}`);
    console.log(formatResults(rankedMarkets, limit));

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
