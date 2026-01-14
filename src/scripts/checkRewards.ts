/**
 * Check if open orders are eligible for liquidity rewards.
 *
 * This script:
 * 1. Fetches all open orders for the authenticated wallet
 * 2. Gets market reward parameters (maxSpread, minSize) from Gamma API
 * 3. Calculates reward score for each order using the Polymarket formula
 * 4. Calculates earning percentage using market_competitiveness from API
 * 5. Compares calculated percentage to API-reported percentage
 *
 * Orders on both YES and NO tokens of the same market are combined into
 * a single result per conditionId, matching how Polymarket reports earnings.
 *
 * Usage:
 *   npm run checkRewards
 *   npm run checkRewards -- --debug   # Show detailed debug output
 *
 * Debug mode shows:
 * - Raw API response values
 * - Step-by-step calculation breakdown
 * - Order book snapshot vs API time-weighted values
 */

import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { getOpenOrders } from "@/utils/orders.js";
import {
  checkAllOrdersRewardEligibility,
  calculateTotalQScore,
  calculateEarningPercentage,
} from "@/utils/rewards.js";
import { fetchMarketRewardsInfo } from "@/utils/gamma.js";
import { formatRewardResultsWithEarnings } from "@/utils/formatters.js";
import type { OpenOrder } from "@/types/rewards.js";
import type { RewardCheckResultWithEarnings } from "@/types/rewards.js";

// Check for --debug flag
const DEBUG = process.argv.includes("--debug");

