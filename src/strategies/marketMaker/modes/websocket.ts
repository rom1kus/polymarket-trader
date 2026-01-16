/**
 * Market Maker WebSocket Mode - Real-time price updates with fallback polling.
 */

import { log } from "@/utils/helpers.js";
import { getMidpoint } from "@/utils/orders.js";
import { PolymarketWebSocket, TrailingDebounce } from "@/utils/websocket.js";
import { UserWebSocket, tradeEventToFill, type TokenIdMapping, type OrderLookup } from "@/utils/userWebsocket.js";
import { getOrderTracker } from "@/utils/orderTracker.js";
import { shouldRebalance } from "../quoter.js";
import { placeQuotes, cancelExistingOrders } from "../executor.js";
import { createInitialState, createShutdownHandler, registerShutdownHandlers, createPositionTracker } from "../lifecycle.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerConfig, MarketMakerState } from "../types.js";
import type { PositionTracker } from "@/utils/positionTracker.js";

export interface WebSocketRunnerContext {
  config: MarketMakerConfig;
  client: ClobClient;
}

/**
 * Runs the market maker with WebSocket real-time updates.
 * Falls back to polling when WebSocket is disconnected.
 */
export async function runWithWebSocket(ctx: WebSocketRunnerContext): Promise<void> {
  const { config, client } = ctx;

  // Initialize state
  const state: MarketMakerState = createInitialState();

  // Lock to prevent concurrent rebalances
  let isRebalancing = false;

  // Fallback polling timer
  let fallbackTimer: NodeJS.Timeout | null = null;

  // Initialize position tracker for position limits
  const positionTracker: PositionTracker | null = await createPositionTracker(client, config);

  // User WebSocket for fill notifications (only if position tracking is enabled)
  let userWs: UserWebSocket | null = null;

  /**
   * Executes a rebalance cycle.
   * @param midpoint - Current market midpoint
   * @param source - Source of the rebalance trigger (for logging)
   * @param force - Force rebalance even if midpoint hasn't moved (e.g., position limit change)
   */
  const executeRebalance = async (midpoint: number, source: string, force: boolean = false): Promise<void> => {
    // Prevent concurrent rebalances
    if (isRebalancing) {
      return;
    }
    isRebalancing = true;

    try {
      state.cycleCount++;
      
      // Build rebalance log line with P&L if position tracking is enabled
      let logLine = `Rebalance #${state.cycleCount} | Mid: $${midpoint.toFixed(4)} (${source})`;
      if (positionTracker) {
        logLine += ` | ${positionTracker.formatPnLCompact(midpoint)}`;
      }
      log(logLine);

      // Check if we need to rebalance
      const hasQuotes = state.activeQuotes.yesQuote !== null || state.activeQuotes.noQuote !== null;
      const needsRebalance =
        force ||
        !hasQuotes ||
        shouldRebalance(midpoint, state.activeQuotes.lastMidpoint, config.rebalanceThreshold);

      if (needsRebalance) {
        const reason = force ? "Position limit changed" : (!hasQuotes ? "No active quotes" : "Midpoint moved");
        log(`  ${reason}, rebalancing...`);

        // Cancel existing orders
        if (hasQuotes) {
          await cancelExistingOrders(client, config);
        }

        // Place new quotes
        state.activeQuotes = await placeQuotes(client, config, midpoint, positionTracker);
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
    if (userWs) {
      userWs.disconnect();
    }
  });
  registerShutdownHandlers(shutdown);

  // Connect to WebSocket
  log("Connecting to WebSocket...");
  try {
    await ws.connect();
    log("WebSocket connected, waiting for price updates...");

    // Connect to user WebSocket for fill notifications (if position tracking enabled)
    if (positionTracker && client.creds) {
      log("Connecting to user WebSocket for fill tracking...");
      
      // Create token mapping for fill conversion
      const tokenMapping: TokenIdMapping = {
        yesTokenId: config.market.yesTokenId,
        noTokenId: config.market.noTokenId,
      };
      
      userWs = new UserWebSocket({
        apiKey: client.creds.key,
        apiSecret: client.creds.secret,
        passphrase: client.creds.passphrase,
        onTrade: async (trade) => {
          // Filter by market condition ID (not asset_id, since NO trades report YES asset_id)
          if (trade.market === config.market.conditionId) {
            // === VERBOSE DEBUG LOGGING ===
            log(`[DEBUG] Raw trade event:`);
            log(`  id: ${trade.id}`);
            log(`  side: ${trade.side}, price: ${trade.price}, size: ${trade.size}`);
            log(`  outcome: ${trade.outcome}, asset_id: ${trade.asset_id.substring(0, 20)}...`);
            log(`  owner: ${trade.owner.substring(0, 16)}...`);
            log(`  trade_owner: ${trade.trade_owner.substring(0, 16)}...`);
            log(`  taker_order_id: ${trade.taker_order_id.substring(0, 16)}...`);
            log(`  maker_orders (${trade.maker_orders.length}):`);
            for (const mo of trade.maker_orders) {
              log(`    - order_id: ${mo.order_id.substring(0, 16)}...`);
              log(`      outcome: ${mo.outcome}, price: ${mo.price}, matched: ${mo.matched_amount}`);
              log(`      owner: ${mo.owner.substring(0, 16)}...`);
              log(`      asset_id: ${mo.asset_id.substring(0, 20)}...`);
            }
            log(`  Our API key: ${client.creds?.key.substring(0, 16)}...`);
            // === END DEBUG LOGGING ===
            
            // Capture limit status BEFORE processing fill
            const limitStatusBefore = positionTracker.getLimitStatus();
            
            // Pass our API key and order tracker for correct maker/taker attribution
            const orderTracker = getOrderTracker();
            const fill = tradeEventToFill(trade, tokenMapping, client.creds?.key ?? "", orderTracker);
            
            // Log what we converted the fill to
            log(`[DEBUG] Converted fill:`);
            log(`  side: ${fill.side}, price: ${fill.price.toFixed(4)}, size: ${fill.size.toFixed(4)}`);
            log(`  outcome: ${fill.outcome}, tokenId: ${fill.tokenId.substring(0, 20)}...`);
            log(`  orderId: ${fill.orderId.substring(0, 16)}...`);
            
            const isNew = positionTracker.processFill(fill);
            
            if (isNew) {
              // Log P&L after fill (uses current midpoint)
              const currentMidpoint = debounce.getLatestValue() ?? 0.5;
              log(positionTracker.formatPnLStatus(currentMidpoint));
              
              // Check if position limits status changed AFTER processing fill
              const limitStatusAfter = positionTracker.getLimitStatus();
              
              // Trigger rebalance if:
              // 1. We just hit a limit (need to stop quoting blocked side)
              // 2. We just cleared a limit (can start quoting again)
              // 3. Blocked side changed (e.g., from BUY blocked to SELL blocked)
              const limitChanged = 
                limitStatusBefore.isLimitReached !== limitStatusAfter.isLimitReached ||
                limitStatusBefore.blockedSide !== limitStatusAfter.blockedSide;
              
              if (limitChanged) {
                log("  Position limit status changed, triggering rebalance...");
                
                // Get current midpoint for rebalance
                // Use debounce's latest value if available, otherwise fetch
                const currentMidpoint = debounce.getLatestValue();
                if (currentMidpoint !== null) {
                  // Don't await - let it run async to not block WebSocket processing
                  // Force rebalance since position limits changed (not just midpoint)
                  executeRebalance(currentMidpoint, "fill", true).catch((err) => {
                    log(`  Fill-triggered rebalance error: ${err}`);
                  });
                } else {
                  // Fetch midpoint and rebalance
                  getMidpoint(client, config.market.yesTokenId)
                    .then((midpoint) => executeRebalance(midpoint, "fill", true))
                    .catch((err) => {
                      log(`  Fill-triggered rebalance error: ${err}`);
                    });
                }
              }
            }
          }
        },
        onConnected: () => {
          log("User WebSocket connected");
        },
        onDisconnected: () => {
          log("User WebSocket disconnected");
        },
        onError: (error) => {
          log(`User WebSocket error: ${error.message}`);
        },
        onReconnecting: (attempt) => {
          log(`User WebSocket reconnecting (attempt ${attempt})...`);
        },
      });

      try {
        await userWs.connect();
        // Small delay to ensure auth is processed before placing orders
        // This prevents a race condition where fills could be missed
        await new Promise(resolve => setTimeout(resolve, 500));
        log("User WebSocket ready for fill tracking");
      } catch (error) {
        log(`User WebSocket connection failed: ${error}`);
        // Continue without user WebSocket - position tracking will be stale
        // but that's better than crashing
      }
    }

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
