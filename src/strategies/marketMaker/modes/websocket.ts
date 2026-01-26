/**
 * Market Maker WebSocket Mode - Real-time price updates with fallback polling.
 *
 * Supports orchestrator integration via:
 * - `onNeutralPosition`: Callback when neutral position detected (for logging)
 * - `onCheckPendingSwitch`: Callback after fills to check if should exit (returns true to stop)
 * - Returns `MarketMakerResult` with exit reason and final state
 */

import { log } from "@/utils/helpers.js";
import { getMidpoint } from "@/utils/orders.js";
import { PolymarketWebSocket, TrailingDebounce } from "@/utils/websocket.js";
import { UserWebSocket, tradeEventToFill, type TokenIdMapping, type OrderLookup } from "@/utils/userWebsocket.js";
import { getOrderTracker } from "@/utils/orderTracker.js";
import { createSafeForCtf, type SafeInstance } from "@/utils/ctf.js";
import { getEnvRequired } from "@/utils/env.js";
import { shouldRebalance } from "../quoter.js";
import { placeQuotes, cancelExistingOrders } from "../executor.js";
import { createInitialState, createShutdownHandler, registerShutdownHandlers, createPositionTracker, checkAndMergeNeutralPosition } from "../lifecycle.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerConfig, MarketMakerState, MarketMakerResult, OrchestratableMarketMakerConfig } from "../types.js";
import type { PositionTracker } from "@/utils/positionTracker.js";

export interface WebSocketRunnerContext {
  config: MarketMakerConfig | OrchestratableMarketMakerConfig;
  client: ClobClient;
}

/**
 * Runs the market maker with WebSocket real-time updates.
 * Falls back to polling when WebSocket is disconnected.
 *
 * @returns MarketMakerResult with exit reason and final state
 */
