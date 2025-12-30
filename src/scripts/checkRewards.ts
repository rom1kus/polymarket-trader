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

import { ClobClient } from "@polymarket/clob-client";
import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { config } from "@/config/index.js";

interface OpenOrder {
  id: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  original_size: string;
  size_matched: string;
  outcome: string;
}

interface MarketRewardParams {
  tokenId: string;
  rewardsMinSize: number;
  rewardsMaxSpread: number;
  midpoint: number;
}

interface OrderRewardStatus {
  orderId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  spreadFromMid: number;
  score: number;
  eligible: boolean;
  reason?: string;
}

interface RewardCheckResult {
  market: MarketRewardParams;
  orders: OrderRewardStatus[];
  twoSidedRequired: boolean;
  hasBuySide: boolean;
  hasSellSide: boolean;
  totalBuyScore: number;
  totalSellScore: number;
  effectiveScore: number;
  scalingFactor: number;
  eligible: boolean;
  summary: string;
}

/**
 * Calculates the reward score for an order using Polymarket's quadratic formula.
 * S(v,s) = ((v-s)/v)² × size
 *
 * @param spreadCents - Spread from midpoint in cents
 * @param maxSpreadCents - Maximum spread for rewards in cents
 * @param size - Order size in shares
 * @returns Reward score (0 if outside max spread)
 */
function calculateOrderScore(
  spreadCents: number,
  maxSpreadCents: number,
  size: number
): number {
  if (spreadCents >= maxSpreadCents) {
    return 0;
  }
  const ratio = (maxSpreadCents - spreadCents) / maxSpreadCents;
  return ratio * ratio * size;
}

/**
 * Fetches reward parameters for a market from Gamma API.
 */
async function getMarketRewardParams(
  client: ClobClient,
  tokenId: string
): Promise<MarketRewardParams> {
  // Get midpoint from CLOB
  const midResponse = await client.getMidpoint(tokenId);
  const midpoint =
    typeof midResponse === "object" && midResponse !== null && "mid" in midResponse
      ? parseFloat((midResponse as { mid: string }).mid)
      : parseFloat(String(midResponse));

  // Get reward params from Gamma API
  const gammaUrl = `${config.gammaHost}/markets?clob_token_ids=${tokenId}`;
  const response = await fetch(gammaUrl);
  const markets = (await response.json()) as Array<{
    rewardsMinSize?: number;
    rewardsMaxSpread?: number;
  }>;

  if (!markets || markets.length === 0) {
    throw new Error(`Market not found for token ${tokenId}`);
  }

  const market = markets[0];

  return {
    tokenId,
    rewardsMinSize: market.rewardsMinSize ?? 0,
    rewardsMaxSpread: market.rewardsMaxSpread ?? 0,
    midpoint,
  };
}

/**
 * Checks reward eligibility for all open orders.
 */
