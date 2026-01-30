/**
 * Liquidation management for the orchestrator.
 * 
 * When markets hit position limits, they enter liquidation mode.
 * The orchestrator manages liquidation markets in the background while
 * continuing to run the active market maker.
 * 
 * ## Liquidation Flow
 * 
 * 1. **Entry**: Market maker exits with `position_limit` reason
 * 2. **Queuing**: Market added to `state.liquidationMarkets` array
 * 3. **Management**: Every 30s, places/updates passive exit orders
 * 4. **Completion**: Removed from queue when position becomes neutral
 * 5. **Persistence**: State saved to `./data/liquidations.json` on every change
 * 
 * ## Restart Behavior
 * 
 * When the orchestrator restarts with liquidations in progress:
 * 
 * 1. **Liquidations restored**: Markets in `./data/liquidations.json` are automatically 
 *    reconstructed into the liquidation queue
 * 2. **Position data preserved**: Fill data in `fills-{conditionId}.json` maintains 
 *    cost basis and position tracking
 * 3. **Liquidation management resumes**: Restored liquidations continue to be managed 
 *    with passive orders every 30s
 * 4. **Other positions handled**: Any positions NOT in liquidations.json trigger a prompt:
 *    - User can choose to liquidate that position (adds to queue) or ignore
 *    - With `--auto-resume`: automatically queues all detected positions for liquidation
 * 5. **Active market starts**: After handling positions, orchestrator discovers and 
 *    starts a new active market
 * 
 * This ensures no liquidations are abandoned on restart.
 * 
 * ## Order Management
 * 
 * - Cancels previous order BEFORE placing new one (no duplicate orders)
 * - On shutdown, all liquidation orders are cancelled gracefully
 * - Liquidation state persisted to disk for visibility
 * - On position fill, order becomes stale and gets replaced on next cycle
 * 
 * MVP: Simple PASSIVE stage with profit protection:
 * - Quotes SELL orders at max(midpoint, avg-cost) to exit position
 * - Never sells below cost basis (protects profits)
 * - Replaces orders when price moves significantly (>0.5c threshold)
 * 
 * Future: Add SKEWED, AGGRESSIVE, MARKET stages for time-based escalation.
 */

import type { ClobClient } from "@polymarket/clob-client";
import { Side } from "@polymarket/clob-client";
import { log } from "@/utils/helpers.js";
import { getMidpoint, getOpenOrders, placeOrder, cancelOrder } from "@/utils/orders.js";
import { saveLiquidations, type PersistedLiquidation } from "@/utils/liquidationState.js";
import type { PositionTracker } from "@/utils/positionTracker.js";
import type { LiquidationMarket, LiquidationStage, OrchestratorState } from "./types.js";
import type { OrchestratorConfig } from "./config.js";

/**
 * Calculates the maximum buy price (break-even ceiling) for liquidation.
 * 
 * This ensures we never place orders that would lock in losses.
 * 
 * @param tracker - Position tracker with cost basis
 * @param netExposure - Current net exposure (positive = long YES, negative = long NO)
 * @returns Maximum price to pay when buying to close, or null if no cost basis
 */
export function calculateMaxBuyPrice(
  tracker: PositionTracker,
  netExposure: number
): number | null {
  const isLongYes = netExposure > 0;
  
  if (isLongYes) {
    // Long YES: will buy NO to close. Break-even: buy NO at (1 - avgYesCost)
    const avgYesCost = tracker.getAverageCost("YES");
    return avgYesCost !== null ? (1 - avgYesCost) : null;
  } else {
    // Long NO: will buy YES to close. Break-even: buy YES at (1 - avgNoCost)
    const avgNoCost = tracker.getAverageCost("NO");
    return avgNoCost !== null ? (1 - avgNoCost) : null;
  }
}


/**
 * Manages all liquidation markets.
 * 
 * Called periodically (every 30s) to check each liquidation market
 * and place/update passive exit orders.
 * 
 * Removes markets from liquidation when position is closed (neutral).
 * 
 * @param client - Authenticated CLOB client
 * @param state - Orchestrator state
 * @param config - Orchestrator configuration
 */
