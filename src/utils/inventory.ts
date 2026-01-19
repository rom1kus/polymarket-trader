/**
 * Inventory management utilities for market making strategies.
 *
 * Provides functions for checking balances, calculating requirements,
 * and ensuring sufficient inventory for two-sided liquidity.
 *
 * All CTF operations (split/merge) are executed through the Safe
 * (Gnosis Safe) account to ensure proper wallet ownership.
 */

import type { ClobClient } from "@polymarket/clob-client";
import type { JsonRpcProvider } from "@ethersproject/providers";
import { getUsdcBalance, getTokenBalance } from "@/utils/balance.js";
import {
  getMaticBalance,
  approveAndSplitFromSafe,
  mergePositionsFromSafe,
  type SafeInstance,
} from "@/utils/ctf.js";
import { MIN_MATIC_BALANCE } from "@/config/contracts.js";
import { log } from "@/utils/helpers.js";
import type { MarketParams } from "@/types/strategy.js";
import type { InventoryConfig, CtfOperationResult } from "@/types/inventory.js";
import type {
  InventoryStatus,
  InventoryRequirements,
  InventoryDeficit,
  PreFlightResult,
} from "@/types/inventory.js";

/**
 * Gets the current inventory status for a market.
 *
 * @param client - Authenticated ClobClient for balance queries
 * @param market - Market parameters (token IDs)
 * @param signerAddress - Address of the signer (funder) for MATIC gas balance check
 * @param provider - Polygon provider for MATIC balance
 * @returns Current inventory status
 */
export async function getInventoryStatus(
  client: ClobClient,
  market: MarketParams,
  signerAddress: string,
  provider: JsonRpcProvider
): Promise<InventoryStatus> {
  // Fetch all balances in parallel
  // Note: MATIC is checked on the signer (funder) address since they pay gas
  const [usdcInfo, yesInfo, noInfo, matic] = await Promise.all([
    getUsdcBalance(client),
    getTokenBalance(client, market.yesTokenId),
    getTokenBalance(client, market.noTokenId),
    getMaticBalance(signerAddress, provider),
  ]);

  return {
    usdc: usdcInfo.balanceNumber,
    yesTokens: yesInfo.balanceNumber,
    noTokens: noInfo.balanceNumber,
    matic,
  };
}

/**
 * Calculates inventory requirements based on strategy config.
 *
 * The effective minimum tokens per side is the maximum of:
 * - config.minTokenBalance (user preference)
 * - market.minOrderSize (from rewardsMinSize - required for rewards)
 *
 * @param orderSize - Size per order in shares
 * @param market - Market parameters
 * @param inventory - Inventory configuration
 * @returns Calculated requirements
 */
export function calculateRequirements(
  orderSize: number,
  market: MarketParams,
  inventory: InventoryConfig
): InventoryRequirements {
  // Use max of configured minimum and rewards minimum
  const minTokensPerSide = Math.max(
    inventory.minTokenBalance,
    market.minOrderSize
  );

  // Reserve USDC for buy-side orders
  // Approximate: orderSize * averagePrice * multiplier
  // At midpoint ~0.5, buying orderSize tokens costs ~orderSize/2 USDC
  // Use full orderSize as conservative estimate (worst case: price = 1.0)
  const reservedUsdc = orderSize * inventory.usdcReserveMultiplier;

  return {
    minTokensPerSide,
    reservedUsdc,
  };
}

/**
 * Analyzes inventory deficit and determines actions needed.
 *
 * @param status - Current inventory status
 * @param requirements - Calculated requirements
 * @returns Deficit analysis
 */
