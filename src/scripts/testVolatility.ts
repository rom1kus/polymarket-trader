/**
 * Test script for volatility detection.
 *
 * Tests the volatility filtering system with a known market to verify:
 * - Price history fetching works
 * - Volatility calculation is accurate
 * - Filtering logic behaves correctly
 *
 * Usage:
 *   npm run test:volatility -- --token-id <tokenId>
 *   npm run test:volatility -- --token-id <tokenId> --max-volatility 0.20 --lookback 15
 */

import {
  fetchPriceHistory,
  calculatePriceVolatility,
  isMarketSafe,
} from "../utils/volatility.js";
import { log } from "../utils/helpers.js";

// Parse CLI arguments
const args = process.argv.slice(2);
let tokenId: string | null = null;
let maxVolatility = 0.10; // 10% default (conservative)
let lookback = 10; // 10 minutes default

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const nextArg = args[i + 1];

  switch (arg) {
    case "--token-id":
      if (nextArg) {
        tokenId = nextArg;
        i++;
      }
      break;
    case "--max-volatility":
      if (nextArg) {
        maxVolatility = parseFloat(nextArg);
        i++;
      }
      break;
    case "--lookback":
      if (nextArg) {
        lookback = parseFloat(nextArg);
        i++;
      }
      break;
  }
}

if (!tokenId) {
  console.error("Error: --token-id is required");
  console.log("\nUsage:");
  console.log("  npm run test:volatility -- --token-id <tokenId>");
  console.log("  npm run test:volatility -- --token-id <tokenId> --max-volatility 0.20 --lookback 15");
  console.log("\nExample (Zelenskyy WEF market):");
  console.log("  npm run test:volatility -- --token-id 95105786350752265136374971050328533169829382932726332025662707404422157212288");
  process.exit(1);
}

async function testVolatility() {
  const SEPARATOR = "=".repeat(70);
  const SECTION = "-".repeat(70);

  console.log(SEPARATOR);
  console.log("  VOLATILITY DETECTION TEST");
  console.log(SEPARATOR);
  console.log(`Token ID: ${tokenId}`);
  console.log(`Max Volatility: ${(maxVolatility * 100).toFixed(1)}%`);
  console.log(`Lookback Window: ${lookback} minutes`);
  console.log(SEPARATOR);

  try {
    // Step 1: Fetch price history
    console.log("\n[1/3] Fetching price history from CLOB API...");
    const history = await fetchPriceHistory(tokenId!, "1h");
    console.log(`✅ Fetched ${history.length} price points over last hour`);

    if (history.length < 2) {
      console.log("⚠️  Not enough price data to calculate volatility");
      console.log("    This could mean:");
      console.log("    - Market is very old and history was purged");
      console.log("    - Market has very little trading activity");
      console.log("    - API doesn't have historical data for this token");
      return;
    }

    // Display sample of price history
    console.log("\nPrice history sample (most recent 5 points):");
    console.log(SECTION);
    const recent = history.slice(-5);
    for (const point of recent) {
      const date = new Date(point.t * 1000);
      console.log(`  ${date.toISOString()} | $${point.p.toFixed(4)}`);
    }
    console.log(SECTION);

    // Step 2: Calculate volatility
    console.log(`\n[2/3] Calculating volatility for ${lookback}-minute window...`);
    const metrics = calculatePriceVolatility(history, lookback);

    console.log(`\nVolatility Metrics:`);
    console.log(SECTION);
    console.log(`  Time Window: ${metrics.timeWindowMinutes.toFixed(1)} minutes`);
    console.log(`  Data Points: ${metrics.dataPoints}`);
    console.log(`  Price Change: ${(metrics.priceChangePercent * 100).toFixed(2)}%`);
    console.log(`  Max Single Move: ${(metrics.maxMove * 100).toFixed(2)}%`);
    console.log(SECTION);

    // Step 3: Check if market is safe
    console.log(`\n[3/3] Checking if market passes volatility filter...`);
    const isSafe = await isMarketSafe(
      tokenId!,
      {
        maxPriceChangePercent: maxVolatility,
        lookbackMinutes: lookback,
      }
    );

    console.log(`\nResult:`);
    console.log(SEPARATOR);
    if (isSafe) {
      console.log(`  ✅ SAFE - Market passes volatility check`);
      console.log(`  ${(metrics.priceChangePercent * 100).toFixed(2)}% change is within ${(maxVolatility * 100).toFixed(1)}% threshold`);
    } else {
      console.log(`  ❌ VOLATILE - Market would be filtered out`);
      console.log(`  ${(metrics.priceChangePercent * 100).toFixed(2)}% change exceeds ${(maxVolatility * 100).toFixed(1)}% threshold`);
    }
    console.log(SEPARATOR);

    // Summary
    console.log("\nInterpretation:");
    if (isSafe) {
      console.log("  This market has stable prices and is safe for market making.");
      console.log("  The orchestrator would consider this market for trading.");
    } else {
      console.log("  This market has experienced significant price volatility.");
      console.log("  The orchestrator would skip this market to avoid adverse selection.");
      console.log("  Trading this market could lead to losses due to rapid price changes.");
    }

  } catch (error) {
    console.error("\n❌ Error testing volatility:");
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    } else {
      console.error(`   ${String(error)}`);
    }
    console.log("\nPossible reasons:");
    console.log("  - Token ID is invalid");
    console.log("  - API is temporarily unavailable");
    console.log("  - Network connection issues");
    console.log("  - Price history not available for this token");
    process.exit(1);
  }
}

// Run the test
testVolatility().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
