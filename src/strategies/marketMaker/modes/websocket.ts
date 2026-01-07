/**
 * Market Maker WebSocket Mode - Real-time price updates with fallback polling.
 */

import { log } from "@/utils/helpers.js";
import { getMidpoint } from "@/utils/orders.js";
import { runPreFlightChecks } from "@/utils/inventory.js";
import { PolymarketWebSocket, TrailingDebounce } from "@/utils/websocket.js";
import { shouldRebalance } from "../quoter.js";
import { placeQuotes, cancelExistingOrders, executeSplitIfNeeded } from "../executor.js";
import { createInitialState, createShutdownHandler, registerShutdownHandlers } from "../lifecycle.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { JsonRpcProvider } from "@ethersproject/providers";
import type { SafeInstance } from "@/utils/ctf.js";
import type { MarketMakerConfig, MarketMakerState } from "../types.js";

export interface WebSocketRunnerContext {
  config: MarketMakerConfig;
  client: ClobClient;
  safe: SafeInstance;
  safeAddress: string;
  signerAddress: string;
  provider: JsonRpcProvider;
}

/**
 * Runs the market maker with WebSocket real-time updates.
 * Falls back to polling when WebSocket is disconnected.
 */
export async function runWithWebSocket(ctx: WebSocketRunnerContext): Promise<void> {
  const { config, client, safe, safeAddress, signerAddress, provider } = ctx;

  // Initialize state
  const state: MarketMakerState = createInitialState();

  // Track inventory check cycles
  let rebalanceCount = 0;

  // Lock to prevent concurrent rebalances
  let isRebalancing = false;

  // Fallback polling timer
  let fallbackTimer: NodeJS.Timeout | null = null;

  /**
   * Executes a rebalance cycle.
   */
  const executeRebalance = async (midpoint: number, source: string): Promise<void> => {
    // Prevent concurrent rebalances
    if (isRebalancing) {
      return;
    }
    isRebalancing = true;

    try {
      state.cycleCount++;
      rebalanceCount++;
      log(`Rebalance #${state.cycleCount} | Midpoint: $${midpoint.toFixed(4)} (via ${source})`);

      // Check if we need to rebalance
      const hasQuotes = state.activeQuotes.bid !== null || state.activeQuotes.ask !== null;
      const needsRebalance =
        !hasQuotes ||
        shouldRebalance(midpoint, state.activeQuotes.lastMidpoint, config.rebalanceThreshold);

      if (needsRebalance) {
        const reason = !hasQuotes ? "No active quotes" : "Midpoint moved";
        log(`  ${reason}, rebalancing...`);

        // Cancel existing orders
        if (hasQuotes) {
          await cancelExistingOrders(client, config);
        }

        // Place new quotes
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

      // Periodic inventory check (every 10 rebalances if autoSplit enabled)
      if (config.inventory.autoSplitEnabled && rebalanceCount % 10 === 0) {
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
    } finally {
      isRebalancing = false;
    }
  };

  /**
   * Starts fallback polling when WebSocket is disconnected.
   */
  const startFallbackPolling = (): void => {
    if (fallbackTimer) return;

    log("Starting fallback polling...");
    fallbackTimer = setInterval(async () => {
      if (!state.running) return;

      try {
        const midpoint = await getMidpoint(client, config.market.yesTokenId);
        await executeRebalance(midpoint, "REST fallback");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`Fallback polling error: ${errorMsg}`);
      }
    }, config.webSocket.fallbackPollingMs);
  };

  /**
   * Stops fallback polling when WebSocket reconnects.
   */
  const stopFallbackPolling = (): void => {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
      log("Stopped fallback polling (WebSocket reconnected)");
    }
  };

  // Create trailing debounce for midpoint updates
  const debounce = new TrailingDebounce(
    async (midpoint: number) => {
      if (!state.running) return;
      await executeRebalance(midpoint, "WebSocket");
    },
    config.webSocket.debounceMs
  );

  // Create WebSocket manager
  const ws = new PolymarketWebSocket({
    tokenIds: [config.market.yesTokenId],
    onMidpointUpdate: (_tokenId, midpoint, timestamp) => {
      // Update debounce with new midpoint
      debounce.update(midpoint, timestamp);
    },
    onConnected: () => {
      log("WebSocket connected");
      stopFallbackPolling();
    },
    onDisconnected: () => {
      log("WebSocket disconnected");
      if (state.running) {
        startFallbackPolling();
      }
    },
    onReconnecting: (attempt) => {
      log(`WebSocket reconnecting (attempt ${attempt})...`);
    },
    onError: (error) => {
      log(`WebSocket error: ${error.message}`);
    },
    pingIntervalMs: config.webSocket.pingIntervalMs,
    reconnectDelayMs: config.webSocket.reconnectDelayMs,
    maxReconnectDelayMs: config.webSocket.maxReconnectDelayMs,
  });

  // Create and register shutdown handler
  const shutdown = createShutdownHandler(state, client, config, () => {
    debounce.cancel();
    stopFallbackPolling();
    ws.disconnect();
  });
  registerShutdownHandlers(shutdown);

  // Connect to WebSocket
  log("Connecting to WebSocket...");
  try {
    await ws.connect();
    log("WebSocket connected, waiting for price updates...");

    // Do an initial rebalance using REST to get started immediately
    const initialMidpoint = await getMidpoint(client, config.market.yesTokenId);
    await executeRebalance(initialMidpoint, "initial REST");

  } catch (error) {
    log(`WebSocket connection failed, falling back to polling: ${error}`);
    startFallbackPolling();
  }

  // Keep the process running
  // The event loop is kept alive by WebSocket and timers
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (!state.running) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });
}