export function analyzeDeficit(
  status: InventoryStatus,
  requirements: InventoryRequirements
): InventoryDeficit {
  // Calculate token deficits
  const yesDeficit = Math.max(0, requirements.minTokensPerSide - status.yesTokens);
  const noDeficit = Math.max(0, requirements.minTokensPerSide - status.noTokens);

  // Split amount is the max of both deficits (split creates equal YES + NO)
  const splitAmount = Math.max(yesDeficit, noDeficit);

  // Total USDC needed: split amount + reserve for buy orders
  const totalUsdcNeeded = splitAmount + requirements.reservedUsdc;

  // Check if we can cover the deficit
  const canCoverDeficit = status.usdc >= totalUsdcNeeded;
  const hasEnoughMatic = status.matic >= MIN_MATIC_BALANCE;

  return {
    yesDeficit,
    noDeficit,
    splitAmount,
    totalUsdcNeeded,
    canCoverDeficit,
    hasEnoughMatic,
  };
}

/**
 * Runs all pre-flight checks for the market maker.
 *
 * Checks:
 * 1. MATIC balance for gas (on signer address)
 * 2. Token balances vs requirements
 * 3. USDC available for split + buy orders
 *
 * @param client - Authenticated ClobClient
 * @param market - Market parameters
 * @param orderSize - Size per order
 * @param inventory - Inventory configuration
 * @param signerAddress - Signer (funder) address for MATIC gas balance check
 * @param provider - Polygon provider
 * @returns Pre-flight result with status and any issues
 */
export async function runPreFlightChecks(
  client: ClobClient,
  market: MarketParams,
  orderSize: number,
  inventory: InventoryConfig,
  signerAddress: string,
  provider: JsonRpcProvider
): Promise<PreFlightResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Get current status (MATIC checked on signer, not Safe)
  const status = await getInventoryStatus(client, market, signerAddress, provider);

  // Calculate requirements
  const requirements = calculateRequirements(orderSize, market, inventory);

  // Check if configured minimum is below rewards minimum
  if (inventory.minTokenBalance < market.minOrderSize) {
    warnings.push(
      `Using rewardsMinSize (${market.minOrderSize}) as it exceeds configured minTokenBalance (${inventory.minTokenBalance})`
    );
  }

  // Analyze deficit
  const deficit = analyzeDeficit(status, requirements);

  // Check MATIC balance
  if (!deficit.hasEnoughMatic) {
    errors.push(
      `Insufficient MATIC for gas: have ${status.matic.toFixed(4)}, need ${MIN_MATIC_BALANCE}`
    );
  } else if (status.matic < MIN_MATIC_BALANCE * 2) {
    warnings.push(
      `MATIC balance (${status.matic.toFixed(4)}) is low, consider topping up`
    );
  }

  // Check if we need to split and can cover it
  if (deficit.splitAmount > 0) {
    if (!deficit.canCoverDeficit) {
      errors.push(
        `Insufficient USDC: have $${status.usdc.toFixed(2)}, need $${deficit.totalUsdcNeeded.toFixed(2)} ` +
        `(split $${deficit.splitAmount.toFixed(2)} + reserve $${requirements.reservedUsdc.toFixed(2)})`
      );
    } else {
      warnings.push(
        `Will split $${deficit.splitAmount.toFixed(2)} USDC into tokens ` +
        `(YES deficit: ${deficit.yesDeficit.toFixed(2)}, NO deficit: ${deficit.noDeficit.toFixed(2)})`
      );
    }
  }

  // Check token balances without needing to split
  if (deficit.splitAmount === 0) {
    if (status.yesTokens < requirements.minTokensPerSide) {
      warnings.push(
        `YES token balance (${status.yesTokens}) below minimum (${requirements.minTokensPerSide})`
      );
    }
    if (status.noTokens < requirements.minTokensPerSide) {
      warnings.push(
        `NO token balance (${status.noTokens}) below minimum (${requirements.minTokensPerSide})`
      );
    }
  }

  const ready = errors.length === 0;

  return {
    ready,
    status,
    requirements,
    deficit: deficit.splitAmount > 0 ? deficit : null,
    warnings,
    errors,
  };
}

