/**
 * Market Maker Polling Mode - Traditional REST API polling.
 */

import { sleep, log } from "@/utils/helpers.js";
import { getMidpoint } from "@/utils/orders.js";
import { shouldRebalance } from "../quoter.js";
import { placeQuotes, cancelExistingOrders } from "../executor.js";
import { createInitialState, createShutdownHandler, registerShutdownHandlers } from "../lifecycle.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerConfig } from "../types.js";

export interface PollingRunnerContext {
  config: MarketMakerConfig;
  client: ClobClient;
}

/**
 * Runs the market maker with traditional polling (no WebSocket).
 */
export async function runWithPolling(ctx: PollingRunnerContext): Promise<void> {
  const { config, client } = ctx;

  // Initialize state
  const state = createInitialState();

  // Create and register shutdown handler
  const shutdown = createShutdownHandler(state, client, config);
  registerShutdownHandlers(shutdown);

  // Main loop
  while (state.running) {
    state.cycleCount++;

    try {
      // 1. Get current midpoint
      const midpoint = await getMidpoint(client, config.market.yesTokenId);
      log(`Cycle #${state.cycleCount} | Midpoint: $${midpoint.toFixed(4)}`);

      // 2. Check if we need to rebalance
      const hasQuotes = state.activeQuotes.yesQuote !== null || state.activeQuotes.noQuote !== null;
      const needsRebalance =
        !hasQuotes ||
        shouldRebalance(midpoint, state.activeQuotes.lastMidpoint, config.rebalanceThreshold);

      if (needsRebalance) {
        const reason = !hasQuotes ? "No active quotes" : "Midpoint moved";
        log(`  ${reason}, rebalancing...`);

        // 3. Cancel existing orders
        if (hasQuotes) {
          await cancelExistingOrders(client, config);
        }

        // 4. Place new quotes
        state.activeQuotes = await placeQuotes(client, config, midpoint);
        state.lastError = null;
      } else {
        const yesInfo = state.activeQuotes.yesQuote
          ? `$${state.activeQuotes.yesQuote.price.toFixed(4)}`
          : "none";
        const noInfo = state.activeQuotes.noQuote
          ? `$${state.activeQuotes.noQuote.price.toFixed(4)}`
          : "none";
        log(`  Quotes still valid (YES: ${yesInfo}, NO: ${noInfo})`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ERROR: ${errorMsg}`);
      state.lastError = errorMsg;
    }

    // 5. Wait for next cycle
    await sleep(config.refreshIntervalMs);
  }
}