async function checkRewardEligibility(
  client: ClobClient,
  tokenId?: string
): Promise<RewardCheckResult[]> {
  // Fetch open orders
  const orders = (await client.getOpenOrders()) as OpenOrder[];

  if (orders.length === 0) {
    console.log("No open orders found.");
    return [];
  }

  // Group orders by token ID
  const ordersByToken = new Map<string, OpenOrder[]>();
  for (const order of orders) {
    const tid = order.asset_id;
    if (tokenId && tid !== tokenId) continue;

    if (!ordersByToken.has(tid)) {
      ordersByToken.set(tid, []);
    }
    ordersByToken.get(tid)!.push(order);
  }

  const results: RewardCheckResult[] = [];

  // Process each token's orders
  for (const [tid, tokenOrders] of ordersByToken) {
    const params = await getMarketRewardParams(client, tid);

    // Scaling factor for single-sided liquidity (c = 3.0 per docs)
    const scalingFactor = 3.0;

    // Check if two-sided is required
    const twoSidedRequired = params.midpoint < 0.1 || params.midpoint > 0.9;

    const orderStatuses: OrderRewardStatus[] = [];
    let totalBuyScore = 0;
    let totalSellScore = 0;
    let hasBuySide = false;
    let hasSellSide = false;

    for (const order of tokenOrders) {
      const price = parseFloat(order.price);
      const size = parseFloat(order.original_size) - parseFloat(order.size_matched);
      const spreadFromMid = Math.abs(price - params.midpoint) * 100; // in cents

      let eligible = true;
      let reason: string | undefined;

      // Check minimum size
      if (size < params.rewardsMinSize) {
        eligible = false;
        reason = `Size ${size} < min ${params.rewardsMinSize}`;
      }

      // Check max spread
      if (spreadFromMid > params.rewardsMaxSpread) {
        eligible = false;
        reason = `Spread ${spreadFromMid.toFixed(2)}c > max ${params.rewardsMaxSpread}c`;
      }

      const score = eligible
        ? calculateOrderScore(spreadFromMid, params.rewardsMaxSpread, size)
        : 0;

      if (order.side === "BUY") {
        totalBuyScore += score;
        if (eligible) hasBuySide = true;
      } else {
        totalSellScore += score;
        if (eligible) hasSellSide = true;
      }

      orderStatuses.push({
        orderId: order.id,
        side: order.side,
        price,
        size,
        spreadFromMid,
        score,
        eligible,
        reason,
      });
    }

    // Calculate effective score based on two-sided requirement
    // From docs:
    // - If midpoint in [0.10, 0.90]: Qmin = max(min(Qone, Qtwo), max(Qone/c, Qtwo/c))
    // - If midpoint outside: Qmin = min(Qone, Qtwo)
    let effectiveScore: number;
    if (twoSidedRequired) {
      effectiveScore = Math.min(totalBuyScore, totalSellScore);
    } else {
      effectiveScore = Math.max(
        Math.min(totalBuyScore, totalSellScore),
        Math.max(totalBuyScore / scalingFactor, totalSellScore / scalingFactor)
      );
    }

    const eligible = effectiveScore > 0;

    // Build summary
    let summary: string;
    if (!eligible) {
      if (twoSidedRequired && (!hasBuySide || !hasSellSide)) {
        summary = `NOT ELIGIBLE: Two-sided required (midpoint ${(params.midpoint * 100).toFixed(1)}c), but missing ${!hasBuySide ? "BUY" : "SELL"} side`;
      } else if (orderStatuses.every((o) => !o.eligible)) {
        summary = `NOT ELIGIBLE: All orders outside reward parameters`;
      } else {
        summary = `NOT ELIGIBLE: Unknown reason`;
      }
    } else {
      const singleSidedPenalty =
        !hasBuySide || !hasSellSide
          ? ` (single-sided, score reduced by ${scalingFactor}x)`
          : "";
      summary = `ELIGIBLE: Effective score = ${effectiveScore.toFixed(2)}${singleSidedPenalty}`;
    }

    results.push({
      market: params,
      orders: orderStatuses,
      twoSidedRequired,
      hasBuySide,
      hasSellSide,
      totalBuyScore,
      totalSellScore,
      effectiveScore,
      scalingFactor,
      eligible,
      summary,
    });
  }

  return results;
}

/**
 * Formats and prints reward check results.
 */
function printResults(results: RewardCheckResult[]): void {
  if (results.length === 0) {
    return;
  }

  for (const result of results) {
    console.log("\n" + "=".repeat(70));
    console.log(`MARKET: ${result.market.tokenId.substring(0, 20)}...`);
    console.log("=".repeat(70));
    console.log(`  Midpoint: ${(result.market.midpoint * 100).toFixed(2)}¢`);
    console.log(`  Min Size for Rewards: ${result.market.rewardsMinSize} shares`);
    console.log(`  Max Spread for Rewards: ${result.market.rewardsMaxSpread}¢`);
    console.log(`  Two-Sided Required: ${result.twoSidedRequired ? "YES" : "NO"}`);

    console.log("\n  ORDERS:");
    console.log("  " + "-".repeat(66));

    for (const order of result.orders) {
      const status = order.eligible ? "✓" : "✗";
      const scoreStr = order.score > 0 ? `Score: ${order.score.toFixed(2)}` : order.reason || "";
      console.log(
        `  ${status} ${order.side.padEnd(4)} ${order.size.toFixed(2).padStart(8)} @ ${order.price.toFixed(4)} | Spread: ${order.spreadFromMid.toFixed(2)}¢ | ${scoreStr}`
      );
    }

    console.log("\n  SUMMARY:");
    console.log("  " + "-".repeat(66));
    console.log(`  BUY Score:  ${result.totalBuyScore.toFixed(2)}`);
    console.log(`  SELL Score: ${result.totalSellScore.toFixed(2)}`);

    if (!result.twoSidedRequired && (!result.hasBuySide || !result.hasSellSide)) {
      console.log(
        `  Single-sided penalty: /${result.scalingFactor} (midpoint ${(result.market.midpoint * 100).toFixed(1)}¢ allows single-sided)`
      );
    }

    console.log(`  Effective Score: ${result.effectiveScore.toFixed(2)}`);
    console.log(`\n  >>> ${result.summary}`);
  }

  console.log("\n" + "=".repeat(70));
}

async function main() {
  console.log("Checking reward eligibility for open orders...\n");

  const client = await createAuthenticatedClobClient();
  const results = await checkRewardEligibility(client);

  printResults(results);

  if (results.length === 0) {
    console.log("\nTip: Place some orders first using the market maker bot:");
    console.log("  npm run marketMaker");
  }
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