export async function manageLiquidations(
  client: ClobClient,
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<void> {
  if (state.liquidationMarkets.length === 0) return;
  
  log(`[Liquidation] Managing ${state.liquidationMarkets.length} liquidation market(s)...`);
  
  // Process each liquidation market
  for (const liqMarket of state.liquidationMarkets) {
    try {
      await manageSingleLiquidation(client, liqMarket, config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`[Liquidation] Error on ${liqMarket.market.question.substring(0, 40)}...: ${msg}`);
    }
  }
  
  // Remove completed liquidations (neutral position reached)
  const completed = state.liquidationMarkets.filter((lm) => {
    const netExposure = lm.tracker.getNetExposure();
    return Math.abs(netExposure) < 0.1; // Consider neutral if < 0.1 shares
  });
  
  if (completed.length > 0) {
    log(`[Liquidation] ${completed.length} market(s) completed liquidation`);
    for (const lm of completed) {
      log(`[Liquidation] ✓ ${lm.market.question} - Position closed`);
      // Cancel any remaining orders
      if (lm.activeOrderId && !config.dryRun) {
        try {
          await cancelOrder(client, lm.activeOrderId);
        } catch (error) {
          log(`[Liquidation] Warning: Failed to cancel order ${lm.activeOrderId}: ${error}`);
        }
      }
    }
    
    // Remove from list
    state.liquidationMarkets = state.liquidationMarkets.filter(
      (lm) => !completed.includes(lm)
    );
    
    // Update persisted state
    saveLiquidationsState(state);
  }
}

/**
 * Saves current liquidation state to disk.
 * Called whenever liquidation queue changes.
 */
function saveLiquidationsState(state: OrchestratorState): void {
  const persistedLiquidations: PersistedLiquidation[] = state.liquidationMarkets.map(lm => ({
    conditionId: lm.market.conditionId,
    startedAt: lm.startedAt.getTime(),
    stage: lm.stage,
  }));
  
  saveLiquidations(persistedLiquidations);
}

/**
 * Manages a single liquidation market.
 * 
 * PASSIVE stage implementation with profit awareness and opportunistic orders:
 * - When price is favorable (at/above break-even): Quotes at midpoint for quick exit
 * - When price is unfavorable (below break-even): Places opportunistic order AT break-even
 *   - This captures fills if market moves favorably, without locking in losses
 * - Cancels and replaces orders when price targets change
 * 
 * Future enhancements:
 * - SKEWED: Gradually tighten spread after N minutes
 * - AGGRESSIVE: Cross spread partially after timeout
 * - MARKET: Force exit at any price on stop-loss trigger
 * 
 * @param client - Authenticated CLOB client
 * @param liqMarket - Liquidation market to manage
 * @param config - Orchestrator configuration
 */
async function manageSingleLiquidation(
  client: ClobClient,
  liqMarket: LiquidationMarket,
  config: OrchestratorConfig
): Promise<void> {
  const { market, config: mmConfig, tracker } = liqMarket;
  const netExposure = tracker.getNetExposure();
  
  // Skip if position is already neutral
  if (Math.abs(netExposure) < 0.1) {
    return;
  }
  
  // Determine which token to SELL to close position
  // If long YES (netExposure > 0), SELL YES tokens
  // If long NO (netExposure < 0), SELL NO tokens
  const isLongYes = netExposure > 0;
  const tokenId = isLongYes ? mmConfig.market.yesTokenId : mmConfig.market.noTokenId;
  const size = Math.abs(netExposure);
  
  // Get current midpoint
  const midpoint = await getMidpoint(client, mmConfig.market.yesTokenId);

  // Target price: SELL the token we hold
  // For YES token: sell at midpoint
  // For NO token: sell at (1 - midpoint)
  const desiredPrice = isLongYes ? midpoint : (1 - midpoint);

  const tickSize = mmConfig.market.tickSize;
  const tickSizeNum = typeof tickSize === "string" ? parseFloat(tickSize) : tickSize;

  // Apply profit floor: don't sell below our average cost (prevents locking in losses)
  const avgCost = tracker.getAverageCost(isLongYes ? "YES" : "NO");
  const floor = avgCost !== null ? avgCost : 0; // Minimum sell price = our cost
  const targetPriceRaw = Math.max(desiredPrice, floor);

  // Clamp to a reasonable range; some endpoints/tick sizes can produce tiny rounding artifacts.
  const clampedTargetRaw = Math.min(1 - tickSizeNum, Math.max(tickSizeNum, targetPriceRaw));
  const roundedPrice = Math.round(clampedTargetRaw / tickSizeNum) * tickSizeNum;

  const unrealizedPnL = tracker.getUnrealizedPnL(midpoint);
  const elapsed = (Date.now() - liqMarket.startedAt.getTime()) / 60000;
  const pnlStatus = unrealizedPnL >= 0 ? `✓ Profit=$${unrealizedPnL.toFixed(2)}` : `Loss=$${unrealizedPnL.toFixed(2)}`;
  const sellLabel = isLongYes ? "YES" : "NO";
  const isBelowFloor = floor > 0 && desiredPrice < floor - 1e-9;

  if (isBelowFloor) {
    log(
      `[Liquidation] ${market.question.substring(0, 45)}... | ` +
        `Stage=${liqMarket.stage} | NetExp=${netExposure.toFixed(2)} | ` +
        `Elapsed=${elapsed.toFixed(1)}min | ` +
        `⚠️  Price below floor: desired=$${desiredPrice.toFixed(4)}, min=$${floor.toFixed(4)} | ` +
        `UnrealizedPnL=$${unrealizedPnL.toFixed(2)} | ` +
        `Quote: SELL ${sellLabel} @ $${roundedPrice.toFixed(4)} x ${size.toFixed(1)}`
    );
  } else {
    log(
      `[Liquidation] ${market.question.substring(0, 45)}... | ` +
        `Stage=${liqMarket.stage} | NetExp=${netExposure.toFixed(2)} | ` +
        `Elapsed=${elapsed.toFixed(1)}min | ${pnlStatus} | ` +
        `Quote: SELL ${sellLabel} @ $${roundedPrice.toFixed(4)} x ${size.toFixed(1)}`
    );
  }

  // Check if we need to update the order (target price changed significantly)
  const shouldUpdate =
    liqMarket.lastMidpoint === null || Math.abs(roundedPrice - liqMarket.lastMidpoint) > 0.005; // 0.5 cent threshold
  
  if (!shouldUpdate && liqMarket.activeOrderId) {
    // Order still valid, no update needed
    return;
  }
  
  // Cancel old order BEFORE updating (always cancel when placing new order)
  if (liqMarket.activeOrderId) {
    if (config.dryRun) {
      log(`[Liquidation] [DRY RUN] Would cancel old order: ${liqMarket.activeOrderId.substring(0, 16)}...`);
    } else {
      let cancelled = false;
      try {
        await cancelOrder(client, liqMarket.activeOrderId);
        log(`[Liquidation] Cancelled previous order: ${liqMarket.activeOrderId.substring(0, 16)}...`);
        cancelled = true;
      } catch (error) {
        // IMPORTANT: If cancel fails, do NOT place a new order. Otherwise we can
        // end up with duplicates.
        log(`[Liquidation] Failed to cancel old order (verifying open status): ${error}`);

        // If the order is already filled/cancelled, cancel can fail. Verify whether
        // it still exists in open orders; if it doesn't, it's safe to proceed.
        try {
          const open = await getOpenOrders(client, tokenId);
          const stillOpen = open.some((o) => {
            const id = (o as { orderID?: string; id?: string }).orderID ?? (o as { id?: string }).id;
            return id === liqMarket.activeOrderId;
          });
          if (!stillOpen) {
            log(`[Liquidation] Old order not found in open orders; continuing`);
            cancelled = true;
          }
        } catch (verifyError) {
          log(`[Liquidation] Failed to verify open orders (skipping replace): ${verifyError}`);
        }
      }

      if (!cancelled) {
        return;
      }
    }
    liqMarket.activeOrderId = null;
  }
  
  // Update last quoted price
  liqMarket.lastMidpoint = roundedPrice;
  
  // Place new order
  if (config.dryRun) {
    log(`[Liquidation] [DRY RUN] Would place order`);
    return;
  }
  
  // Place new order
  try {
    const result = await placeOrder(client, {
      tokenId,
      side: Side.SELL, // Always SELL the token we hold
      price: roundedPrice,
      size,
      tickSize,
      negRisk: mmConfig.market.negRisk,
    });
    
    if (!result.success || !result.orderId) {
      throw new Error(result.errorMsg || "Order placement failed");
    }
    
    liqMarket.activeOrderId = result.orderId;
    log(`[Liquidation] Order placed: ${result.orderId.substring(0, 16)}...`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`[Liquidation] Failed to place order: ${msg}`);
  }
}
