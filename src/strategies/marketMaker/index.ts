/**
 * Market Maker Strategy - Main Entry Point
 *
 * A market maker bot that places two-sided limit orders around the
 * current midpoint to earn Polymarket liquidity rewards.
 *
 * Features:
 * - **WebSocket real-time updates** - Reacts to price changes in ~50ms
 * - Pre-flight checks (balance validation, MATIC for gas)
 * - Auto-split USDC into YES+NO tokens for two-sided liquidity
 * - All CTF operations executed through Safe (Gnosis Safe) account
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

import { Wallet } from "@ethersproject/wallet";
import { createAuthenticatedClobClient } from "@/utils/authClient.js";
import { log } from "@/utils/helpers.js";
import { env } from "@/utils/env.js";
import { getPolygonProvider, createSafeForCtf } from "@/utils/ctf.js";
import { runPreFlightChecks, formatInventoryStatus } from "@/utils/inventory.js";
import { validateConfig, printBanner } from "./lifecycle.js";
import { executeSplitIfNeeded } from "./executor.js";
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

  // Initialize client and Safe wallet
  log("Initializing authenticated client...");
  const client = await createAuthenticatedClobClient();
  log("Client initialized successfully");

  // Initialize Safe for CTF operations
  log("Initializing Safe wallet for CTF operations...");
  const safeAddress = env.POLYMARKET_PROXY_ADDRESS;
  const signerAddress = new Wallet(env.FUNDER_PRIVATE_KEY).address;
  const safe = await createSafeForCtf({
    signerPrivateKey: env.FUNDER_PRIVATE_KEY,
    safeAddress,
  });
  const provider = getPolygonProvider();
  log(`Safe initialized: ${safeAddress}`);
  log(`Signer (gas payer): ${signerAddress}`);

  // =========================================================================
  // PRE-FLIGHT CHECKS
  // =========================================================================
  log("\nRunning pre-flight checks...");

  const preflight = await runPreFlightChecks(
    client,
    config.market,
    config.orderSize,
    config.inventory,
    signerAddress, // Use signer address for MATIC gas balance check
    provider
  );

  // Show current inventory
  log("\nCurrent inventory:");
  console.log(formatInventoryStatus(preflight.status));

  // Show warnings
  for (const warning of preflight.warnings) {
    log(`  WARNING: ${warning}`);
  }

  // Fail on errors
  if (!preflight.ready) {
    log("\nPre-flight checks FAILED:");
    for (const error of preflight.errors) {
      log(`  ERROR: ${error}`);
    }
    throw new Error("Pre-flight checks failed. Cannot start market maker.");
  }

  // Execute split if needed
  if (preflight.deficit && preflight.deficit.splitAmount > 0) {
    await executeSplitIfNeeded(
      safe,
      safeAddress,
      provider,
      config,
      preflight.deficit.splitAmount
    );
  }

  log("\nPre-flight checks PASSED\n");

  // =========================================================================
  // MAIN LOOP - WebSocket or Polling
  // =========================================================================

  const runnerContext = { config, client, safe, safeAddress, signerAddress, provider };

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
