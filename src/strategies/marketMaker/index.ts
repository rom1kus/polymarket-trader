/**
 * Market Maker Strategy - Main Entry Point
 *
 * A market maker bot that places BUY orders on both YES and NO tokens
 * around the current midpoint to earn Polymarket liquidity rewards.
 *
 * The strategy is USDC-only - it doesn't require holding YES/NO tokens upfront.
 * Instead of BUY YES + SELL YES, it places BUY YES + BUY NO orders which is
 * economically equivalent but more capital efficient.
 *
 * Features:
 * - **WebSocket real-time updates** - Reacts to price changes in ~50ms
 * - **USDC-only operation** - No token splitting required
 * - Position tracking with configurable limits
 * - Dry run mode for safe testing
 * - Fallback to REST polling when WebSocket disconnects
 *
 * Usage:
 *   1. Run: npm run selectMarket -- <event-slug> to generate config
 *   2. Edit src/strategies/marketMaker/config.ts with your parameters
 *   3. Set dryRun: false when ready for live trading
 *   4. Run: npm run marketMaker
 *   5. Press Ctrl+C to stop (will cancel all orders before exiting)
 */

import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { log } from "@/utils/helpers.js";
import { getUsdcBalance } from "@/utils/balance.js";
import { validateConfig, printBanner } from "./lifecycle.js";
import { runWithWebSocket, runWithPolling } from "./modes/index.js";
import { CONFIG } from "./config.js";
import type { MarketMakerConfig } from "./types.js";

/**
 * Main market maker entry point.
 */
async function runMarketMaker(config: MarketMakerConfig): Promise<void> {
  // Validate configuration
  validateConfig(config);

  // Print startup banner
  printBanner(config);

  // Initialize client
  log("Initializing authenticated client...");
  const client = await createAuthenticatedClobClient();
  log("Client initialized successfully");

  // =========================================================================
  // PRE-FLIGHT CHECKS - USDC balance check
  // =========================================================================
  log("\nRunning pre-flight checks...");

  // Check USDC balance is sufficient for order sizes
  const usdcBalance = await getUsdcBalance(client);
  log(`  USDC Balance: $${usdcBalance.balanceNumber.toFixed(2)}`);

  // Calculate minimum USDC needed:
  // - BUY YES @ ~(midpoint - offset) costs orderSize * price
  // - BUY NO @ ~(1 - midpoint - offset) costs orderSize * price
  // - Total ≈ orderSize * 1 = orderSize USDC per cycle
  // - Add buffer for multiple cycles before fills get sold
  // - Use 2x orderSize as minimum to allow for price movements
  const minUsdc = config.orderSize * 2;
  
  if (usdcBalance.balanceNumber < minUsdc) {
    throw new Error(
      `Insufficient USDC: have $${usdcBalance.balanceNumber.toFixed(2)}, need at least $${minUsdc.toFixed(2)} for order sizes (2x buffer)`
    );
  }

  // Warn if balance is low (less than 5x order size)
  const warningThreshold = config.orderSize * 5;
  if (usdcBalance.balanceNumber < warningThreshold) {
    log(`  WARNING: USDC balance is low. Consider adding more for sustained trading.`);
  }

  log("\nPre-flight checks PASSED\n");

  // =========================================================================
  // MAIN LOOP - WebSocket or Polling
  // =========================================================================

  const runnerContext = { config, client };

  if (config.webSocket.enabled) {
    await runWithWebSocket(runnerContext);
  } else {
    await runWithPolling(runnerContext);
  }
}

// Entry point
runMarketMaker(CONFIG).catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
