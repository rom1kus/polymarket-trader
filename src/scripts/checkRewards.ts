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
 * Usage: npm run checkRewards
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

async function main() {
  console.log("Checking reward eligibility for open orders...\n");

  const client = await createAuthenticatedClobClient();

  // Fetch open orders
  const orders = (await getOpenOrders(client)) as OpenOrder[];

  if (orders.length === 0) {
    console.log("No open orders found.");
    console.log("\nTip: Place some orders first using the market maker bot:");
    console.log("  npm run marketMaker");
    return;
  }

  console.log(`Found ${orders.length} open orders. Checking eligibility...`);

  // Check reward eligibility (includes fetching reward params)
  const results = await checkAllOrdersRewardEligibility(client, orders);

  if (results.length === 0) {
    console.log("\nNo markets found for your orders.");
    return;
  }

  console.log("Fetching order books and market data...\n");

  // First pass: get condition IDs from order books
  const conditionIds: string[] = [];
  const orderBooks = new Map<string, Awaited<ReturnType<typeof client.getOrderBook>>>();

  for (const result of results) {
    const tokenId = result.market.tokenId;
    const orderBook = await client.getOrderBook(tokenId);
    orderBooks.set(tokenId, orderBook);
    conditionIds.push(orderBook.market);
  }

  // Fetch API earning percentages using built-in CLOB client method
  let apiPercentages: Record<string, number> = {};
  try {
    apiPercentages = await (client as any).getRewardPercentages();
  } catch (error) {
    console.log(
      "Warning: Could not fetch API earning percentages:",
      error instanceof Error ? error.message : error
    );
  }

  // Fetch market rewards info (competitiveness + rate_per_day) from rewards API
  let marketRewardsMap = new Map<string, { marketCompetitiveness: number; ratePerDay: number }>();
  try {
    marketRewardsMap = await fetchMarketRewardsInfo(conditionIds);
  } catch (error) {
    console.log(
      "Warning: Could not fetch market rewards info:",
      error instanceof Error ? error.message : error
    );
  }

  const resultsWithEarnings: RewardCheckResultWithEarnings[] = [];

  for (const result of results) {
    const tokenId = result.market.tokenId;
    const orderBook = orderBooks.get(tokenId)!;

    // Get midpoint from our already-fetched params
    const midpoint = result.market.midpoint;
    const maxSpreadCents = result.market.rewardsMaxSpread;

    // Calculate total Q score from order book (for comparison)
    const totalQScore = calculateTotalQScore(
      orderBook.bids,
      orderBook.asks,
      midpoint,
      maxSpreadCents
    );

    // Get condition ID from order book response
    const conditionId = orderBook.market;

    // Get market rewards info
    const rewardsInfo = marketRewardsMap.get(conditionId);

    // Use market_competitiveness from API as the real total Q_min
    // Note: We multiply by 2 because market_competitiveness represents one side,
    // but the total market includes both YES and NO tokens
    const apiTotalQMin = (rewardsInfo?.marketCompetitiveness ?? 0) * 2;

    // Calculate our earning percentage using adjusted total
    const ourEarningPct = apiTotalQMin > 0
      ? calculateEarningPercentage(result.effectiveScore, apiTotalQMin)
      : 0;

    // Look up API earning percentage
    const apiEarningPct = apiPercentages[conditionId];

    resultsWithEarnings.push({
      ...result,
      conditionId,
      totalQMin: apiTotalQMin,
      orderBookBidScore: totalQScore.totalBidScore,
      orderBookAskScore: totalQScore.totalAskScore,
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
