/**
 * Market Maker Polling Mode - Traditional REST API polling.
 *
 * Supports orchestrator integration via:
 * - `onNeutralPosition`: Callback when neutral position detected (for logging)
 * - `onCheckPendingSwitch`: Callback after position changes to check if should exit (returns true to stop)
 * - Returns `MarketMakerResult` with exit reason and final state
 */

import { sleep, log } from "@/utils/helpers.js";
import { getMidpoint } from "@/utils/orders.js";
import { createSafeForCtf, type SafeInstance } from "@/utils/ctf.js";
import { getEnvRequired } from "@/utils/env.js";
import { shouldRebalance } from "../quoter.js";
import { placeQuotes, cancelExistingOrders } from "../executor.js";
import { createInitialState, createShutdownHandler, registerShutdownHandlers, createPositionTracker, checkAndMergeNeutralPosition } from "../lifecycle.js";
import type { ClobClient } from "@polymarket/clob-client";
import type { MarketMakerConfig, MarketMakerResult, OrchestratableMarketMakerConfig } from "../types.js";
import type { PositionTracker } from "@/utils/positionTracker.js";

export interface PollingRunnerContext {
  config: MarketMakerConfig | OrchestratableMarketMakerConfig;
  client: ClobClient;
}

/**
 * Runs the market maker with traditional polling (no WebSocket).
 *
 * @returns MarketMakerResult with exit reason and final state
 */
export async function runWithPolling(ctx: PollingRunnerContext): Promise<MarketMakerResult> {
  const { config, client } = ctx;

  // Extract orchestrator options (with defaults for backward compatibility)
  const onNeutralPosition = (config as OrchestratableMarketMakerConfig).onNeutralPosition;
  const onCheckPendingSwitch = (config as OrchestratableMarketMakerConfig).onCheckPendingSwitch;

  // Initialize state
  const state = createInitialState();

  // Track exit reason for return value
  let exitReason: MarketMakerResult["reason"] = "shutdown";
  let exitError: Error | undefined;

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

  /**
   * Checks if orchestrator has a pending switch and we're neutral.
   * If so, signals the market maker to stop.
   */
  const checkPendingSwitchAndMaybeExit = (): boolean => {
    if (!positionTracker || !onCheckPendingSwitch) return false;
    
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
      return true;
    }
    return false;
  };

  // Create and register shutdown handler
  const shutdown = createShutdownHandler(state, client, config);
  registerShutdownHandlers(shutdown);

  // Main loop
  while (state.running) {
    state.cycleCount++;

    try {
      // 1. Check and merge neutral position FIRST
      // This frees up locked USDC before placing new orders
      const mergeResult = await checkAndMergeNeutralPosition(positionTracker, safe, config);
      if (mergeResult.merged) {
        log(`Merged ${mergeResult.amount.toFixed(2)} neutral tokens -> $${mergeResult.amount.toFixed(2)} USDC freed`);
        // Update session stats
        state.stats.mergeCount++;
        state.stats.totalMerged += mergeResult.amount;
      }

      // 2. Notify orchestrator of neutral position (for logging)
      if (positionTracker && onNeutralPosition) {
        const position = positionTracker.getPositionState();
        // Neutral = has tokens AND no directional exposure
        if (position.neutralPosition > 0 && position.netExposure === 0) {
          onNeutralPosition({
            yesTokens: position.yesTokens,
            noTokens: position.noTokens,
            netExposure: position.netExposure,
            neutralPosition: position.neutralPosition,
          });
        }
      }

      // 3. Check if orchestrator wants to switch (after merge)
      if (checkPendingSwitchAndMaybeExit()) {
        break;
      }

      // 4. Get current midpoint
      const midpoint = await getMidpoint(client, config.market.yesTokenId);
      
      // Build log line with P&L if position tracking is enabled
      let logLine = `Cycle #${state.cycleCount} | Midpoint: $${midpoint.toFixed(4)}`;
      if (positionTracker) {
        logLine += ` | ${positionTracker.formatPnLCompact(midpoint)}`;
      }
      log(logLine);

      // 5. Check if we need to rebalance
      const hasQuotes = state.activeQuotes.yesQuote !== null || state.activeQuotes.noQuote !== null;
      const needsRebalance =
        mergeResult.merged || // Force rebalance after merge
        !hasQuotes ||
        shouldRebalance(midpoint, state.activeQuotes.lastMidpoint, config.rebalanceThreshold);

      if (needsRebalance) {
        const reason = mergeResult.merged
          ? "Merged neutral position"
          : !hasQuotes
            ? "No active quotes"
            : "Midpoint moved";
        log(`  ${reason}, rebalancing...`);

        // 6. Cancel existing orders
        if (hasQuotes) {
          await cancelExistingOrders(client, config);
          state.stats.ordersCancelled += 2; // YES + NO orders
        }

        // 7. Place new quotes
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
      
      // 8. Check if orchestrator wants to switch after rebalance
      // This catches neutral positions even if no fills occurred
      if (checkPendingSwitchAndMaybeExit()) {
        break;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  ERROR: ${errorMsg}`);
      state.lastError = errorMsg;
    }

    // 9. Wait for next cycle
    await sleep(config.refreshIntervalMs);
  }

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
