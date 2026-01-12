/**
 * Script to find the best markets for liquidity rewards.
 *
 * Usage:
 *   npm run findBestMarkets
 *   npm run findBestMarkets -- --limit 50
 *   npm run findBestMarkets -- --max-size 20
 *   npm run findBestMarkets -- --liquidity 500
 *   npm run findBestMarkets -- --json
 *
 * This script:
 * 1. Fetches active markets with reward programs from Polymarket rewards API
 * 2. Calculates estimated daily earnings for each market based on:
 *    - Daily reward pool (rewardsDaily)
 *    - Market competitiveness (total Q score from other market makers)
 *    - Your liquidity amount (default $100)
 * 3. Ranks and displays the top markets by earning potential
 *
 * The earning estimate uses Polymarket's quadratic reward formula:
 *   Q_score = ((maxSpread - spread) / maxSpread)² × size
 *   earning_pct = your_Q_score / total_Q_score
 *   daily_earnings = earning_pct × daily_reward_pool
 */

import {
  fetchMarketsWithRewards,
  type FetchMarketsWithRewardsOptions,
} from "@/utils/gamma.js";
import type {
  MarketWithRewards,
  RankedMarketByEarnings,
} from "@/types/rewards.js";
import {
  calculateEarningPotential,
  DEFAULT_ESTIMATE_LIQUIDITY,
} from "@/utils/rewards.js";
import { formatCurrency } from "@/utils/formatters.js";

/**
 * Ranks markets by earning potential.
 */
function rankMarketsByEarnings(
  markets: MarketWithRewards[],
  liquidityAmount: number
): RankedMarketByEarnings[] {
  return markets
    .map((market) => ({
      ...market,
      earningPotential: calculateEarningPotential(
        market.rewardsDaily ?? 0,
        market.competitive ?? 0,
        market.rewardsMaxSpread,
        market.rewardsMinSize,
        liquidityAmount
      ),
    }))
    .filter((m) => m.earningPotential.estimatedDailyEarnings > 0)
    .sort(
      (a, b) =>
        b.earningPotential.estimatedDailyEarnings -
        a.earningPotential.estimatedDailyEarnings
    );
}

/**
 * Formats a single market for console display.
 */
function formatMarketRow(
  market: RankedMarketByEarnings,
  rank: number,
  liquidityAmount: number
): string {
  const title = (market.groupItemTitle || market.question).slice(0, 40);
  const paddedTitle = title.padEnd(40);

  // Estimated daily earnings
  const estDaily = market.earningPotential.estimatedDailyEarnings;
  const estDailyStr = estDaily >= 0.01 ? `$${estDaily.toFixed(2)}` : "<$0.01";
  const paddedEstDaily = estDailyStr.padStart(7);

  // Daily reward pool
  const pool = market.rewardsDaily ?? 0;
  const poolStr = pool > 0 ? `$${pool.toFixed(0)}` : "N/A";
  const paddedPool = poolStr.padStart(6);

  // Competition (market competitiveness)
  const comp = market.competitive ?? 0;
  const compStr = comp > 0 ? comp.toFixed(0) : "N/A";
  const paddedComp = compStr.padStart(7);

  // Max spread
  const spreadStr = `${market.rewardsMaxSpread}c`;
  const paddedSpread = spreadStr.padStart(4);

  // Min size
  const sizeStr = market.rewardsMinSize.toFixed(0);
  const paddedSize = sizeStr.padStart(4);

  return `${String(rank).padStart(3)}. ${paddedTitle} | ${paddedEstDaily} | ${paddedPool} | ${paddedComp} | ${paddedSpread} | ${paddedSize}`;
}

/**
 * Formats the header for the markets table.
 */
function formatTableHeader(liquidityAmount: number): string {
  const header = `  #  Market                                      | Est/day | Pool   |   Comp | Sprd | Size`;
  const subheader = `                                                | ($${liquidityAmount})  |        |        |      |     `;
  const separator = "-".repeat(header.length);
  return `${header}\n${subheader}\n${separator}`;
}

/**
 * Formats the full results for console display.
 */
function formatResults(
  markets: RankedMarketByEarnings[],
  limit: number,
  liquidityAmount: number
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("=".repeat(97));
  lines.push(`  TOP MARKETS FOR LIQUIDITY REWARDS (with $${liquidityAmount} liquidity)`);
  lines.push("=".repeat(97));
  lines.push("");
  lines.push(
    "Ranking based on estimated daily earnings using Polymarket's quadratic reward formula."
  );
  lines.push(
    "Assumes orders placed at half the max spread (reasonable competitive position)."
  );
  lines.push("");
  lines.push(formatTableHeader(liquidityAmount));

  const displayMarkets = markets.slice(0, limit);
  displayMarkets.forEach((market, index) => {
    lines.push(formatMarketRow(market, index + 1, liquidityAmount));
  });

  lines.push("");
  lines.push("-".repeat(97));
  lines.push("");
  lines.push("Legend:");
  lines.push(
    `  Est/day = Estimated daily earnings with $${liquidityAmount} liquidity (assumes mid-spread placement)`
  );
  lines.push("  Pool    = Total daily reward pool for this market");
  lines.push(
    "  Comp    = Market competitiveness (total Q score from other makers, lower = less crowded)"
  );
  lines.push("  Sprd    = Max spread from midpoint for rewards (higher = more forgiving)");
  lines.push("  Size    = Min order size for rewards in shares (lower = easier)");
  lines.push("");
  lines.push("To use a market, run:");
  lines.push("  npm run selectMarket -- <event-slug>");
  lines.push("");

  return lines.join("\n");
}

