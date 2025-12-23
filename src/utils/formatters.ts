import type { Market } from "@/types/polymarket.js";
import type { GammaEvent, ParsedGammaMarket } from "@/types/gamma.js";

/**
 * Formats a number as currency (USD).
 */
function formatCurrency(value: number): string {
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
 */
function formatPercent(price: number): string {
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
  const yesOutcome = market.parsedOutcomes.find((o) => o.outcome === "Yes");
  const price = yesOutcome?.price ?? 0;
  const tokenId = yesOutcome?.tokenId ?? "";

  // Title line with rank and probability
  const title = market.groupItemTitle || market.question;
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
  const sorted = [...markets].sort((a, b) => {
    const aPrice =
      a.parsedOutcomes.find((o) => o.outcome === "Yes")?.price ?? 0;
    const bPrice =
      b.parsedOutcomes.find((o) => o.outcome === "Yes")?.price ?? 0;
    return bPrice - aPrice;
  });

  for (let i = 0; i < sorted.length; i++) {
    const market = sorted[i];
    const yesOutcome = market.parsedOutcomes.find((o) => o.outcome === "Yes");
    const price = yesOutcome?.price ?? 0;
    const title = (market.groupItemTitle || market.question).substring(0, 23);

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
  const sorted = [...markets].sort((a, b) => {
    const aPrice =
      a.parsedOutcomes.find((o) => o.outcome === "Yes")?.price ?? 0;
    const bPrice =
      b.parsedOutcomes.find((o) => o.outcome === "Yes")?.price ?? 0;
    return bPrice - aPrice;
  });

  for (let i = 0; i < sorted.length; i++) {
    lines.push(formatGammaMarket(sorted[i], i));
    lines.push("");
  }

  return lines.join("\n");
}
