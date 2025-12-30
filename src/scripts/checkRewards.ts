/**
 * Check if open orders are eligible for liquidity rewards.
 *
 * This script:
 * 1. Fetches all open orders for the authenticated wallet
 * 2. Gets market reward parameters (maxSpread, minSize) from Gamma API
 * 3. Calculates reward score for each order using the Polymarket formula
 * 4. Checks two-sided requirement based on midpoint
 *
 * Usage: npm run checkRewards
 */

import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { getOpenOrders } from "@/utils/orders.js";
import { checkAllOrdersRewardEligibility } from "@/utils/rewards.js";
import { formatRewardResults } from "@/utils/formatters.js";
import type { OpenOrder } from "@/types/rewards.js";

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

  // Check reward eligibility
  const results = await checkAllOrdersRewardEligibility(client, orders);

  // Display results
  console.log(formatRewardResults(results));

  if (results.length === 0) {
    console.log("\nTip: Place some orders first using the market maker bot:");
    console.log("  npm run marketMaker");
  }
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