export async function runWithWebSocket(ctx: WebSocketRunnerContext): Promise<MarketMakerResult> {
  const { config, client } = ctx;

  // Extract orchestrator options (with defaults for backward compatibility)
  const onNeutralPosition = (config as OrchestratableMarketMakerConfig).onNeutralPosition;
  const onCheckPendingSwitch = (config as OrchestratableMarketMakerConfig).onCheckPendingSwitch;

  // Initialize state
  const state: MarketMakerState = createInitialState();

  // Track exit reason for return value
  let exitReason: MarketMakerResult["reason"] = "shutdown";
  let exitError: Error | undefined;

  // Resolver for the main loop promise (used for pending switch exit)
  let resolveMainLoop: (() => void) | null = null;

  // Lock to prevent concurrent rebalances
  let isRebalancing = false;

  // Fallback polling timer
  let fallbackTimer: NodeJS.Timeout | null = null;
  
  // Periodic pending switch check timer (runs every 10 seconds)
  // This catches edge cases where neutral position exists but no fills/rebalances happen
  let pendingSwitchCheckTimer: NodeJS.Timeout | null = null;

  // Initialize position tracker for position limits
  const positionTracker: PositionTracker | null = await createPositionTracker(client, config);

  // Initialize Safe instance for CTF operations (merge)
  // Only needed if merge is enabled and not in dry run mode
  let safe: SafeInstance | null = null;
  if (config.merge.enabled && !config.dryRun) {
    try {
      log("Initializing Safe for CTF operations (merge)...");
      safe = await createSafeForCtf({
        signerPrivateKey: getEnvRequired("FUNDER_PRIVATE_KEY"),
        safeAddress: getEnvRequired("POLYMARKET_PROXY_ADDRESS"),
      });
      log("Safe initialized for merge operations");
    } catch (error) {
      log(`Warning: Failed to initialize Safe for merge: ${error}`);
      log("Merge operations will be disabled");
    }
  }

  // User WebSocket for fill notifications (only if position tracking is enabled)
  let userWs: UserWebSocket | null = null;

  /**
   * Checks if orchestrator has a pending switch and we're neutral.
   * If so, signals the market maker to stop.
   */
  const checkPendingSwitchAndMaybeExit = (): void => {
    if (!positionTracker || !onCheckPendingSwitch) return;
    
    const position = positionTracker.getPositionState();
    const shouldStop = onCheckPendingSwitch({
      yesTokens: position.yesTokens,
      noTokens: position.noTokens,
      netExposure: position.netExposure,
      neutralPosition: position.neutralPosition,
    });
    
    if (shouldStop) {
      log("");
      log("╔════════════════════════════════════════════════════════════════╗");
      log("║  PENDING SWITCH READY - Position is neutral, stopping...       ║");
      log("╚════════════════════════════════════════════════════════════════╝");
      log(`  YES: ${position.yesTokens.toFixed(2)}, NO: ${position.noTokens.toFixed(2)}`);
      
      exitReason = "neutral";
      state.running = false;
      if (resolveMainLoop) {
        resolveMainLoop();
      }
    }
  };

  /**
   * Executes a rebalance cycle.
   * @param midpoint - Current market midpoint
   * @param source - Source of the rebalance trigger (for logging)
   * @param force - Force rebalance even if midpoint hasn't moved (e.g., position limit change)
   * @returns true if should continue, false if should exit
   */
  const executeRebalance = async (midpoint: number, source: string, force: boolean = false): Promise<boolean> => {
    // Prevent concurrent rebalances
    if (isRebalancing) {
      return true;
    }
    isRebalancing = true;

    try {
      state.cycleCount++;
      
      // === Check and merge neutral position FIRST ===
      // This frees up locked USDC before placing new orders
      const mergeResult = await checkAndMergeNeutralPosition(positionTracker, safe, config);
      if (mergeResult.merged) {
        log(`  Merged ${mergeResult.amount.toFixed(2)} neutral tokens -> $${mergeResult.amount.toFixed(2)} USDC freed`);
        // Update session stats
        state.stats.mergeCount++;
        state.stats.totalMerged += mergeResult.amount;
        
        // Check if orchestrator wants to switch after merge (position may now be neutral)
        checkPendingSwitchAndMaybeExit();
      }

      // === Notify orchestrator of neutral position (for logging) ===
      if (positionTracker && onNeutralPosition) {
        const position = positionTracker.getPositionState();
        if (position.neutralPosition > 0 && position.netExposure === 0) {
          onNeutralPosition({
            yesTokens: position.yesTokens,
            noTokens: position.noTokens,
            netExposure: position.netExposure,
            neutralPosition: position.neutralPosition,
          });
        }
      }
      
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
        mergeResult.merged || // Force rebalance after merge to reflect new USDC balance
        !hasQuotes ||
        shouldRebalance(midpoint, state.activeQuotes.lastMidpoint, config.rebalanceThreshold);

      if (needsRebalance) {
        const reason = mergeResult.merged
          ? "Merged neutral position"
          : force
            ? "Position limit changed"
            : !hasQuotes
              ? "No active quotes"
              : "Midpoint moved";
        log(`  ${reason}, rebalancing...`);

        // Cancel existing orders
        if (hasQuotes) {
          await cancelExistingOrders(client, config);
          state.stats.ordersCancelled += 2; // YES + NO orders
        }

        // Place new quotes
        state.activeQuotes = await placeQuotes(client, config, midpoint, positionTracker);
        state.stats.rebalanceCount++;
        // Count orders placed (1 for each non-null quote)
        if (state.activeQuotes.yesQuote) state.stats.ordersPlaced++;
        if (state.activeQuotes.noQuote) state.stats.ordersPlaced++;
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
      
      // Check if orchestrator wants to switch after rebalance
      // This catches neutral positions even if no fills occurred
      checkPendingSwitchAndMaybeExit();
      
      return true; // Continue running
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ERROR: ${errorMsg}`);
      state.lastError = errorMsg;
      return true; // Continue despite error
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
  
  /**
   * Starts periodic pending switch check timer.
   * Checks every 10 seconds if orchestrator wants to switch.
   */
  const startPendingSwitchCheckTimer = (): void => {
    if (pendingSwitchCheckTimer || !onCheckPendingSwitch) return;
    
    pendingSwitchCheckTimer = setInterval(() => {
      if (state.running) {
        checkPendingSwitchAndMaybeExit();
      }
    }, 10_000); // Check every 10 seconds
  };
  
  /**
   * Stops pending switch check timer.
   */
  const stopPendingSwitchCheckTimer = (): void => {
    if (pendingSwitchCheckTimer) {
      clearInterval(pendingSwitchCheckTimer);
      pendingSwitchCheckTimer = null;
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
    onMidpointUpdate: (tokenId, midpoint, timestamp) => {
      // Sanity check: Only process updates for the YES token we subscribed to
      // Note: Polymarket may send updates for both YES and NO tokens (mirrored orderbooks)
      // but the WebSocket class should filter NO tokens automatically
      if (tokenId !== config.market.yesTokenId) {
        log(`  ⚠️ Unexpected midpoint update for token ${tokenId.slice(0, 10)}... (mid: ${midpoint.toFixed(4)})`);
        return;
      }
      
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
    stopPendingSwitchCheckTimer();
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
            // Capture limit status BEFORE processing fill
            const limitStatusBefore = positionTracker.getLimitStatus();
            
            // Pass our API key and order tracker for correct maker/taker attribution
            const orderTracker = getOrderTracker();
            const fill = tradeEventToFill(trade, tokenMapping, client.creds?.key ?? "", orderTracker);
            
            const isNew = positionTracker.processFill(fill);
            
            if (isNew) {
              // Update session stats
              state.stats.fillCount++;
              state.stats.totalVolume += fill.price * fill.size;
              
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
              
              // Check if orchestrator wants to switch (after each fill)
              // This allows the orchestrator to exit when: pendingSwitch exists AND neutral
              checkPendingSwitchAndMaybeExit();
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
    log(`  Initial REST midpoint: ${initialMidpoint.toFixed(4)} (YES token: ${config.market.yesTokenId.slice(0, 10)}...)`);
    await executeRebalance(initialMidpoint, "initial REST");
    
    // Start periodic pending switch check if orchestrator integration is enabled
    if (onCheckPendingSwitch) {
      startPendingSwitchCheckTimer();
    }

  } catch (error) {
    log(`WebSocket connection failed, falling back to polling: ${error}`);
    startFallbackPolling();
  }

  // Keep the process running
  // The event loop is kept alive by WebSocket and timers
  await new Promise<void>((resolve) => {
    resolveMainLoop = resolve;
    const checkInterval = setInterval(() => {
      if (!state.running) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });

  // Build and return result
  const finalPosition = positionTracker
    ? positionTracker.getPositionState()
    : undefined;

  return {
    reason: exitReason,
    finalPosition,
    error: exitError,
    stats: state.stats,
  };
}