function debug(message: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.log(`[DEBUG] ${message}:`, data);
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

async function main() {
  console.log("Checking reward eligibility for open orders...\n");
  
  if (DEBUG) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║                    DEBUG MODE ENABLED                        ║");
    console.log("║  Showing detailed calculation breakdown for each market      ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
  }

  const client = await createAuthenticatedClobClient();

  // Fetch open orders
  const orders = (await getOpenOrders(client)) as OpenOrder[];
  
  debug(`Fetched ${orders.length} open orders`);

  if (orders.length === 0) {
    console.log("No open orders found.");
    console.log("\nTip: Place some orders first using the market maker bot:");
    console.log("  npm run marketMaker");
    return;
  }

  console.log(`Found ${orders.length} open orders. Checking eligibility...`);
  
  if (DEBUG) {
    console.log("\n─── Orders by Token ───");
    const ordersByToken = new Map<string, OpenOrder[]>();
    for (const order of orders) {
      const existing = ordersByToken.get(order.asset_id) || [];
      existing.push(order);
      ordersByToken.set(order.asset_id, existing);
    }
    for (const [tokenId, tokenOrders] of ordersByToken) {
      console.log(`  Token ${tokenId.substring(0, 16)}...:`);
      for (const o of tokenOrders) {
        console.log(`    ${o.side} ${o.original_size} @ ${o.price}`);
      }
    }
    console.log("");
  }

  // Check reward eligibility (groups orders by conditionId)
  const results = await checkAllOrdersRewardEligibility(client, orders);

  if (results.length === 0) {
    console.log("\nNo markets found for your orders.");
    return;
  }

  console.log(`Found ${results.length} market(s). Fetching order books and market data...\n`);

  // Collect conditionIds from results (now available in market params)
  const conditionIds = results.map((r) => r.market.conditionId);

  // Fetch API earning percentages using built-in CLOB client method
  let apiPercentages: Record<string, number> = {};
  try {
    apiPercentages = await (client as any).getRewardPercentages();
    debug("API earning percentages (getRewardPercentages)", apiPercentages);
  } catch (error) {
    console.log(
      "Warning: Could not fetch API earning percentages:",
      error instanceof Error ? error.message : error
    );
  }

  // Fetch market rewards info (competitiveness + rate_per_day) from rewards API
  let marketRewardsMap = new Map<
    string,
    { marketCompetitiveness: number; ratePerDay: number }
  >();
  try {
    marketRewardsMap = await fetchMarketRewardsInfo(conditionIds);
    if (DEBUG) {
      console.log("\n─── Market Rewards Info (from Polymarket rewards API) ───");
      for (const [condId, info] of marketRewardsMap) {
        console.log(`  ${condId.substring(0, 16)}...:`);
        console.log(`    market_competitiveness: ${info.marketCompetitiveness.toFixed(4)}`);
        console.log(`    rate_per_day: $${info.ratePerDay.toFixed(2)}`);
      }
      console.log("");
    }
  } catch (error) {
    console.log(
      "Warning: Could not fetch market rewards info:",
      error instanceof Error ? error.message : error
    );
  }

  const resultsWithEarnings: RewardCheckResultWithEarnings[] = [];

  for (const result of results) {
    const conditionId = result.market.conditionId;
    const tokenIds = result.market.tokenIds;

    // Fetch order book for the PRIMARY token only
    // In binary markets, YES and NO order books are MIRRORED (same orders, inverted prices)
    // Fetching both would DOUBLE-COUNT the same orders!
    // See: src/utils/rewards.ts header for detailed explanation
    const primaryTokenId = tokenIds[0];
    const orderBook = await client.getOrderBook(primaryTokenId);

    const maxSpreadCents = result.market.rewardsMaxSpread;
    
    if (DEBUG) {
      console.log("\n" + "═".repeat(70));
      console.log(`MARKET: ${conditionId.substring(0, 40)}...`);
      console.log("═".repeat(70));
      console.log(`  Condition ID: ${conditionId}`);
      console.log(`  Primary Token: ${primaryTokenId.substring(0, 20)}...`);
      console.log(`  Midpoint: ${(result.market.midpoint * 100).toFixed(2)}¢`);
      console.log(`  Max Spread: ${maxSpreadCents}¢`);
      console.log(`  Min Size: $${result.market.rewardsMinSize}`);
      console.log(`  Two-sided required: ${result.market.midpoint >= 0.10 && result.market.midpoint <= 0.90 ? "YES" : "NO"}`);
      
      console.log("\n─── Order Book Snapshot ───");
      console.log(`  BIDS (BUY orders):  ${orderBook.bids?.length || 0} levels`);
      if (orderBook.bids && orderBook.bids.length > 0) {
        const topBids = orderBook.bids.slice(0, 5);
        for (const bid of topBids) {
          console.log(`    ${bid.price} @ ${bid.size}`);
        }
        if (orderBook.bids.length > 5) console.log(`    ... and ${orderBook.bids.length - 5} more`);
      }
      console.log(`  ASKS (SELL orders): ${orderBook.asks?.length || 0} levels`);
      if (orderBook.asks && orderBook.asks.length > 0) {
        const topAsks = orderBook.asks.slice(0, 5);
        for (const ask of topAsks) {
          console.log(`    ${ask.price} @ ${ask.size}`);
        }
        if (orderBook.asks.length > 5) console.log(`    ... and ${orderBook.asks.length - 5} more`);
      }
    }

    // Calculate Q scores from the single order book
    // Q_one = bid scores (BUY orders), Q_two = ask scores (SELL orders)
    // IMPORTANT: Filter by minSize to only count reward-eligible orders
    const minSize = result.market.rewardsMinSize;
    const orderBookQScore = calculateTotalQScore(
      orderBook.bids,
      orderBook.asks,
      result.market.midpoint,
      maxSpreadCents,
      minSize  // Filter out orders below minimum size for rewards
    );

    const orderBookQOne = orderBookQScore.totalBidScore;
    const orderBookQTwo = orderBookQScore.totalAskScore;

    // Total Q_min from order book (instant snapshot of reward-eligible orders only)
    const calculatedTotalQMin = orderBookQScore.totalQMin;

    // Get market rewards info
    const rewardsInfo = marketRewardsMap.get(conditionId);

    // market_competitiveness from API is the sum of other makers' Q_min scores
    // Note: This value is calculated server-side using time-weighted sampling
    // and may not match our instantaneous order book calculation exactly.
    const apiMarketCompetitiveness = rewardsInfo?.marketCompetitiveness ?? 0;
    
    // Calculate earning percentage using ORDER BOOK data (instant snapshot)
    // This shows our share of total reward-eligible liquidity RIGHT NOW
    const ourEarningPctFromOrderBook =
      calculatedTotalQMin > 0
        ? calculateEarningPercentage(result.effectiveScore, calculatedTotalQMin)
        : 0;
    
    // Also calculate using API's market_competitiveness for comparison
    // Total Q = market_competitiveness (others) + our Q_min
    // Note: This may be inaccurate if market not found in API (returns 0)
    const totalQMinFromApi = apiMarketCompetitiveness + result.effectiveScore;
    const ourEarningPctFromApi =
      apiMarketCompetitiveness > 0  // Only use if API returned valid data
        ? calculateEarningPercentage(result.effectiveScore, totalQMinFromApi)
        : 0;

    // Use ORDER BOOK calculation as primary (instant snapshot, always available)
    // The API percentage is shown separately for comparison
    const ourEarningPct = ourEarningPctFromOrderBook;
    const totalQMin = calculatedTotalQMin;

    // Look up API earning percentage
    const apiEarningPct = apiPercentages[conditionId];
    
    if (DEBUG) {
      console.log("\n─── Q Score Calculations ───");
      console.log("  Formula: S(v, s) = ((v - s) / v)² × size");
      console.log("    where v = maxSpread, s = spread from midpoint");
      console.log(`    minSize filter: ${minSize} shares`);
      console.log("");
      console.log("  Order Book (instant snapshot, minSize filtered):");
      console.log(`    Q_one (bids):  ${orderBookQOne.toFixed(4)}`);
      console.log(`    Q_two (asks):  ${orderBookQTwo.toFixed(4)}`);
      console.log(`    Total Q_min:   ${calculatedTotalQMin.toFixed(4)}`);
      console.log(`    Eligible bid levels: ${orderBookQScore.eligibleBidLevels}`);
      console.log(`    Eligible ask levels: ${orderBookQScore.eligibleAskLevels}`);
      console.log("");
      console.log("  Your Orders:");
      console.log(`    Q_one (bids):  ${result.qOne.toFixed(4)}`);
      console.log(`    Q_two (asks):  ${result.qTwo.toFixed(4)}`);
      console.log(`    Effective:     ${result.effectiveScore.toFixed(4)}`);
      console.log("");
      console.log("  API Values (time-weighted):");
      console.log(`    market_competitiveness: ${apiMarketCompetitiveness.toFixed(4)}${apiMarketCompetitiveness === 0 ? " (not found in API)" : ""}`);
      console.log(`    rate_per_day:           $${rewardsInfo?.ratePerDay?.toFixed(2) ?? "N/A"}`);
      console.log("");
      console.log("─── Earning Percentage Comparison ───");
      console.log(`  Using order book (instant snapshot):`);
      console.log(`    Our % = our_Q / total_Q = ${result.effectiveScore.toFixed(4)} / ${calculatedTotalQMin.toFixed(4)} = ${ourEarningPctFromOrderBook.toFixed(2)}%`);
      console.log("");
      if (apiMarketCompetitiveness > 0) {
        console.log(`  Using API competitiveness:`);
        console.log(`    Total Q = competitiveness + our_Q = ${apiMarketCompetitiveness.toFixed(4)} + ${result.effectiveScore.toFixed(4)} = ${totalQMinFromApi.toFixed(4)}`);
        console.log(`    Our % = our_Q / Total_Q = ${result.effectiveScore.toFixed(4)} / ${totalQMinFromApi.toFixed(4)} = ${ourEarningPctFromApi.toFixed(2)}%`);
        console.log("");
      } else {
        console.log(`  API competitiveness: Not available (market not in first 500 results)`);
        console.log("");
      }
      console.log(`  API reported %: ${apiEarningPct !== undefined ? apiEarningPct.toFixed(2) + "%" : "N/A"}`);
      console.log("");
      console.log("  Note: Order book snapshot differs from API due to time-weighted sampling");
      console.log("        (API samples every minute over epoch, our calc is instantaneous)");
    }

    resultsWithEarnings.push({
      ...result,
      conditionId,
      totalQMin,
      orderBookQOne,
      orderBookQTwo,
      ourEarningPct,
      apiEarningPct,
      ratePerDay: rewardsInfo?.ratePerDay,
    });
  }

  // Display results
  console.log(formatRewardResultsWithEarnings(resultsWithEarnings));
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