/**
 * Formats detailed info for a single market.
 */
function formatMarketDetails(
  market: RankedMarketByEarnings,
  liquidityAmount: number
): string {
  const lines: string[] = [];
  const title = market.groupItemTitle || market.question;

  lines.push("");
  lines.push(`Market: ${title}`);
  lines.push(`Event: ${market.eventTitle}`);
  lines.push(`Slug: ${market.eventSlug}`);
  lines.push("");
  lines.push("Earning Potential:");
  lines.push(
    `  Estimated Daily Earnings: ${formatCurrency(market.earningPotential.estimatedDailyEarnings)} (with $${liquidityAmount} liquidity)`
  );
  lines.push(
    `  Annual Projection: ${formatCurrency(market.earningPotential.estimatedDailyEarnings * 365)}/year`
  );
  lines.push(
    `  APY Equivalent: ${((market.earningPotential.estimatedDailyEarnings * 365 / liquidityAmount) * 100).toFixed(1)}%`
  );
  lines.push("");
  lines.push("Reward Parameters:");
  lines.push(`  Daily Reward Pool: ${formatCurrency(market.rewardsDaily ?? 0)}`);
  lines.push(`  Market Competitiveness: ${(market.competitive ?? 0).toFixed(0)}`);
  lines.push(`  Max Spread: ${market.rewardsMaxSpread} cents`);
  lines.push(`  Min Size: ${market.rewardsMinSize} shares`);
  lines.push("");
  lines.push("Market Stats:");
  lines.push(`  24h Volume: ${formatCurrency(market.volume24hr)}`);
  if (market.spread !== undefined) {
    lines.push(`  Current Spread: ${market.spread} cents`);
  }
  lines.push("");
  lines.push("Score Breakdown:");
  lines.push(
    `  Earning Efficiency: ${market.earningPotential.earningEfficiency.toFixed(4)} $/day per $${liquidityAmount}`
  );
  lines.push(
    `  Ease of Participation: ${market.earningPotential.easeOfParticipation.toFixed(1)} / 100`
  );
  lines.push(`  Total Score: ${market.earningPotential.totalScore.toFixed(2)}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Parse command line arguments.
 */
function parseArgs(): {
  limit: number;
  maxMinSize: number | null;
  liquidity: number;
  json: boolean;
  details: number | null;
} {
  const args = process.argv.slice(2);
  let limit = 20;
  let maxMinSize: number | null = null;
  let liquidity = DEFAULT_ESTIMATE_LIQUIDITY;
  let json = false;
  let details: number | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (
      (arg === "--max-min-size" || arg === "--max-size") &&
      args[i + 1]
    ) {
      maxMinSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--liquidity" && args[i + 1]) {
      liquidity = parseFloat(args[i + 1]);
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
  --liquidity <n>      Liquidity amount in USD for earning estimate (default: 100)
  --json               Output as JSON instead of table
  --details <n>        Show detailed info for market at rank n
  --help, -h           Show this help message

Examples:
  npm run findBestMarkets
  npm run findBestMarkets -- --liquidity 500         # Estimate with $500 liquidity
  npm run findBestMarkets -- --max-size 20           # Markets where you only need 20 shares to earn rewards
  npm run findBestMarkets -- --details 1             # Details for #1 ranked market
  npm run findBestMarkets -- --json
`);
      process.exit(0);
    }
  }

  return { limit, maxMinSize, liquidity, json, details };
}

/**
 * Main script logic.
 */
async function main(): Promise<void> {
  const { limit, maxMinSize, liquidity, json, details } = parseArgs();

  try {
    console.log("\nFetching markets with active reward programs...\n");

    const options: FetchMarketsWithRewardsOptions = {
      limit: 500, // Fetch more to capture all reward markets
      maxMinSize: maxMinSize ?? undefined,
    };

    const markets = await fetchMarketsWithRewards(options);

    if (markets.length === 0) {
      console.log("No markets found with active reward programs.");
      console.log("Try adjusting --max-size filter.");
      process.exit(1);
    }

    const rankedMarkets = rankMarketsByEarnings(markets, liquidity);

    if (rankedMarkets.length === 0) {
      console.log("No markets with valid earning potential found.");
      console.log("Markets may be missing competitiveness or daily reward data.");
      process.exit(1);
    }

    // Show details for a specific market
    if (details !== null) {
      if (details < 1 || details > rankedMarkets.length) {
        console.log(`Invalid rank: ${details}`);
        console.log(`Valid range: 1 to ${rankedMarkets.length}`);
        process.exit(1);
      }
      console.log(formatMarketDetails(rankedMarkets[details - 1], liquidity));
      return;
    }

    // JSON output
    if (json) {
      console.log(JSON.stringify(rankedMarkets.slice(0, limit), null, 2));
      return;
    }

    // Table output
    const filterStr =
      maxMinSize !== null ? ` (min shares <= ${maxMinSize})` : "";
    console.log(
      `Found ${markets.length} markets with active rewards${filterStr}`
    );
    console.log(
      `Showing ${Math.min(limit, rankedMarkets.length)} markets with earning potential`
    );
    console.log(formatResults(rankedMarkets, limit, liquidity));
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
