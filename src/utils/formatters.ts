import type { Market } from "@/types/polymarket.js";
import type { OrderBookData } from "@/types/polymarket.js";
import type { GammaEvent, ParsedGammaMarket } from "@/types/gamma.js";
import type { RewardCheckResult, RewardCheckResultWithEarnings } from "@/types/rewards.js";
import {
  getYesOutcome,
  getYesProbability,
  getMarketTitle,
  sortMarketsByProbability,
} from "@/utils/markets.js";

/**
 * Formats a number as currency (USD).
 *
 * @param value - Number to format
 * @returns Formatted currency string (e.g., "$1.23M", "$45.67K", "$123.45")
 */
export function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Formats a price as a percentage.
 *
 * @param price - Price value (0-1)
 * @returns Formatted percentage string (e.g., "45.0%")
 */
export function formatPercent(price: number): string {
  return `${(price * 100).toFixed(1)}%`;
}

/**
 * Formats a market for human-readable console output.
 *
 * @param market - The market data to format
 * @param index - Zero-based index for numbering in list display
 * @returns Formatted multi-line string with market details
 */
export function formatMarket(market: Market, index: number): string {
  const lines: string[] = [];

  lines.push(`\n[${index + 1}] ${market.question}`);
  lines.push(`    Condition ID: ${market.condition_id}`);
  lines.push(`    Active: ${market.active} | Closed: ${market.closed}`);

  if (market.end_date_iso) {
    lines.push(`    End Date: ${market.end_date_iso}`);
  }

  if (market.tokens && market.tokens.length > 0) {
    lines.push(`    Outcomes:`);
    for (const token of market.tokens) {
      const priceInfo =
        token.price !== undefined ? ` (${(token.price * 100).toFixed(1)}%)` : "";
      lines.push(`      - ${token.outcome}${priceInfo}`);
    }
  }

  if (market.description) {
    const shortDesc =
      market.description.length > 100
        ? market.description.slice(0, 100) + "..."
        : market.description;
    lines.push(`    Description: ${shortDesc}`);
  }

  return lines.join("\n");
}

/**
 * Formats a Gamma event header for console output.
 *
 * @param event - The Gamma event data
 * @returns Formatted multi-line string with event overview
 */
