import type { MarketsResponse } from "@/types/polymarket.js";
import { createClobClient } from "@/utils/client.js";
import { formatMarket } from "@/utils/formatters.js";

async function main(): Promise<void> {
  console.log("=== Polymarket Markets ===\n");

  const clobClient = createClobClient();

  console.log("Fetching markets from Polymarket CLOB...\n");

  const response = (await clobClient.getMarkets()) as MarketsResponse;
  const markets = response.data || [];

  if (markets.length === 0) {
    console.log("No markets found.");
    return;
  }

  console.log(`Found ${markets.length} markets:\n`);
  console.log("─".repeat(60));

  for (let i = 0; i < markets.length; i++) {
    console.log(formatMarket(markets[i], i));
  }

  console.log("\n" + "─".repeat(60));
  console.log(`\nTotal: ${markets.length} markets`);

  if (response.next_cursor) {
    console.log(`(More markets available - cursor: ${response.next_cursor})`);
  }
}

main().catch((error: Error) => {
  console.error("Script failed:", error.message);
  process.exit(1);
});
