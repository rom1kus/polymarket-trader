import type { Market } from "@/types/polymarket.js";

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