/**
 * Ensures sufficient inventory by splitting USDC if needed.
 *
 * This function:
 * 1. Checks current inventory
 * 2. Calculates if split is needed
 * 3. Ensures USDC approval
 * 4. Executes split through the Safe account
 *
 * @param client - Authenticated ClobClient
 * @param safe - Initialized Safe instance for transaction execution
 * @param safeAddress - The Safe wallet address (for token operations)
 * @param signerAddress - Signer (funder) address for MATIC gas balance check
 * @param provider - Polygon provider
 * @param market - Market parameters
 * @param orderSize - Size per order
 * @param inventory - Inventory configuration
 * @param dryRun - If true, skip actual split
 * @returns Amount that was split (0 if no split needed)
 * @throws Error if insufficient capital or split fails
 */
export async function ensureSufficientInventory(
  client: ClobClient,
  safe: SafeInstance,
  safeAddress: string,
  signerAddress: string,
  provider: JsonRpcProvider,
  market: MarketParams,
  orderSize: number,
  inventory: InventoryConfig,
  dryRun: boolean = false
): Promise<number> {
  // Run checks (MATIC checked on signer address)
  const preflight = await runPreFlightChecks(
    client,
    market,
    orderSize,
    inventory,
    signerAddress,
    provider
  );

  // Fail on errors
  if (!preflight.ready) {
    throw new Error(
      `Pre-flight checks failed:\n  ${preflight.errors.join("\n  ")}`
    );
  }

  // No split needed
  if (!preflight.deficit || preflight.deficit.splitAmount === 0) {
    return 0;
  }

  const splitAmount = preflight.deficit.splitAmount;

  // Dry run - don't actually split
  if (dryRun) {
    return splitAmount;
  }

  // Execute approval + split through Safe (batched for efficiency)
  const result = await approveAndSplitFromSafe(
    safe,
    safeAddress,
    market.conditionId,
    splitAmount,
    provider
  );

  if (!result.success) {
    throw new Error(`Failed to split USDC: ${result.error}`);
  }

  return splitAmount;
}

/**
 * Formats inventory status for display.
 *
 * @param status - Current inventory status
 * @returns Formatted string
 */
export function formatInventoryStatus(status: InventoryStatus): string {
  return [
    `  USDC: $${status.usdc.toFixed(2)}`,
    `  YES Tokens: ${status.yesTokens.toFixed(2)}`,
    `  NO Tokens: ${status.noTokens.toFixed(2)}`,
    `  MATIC: ${status.matic.toFixed(4)}`,
  ].join("\n");
}

/**
 * Merges neutral position (equal YES + NO tokens) back to USDC.
 *
 * This function merges equal amounts of YES and NO tokens back into USDC,
 * freeing up locked capital for trading. The merge operation is atomic
 * and executed through the Safe account.
 *
 * @param safe - Initialized Safe instance for transaction execution
 * @param conditionId - Market condition ID
 * @param amount - Amount to merge (requires equal YES + NO tokens)
 * @param dryRun - If true, skip actual merge and return simulated result
 * @returns Operation result with transaction hash or error
 *
 * @example
 * // Merge 50 YES + 50 NO tokens into $50 USDC
 * const result = await mergeNeutralPosition(safe, conditionId, 50);
 */
export async function mergeNeutralPosition(
  safe: SafeInstance,
  conditionId: string,
  amount: number,
  dryRun: boolean = false
): Promise<CtfOperationResult> {
  if (amount <= 0) {
    return {
      success: false,
      error: "Merge amount must be positive",
      amount: 0,
    };
  }

  if (dryRun) {
    log(`[DRY RUN] Would merge ${amount.toFixed(2)} tokens back to USDC`);
    return {
      success: true,
      transactionHash: "dry-run-merge-tx",
      amount,
    };
  }

  log(`Merging ${amount.toFixed(2)} tokens back to USDC...`);

  const result = await mergePositionsFromSafe(safe, conditionId, amount);

  if (result.success) {
    log(`Merge successful: ${amount.toFixed(2)} YES + ${amount.toFixed(2)} NO -> $${amount.toFixed(2)} USDC`);
    log(`Transaction: ${result.transactionHash}`);
  } else {
    log(`Merge failed: ${result.error}`);
  }

  return result;
}