export function formatEventHeader(event: GammaEvent): string {
  const lines: string[] = [];

  lines.push(`\n${"=".repeat(70)}`);
  lines.push(`  ${event.title}`);
  lines.push(`${"=".repeat(70)}`);
  lines.push("");

  // Status
  const statusParts: string[] = [];
  if (event.active) statusParts.push("Active");
  if (event.closed) statusParts.push("Closed");
  if (event.featured) statusParts.push("Featured");
  if (event.new) statusParts.push("New");
  lines.push(`  Status: ${statusParts.join(" | ") || "Unknown"}`);

  // Volume & Liquidity
  lines.push(`  Total Volume: ${formatCurrency(event.volume)}`);
  lines.push(`  Liquidity: ${formatCurrency(event.liquidity)}`);

  if (event.volume24hr) {
    lines.push(`  24h Volume: ${formatCurrency(event.volume24hr)}`);
  }

  // Dates
  if (event.endDate) {
    lines.push(`  End Date: ${new Date(event.endDate).toLocaleDateString()}`);
  }
  if (event.createdAt) {
    lines.push(`  Created: ${new Date(event.createdAt).toLocaleDateString()}`);
  }

  // Categories & Tags
  if (event.categories && event.categories.length > 0) {
    const cats = event.categories.map((c) => c.label).join(", ");
    lines.push(`  Categories: ${cats}`);
  }
  if (event.tags && event.tags.length > 0) {
    const tags = event.tags.map((t) => t.label).join(", ");
    lines.push(`  Tags: ${tags}`);
  }

  // Description
  if (event.description) {
    lines.push("");
    lines.push(`  Description:`);
    // Wrap description to 66 chars per line
    const words = event.description.split(" ");
    let currentLine = "    ";
    for (const word of words) {
      if (currentLine.length + word.length + 1 > 70) {
        lines.push(currentLine);
        currentLine = "    " + word;
      } else {
        currentLine += (currentLine === "    " ? "" : " ") + word;
      }
    }
    if (currentLine !== "    ") {
      lines.push(currentLine);
    }
  }

  // Resolution source
  if (event.resolutionSource) {
    lines.push("");
    lines.push(`  Resolution Source: ${event.resolutionSource}`);
  }

  lines.push("");
  lines.push(`  Markets: ${event.markets.length} outcomes`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Formats a parsed Gamma market (outcome) for console output.
 *
 * @param market - The parsed market data
 * @param index - Zero-based index for numbering
 * @returns Formatted multi-line string with market details
 */
export function formatGammaMarket(
  market: ParsedGammaMarket,
  index: number
): string {
  const lines: string[] = [];

  // Get the primary outcome (usually "Yes" for this team to win)
  const yesOutcome = getYesOutcome(market);
  const price = yesOutcome?.price ?? 0;

  // Title line with rank and probability
  const title = getMarketTitle(market);
  const probability = formatPercent(price);
  lines.push(`  [${String(index + 1).padStart(2, " ")}] ${title}`);
  lines.push(`       Probability: ${probability} | Volume: ${formatCurrency(market.volumeNum)}`);

  // Condition ID (needed for CLOB API)
  lines.push(`       Condition ID: ${market.conditionId}`);

  // Token IDs for trading
  if (market.parsedOutcomes.length > 0) {
    for (const outcome of market.parsedOutcomes) {
      if (outcome.tokenId) {
        lines.push(
          `       Token (${outcome.outcome}): ${outcome.tokenId.substring(0, 20)}...`
        );
      }
    }
  }

  // Additional info
  const statusParts: string[] = [];
  if (market.active) statusParts.push("Active");
  if (market.closed) statusParts.push("Closed");
  if (market.acceptingOrders) statusParts.push("Accepting Orders");
  lines.push(`       Status: ${statusParts.join(" | ")}`);

  return lines.join("\n");
}

/**
 * Formats a summary table of all markets sorted by probability.
 *
 * @param markets - Array of parsed markets
 * @returns Formatted table string
 */
export function formatMarketsSummaryTable(markets: ParsedGammaMarket[]): string {
  const lines: string[] = [];

  lines.push(`\n${"─".repeat(70)}`);
  lines.push("  MARKETS SUMMARY (sorted by probability)");
  lines.push(`${"─".repeat(70)}`);
  lines.push("");
  lines.push(
    "  " +
      "Rank".padEnd(6) +
      "Outcome".padEnd(25) +
      "Prob".padEnd(8) +
      "Volume".padEnd(12) +
      "Status"
  );
  lines.push("  " + "-".repeat(65));

  // Sort by probability (highest first)
  const sorted = sortMarketsByProbability(markets);

  for (let i = 0; i < sorted.length; i++) {
    const market = sorted[i];
    const price = getYesProbability(market);
    const title = getMarketTitle(market).substring(0, 23);

    const status = market.active
      ? market.acceptingOrders
        ? "Active"
        : "Paused"
      : "Inactive";

    lines.push(
      "  " +
        `#${i + 1}`.padEnd(6) +
        title.padEnd(25) +
        formatPercent(price).padEnd(8) +
        formatCurrency(market.volumeNum).padEnd(12) +
        status
    );
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Formats detailed market info including all token IDs for trading.
 *
 * @param markets - Array of parsed markets
 * @returns Formatted detailed string
 */
export function formatMarketsDetailed(markets: ParsedGammaMarket[]): string {
  const lines: string[] = [];

  lines.push(`\n${"─".repeat(70)}`);
  lines.push("  DETAILED MARKET DATA");
  lines.push(`${"─".repeat(70)}`);

  // Sort by probability (highest first)
  const sorted = sortMarketsByProbability(markets);

  for (let i = 0; i < sorted.length; i++) {
    lines.push(formatGammaMarket(sorted[i], i));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Formats order book data as a table.
 *
 * Shows CLOB order book data with Gamma price as fallback.
 * Displays a note if CLOB data is unavailable (negative risk markets).
 *
 * @param data - Array of order book data
 * @returns Formatted table string
 */
export function formatOrderBookTable(data: OrderBookData[]): string {
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

/**
 * Formats reward check results for console output.
 *
 * @param results - Array of reward check results
 * @returns Formatted multi-line string
 */
export function formatRewardResults(results: RewardCheckResult[]): string {
  if (results.length === 0) {
    return "";
  }

  const lines: string[] = [];

  for (const result of results) {
    lines.push("\n" + "=".repeat(70));
    lines.push(`MARKET: ${result.market.tokenId.substring(0, 20)}...`);
    lines.push("=".repeat(70));
    lines.push(`  Midpoint: ${(result.market.midpoint * 100).toFixed(2)}¢`);
    lines.push(`  Min Size for Rewards: ${result.market.rewardsMinSize} shares`);
    lines.push(`  Max Spread for Rewards: ${result.market.rewardsMaxSpread}¢`);
    lines.push(`  Two-Sided Required: ${result.twoSidedRequired ? "YES" : "NO"}`);

    lines.push("\n  ORDERS:");
    lines.push("  " + "-".repeat(66));

    for (const order of result.orders) {
      const status = order.eligible ? "✓" : "✗";
      const scoreStr = order.score > 0 ? `Score: ${order.score.toFixed(2)}` : order.reason || "";
      lines.push(
        `  ${status} ${order.side.padEnd(4)} ${order.size.toFixed(2).padStart(8)} @ ${order.price.toFixed(4)} | Spread: ${order.spreadFromMid.toFixed(2)}¢ | ${scoreStr}`
      );
    }

    lines.push("\n  SUMMARY:");
    lines.push("  " + "-".repeat(66));
    lines.push(`  BUY Score:  ${result.totalBuyScore.toFixed(2)}`);
    lines.push(`  SELL Score: ${result.totalSellScore.toFixed(2)}`);

    if (!result.twoSidedRequired && (!result.hasBuySide || !result.hasSellSide)) {
      lines.push(
        `  Single-sided penalty: /${result.scalingFactor} (midpoint ${(result.market.midpoint * 100).toFixed(1)}¢ allows single-sided)`
      );
    }

    lines.push(`  Effective Score: ${result.effectiveScore.toFixed(2)}`);
    lines.push(`\n  >>> ${result.summary}`);
  }

  lines.push("\n" + "=".repeat(70));

  return lines.join("\n");
}

/**
 * Formats reward check results with earning percentage comparison.
 *
 * Shows both calculated and API earning percentages for validation.
 *
 * @param results - Array of reward check results with earnings data
 * @returns Formatted multi-line string
 */
export function formatRewardResultsWithEarnings(
  results: RewardCheckResultWithEarnings[]
): string {
  if (results.length === 0) {
    return "";
  }

  const lines: string[] = [];

  for (const result of results) {
    lines.push("\n" + "=".repeat(70));
    lines.push(`MARKET: ${result.market.tokenId.substring(0, 20)}...`);
    lines.push("=".repeat(70));
    lines.push(`  Midpoint: ${(result.market.midpoint * 100).toFixed(2)}%`);
    lines.push(`  Min Size for Rewards: ${result.market.rewardsMinSize} shares`);
    lines.push(`  Max Spread for Rewards: ${result.market.rewardsMaxSpread}c`);
    lines.push(`  Two-Sided Required: ${result.twoSidedRequired ? "YES" : "NO"}`);

    lines.push("\n  YOUR ORDERS:");
    lines.push("  " + "-".repeat(66));

    for (const order of result.orders) {
      const status = order.eligible ? "+" : "-";
      const scoreStr =
        order.score > 0
          ? `Score: ${order.score.toFixed(2)}`
          : order.reason || "";
      lines.push(
        `  ${status} ${order.side.padEnd(4)} ${order.size.toFixed(2).padStart(8)} @ ${order.price.toFixed(4)} | Spread: ${order.spreadFromMid.toFixed(2)}c | ${scoreStr}`
      );
    }

    lines.push("\n  SCORES:");
    lines.push("  " + "-".repeat(66));
    lines.push(`  Your BUY Score:   ${result.totalBuyScore.toFixed(2)}`);
    lines.push(`  Your SELL Score:  ${result.totalSellScore.toFixed(2)}`);
    lines.push(`  Your Q_min:       ${result.effectiveScore.toFixed(2)}`);

    lines.push("");
    lines.push(`  Order Book BID Score: ${result.orderBookBidScore.toFixed(2)}`);
    lines.push(`  Order Book ASK Score: ${result.orderBookAskScore.toFixed(2)}`);
    lines.push(`  Total Q_min:          ${result.totalQMin.toFixed(2)}`);

    lines.push("\n  EARNING PERCENTAGE:");
    lines.push("  " + "-".repeat(66));
    lines.push(`  Our Calculation:  ${result.ourEarningPct.toFixed(4)}%`);

    if (result.apiEarningPct !== undefined) {
      lines.push(`  API Response:     ${result.apiEarningPct.toFixed(4)}%`);

      const diff = result.ourEarningPct - result.apiEarningPct;
      const diffAbs = Math.abs(diff);
      const match = diffAbs < 0.01 ? "MATCH" : diffAbs < 0.1 ? "~CLOSE" : "DIFF";
      const diffSign = diff >= 0 ? "+" : "";
      lines.push(`  Difference:       ${diffSign}${diff.toFixed(4)}% (${match})`);
    } else {
      lines.push(`  API Response:     (not available)`);
    }

    // Overall status
    lines.push("");
    if (result.eligible) {
      let dailyEst = "";
      if (result.ratePerDay !== undefined && result.ratePerDay > 0) {
        const dailyEarning = (result.ourEarningPct / 100) * result.ratePerDay;
        dailyEst = ` (~$${dailyEarning.toFixed(2)}/day from $${result.ratePerDay}/day pool)`;
      }
      lines.push(`  >>> ELIGIBLE: Earning ${result.ourEarningPct.toFixed(2)}%${dailyEst}`);
    } else {
      lines.push(`  >>> ${result.summary}`);
    }
  }

  lines.push("\n" + "=".repeat(70));

  return lines.join("\n");
}
