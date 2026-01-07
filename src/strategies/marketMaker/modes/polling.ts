/**
 * Market Maker Polling Mode - Traditional REST API polling.
 */

import { sleep, log } from "@/utils/helpers.js";
import { getMidpoint } from "@/utils/orders.js";
import { runPreFlightChecks } from "@/utils/inventory.js";
import { shouldRebalance } from "../quoter.js";
import { placeQuotes, cancelExistingOrders, executeSplitIfNeeded } from "../executor.js";
import { createInitialState, createShutdownHandler, registerShutdownHandlers } from "../lifecycle.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { JsonRpcProvider } from "@ethersproject/providers";
import type { SafeInstance } from "@/utils/ctf.js";
import type { MarketMakerConfig } from "../types.js";

export interface PollingRunnerContext {
  config: MarketMakerConfig;
  client: ClobClient;
  safe: SafeInstance;
  safeAddress: string;
  signerAddress: string;
  provider: JsonRpcProvider;
}

/**
 * Runs the market maker with traditional polling (no WebSocket).
 */
export async function runWithPolling(ctx: PollingRunnerContext): Promise<void> {
  const { config, client, safe, safeAddress, signerAddress, provider } = ctx;

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
      const hasQuotes = state.activeQuotes.bid !== null || state.activeQuotes.ask !== null;
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
        const bidInfo = state.activeQuotes.bid
          ? `$${state.activeQuotes.bid.price.toFixed(4)}`
          : "none";
        const askInfo = state.activeQuotes.ask
          ? `$${state.activeQuotes.ask.price.toFixed(4)}`
          : "none";
        log(`  Quotes still valid (Bid: ${bidInfo}, Ask: ${askInfo})`);
      }

      // 5. Periodic inventory check (every 10 cycles if autoSplit enabled)
      if (config.inventory.autoSplitEnabled && state.cycleCount % 10 === 0) {
        log("  Checking inventory...");
        const inventoryCheck = await runPreFlightChecks(
          client,
          config.market,
          config.orderSize,
          config.inventory,
          signerAddress,
          provider
        );

        if (inventoryCheck.deficit && inventoryCheck.deficit.splitAmount > 0) {
          log(`  Inventory low, topping up...`);
          await executeSplitIfNeeded(
            safe,
            safeAddress,
            provider,
            config,
            inventoryCheck.deficit.splitAmount
          );
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ERROR: ${errorMsg}`);
      state.lastError = errorMsg;
    }

    // 6. Wait for next cycle
    await sleep(config.refreshIntervalMs);
  }
}
