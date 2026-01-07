/**
 * Conditional Token Framework (CTF) utilities.
 *
 * Provides functions for splitting USDC into YES+NO tokens and
 * merging tokens back into USDC. Supports both direct wallet
 * execution and Safe (Gnosis Safe) execution.
 *
 * IMPORTANT: For Polymarket trading, all CTF operations MUST be
 * executed from the Safe account (the proxy wallet), not directly
 * from the private key. Use the Safe-based functions.
 *
 * @see https://docs.polymarket.com/developers/CTF/overview
 */

import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider } from "@ethersproject/providers";
import { parseUnits, formatUnits, formatEther } from "@ethersproject/units";
import { MaxUint256 } from "@ethersproject/constants";
import { HashZero } from "@ethersproject/constants";
import {
  contracts,
  USDC_DECIMALS,
  DEFAULT_POLYGON_RPC,
} from "@/config/contracts.js";
import { getEnvOptional } from "@/utils/env.js";
import {
  getSafeInstance,
  executeSafeTransaction,
  executeSafeBatchTransaction,
  createSafeTransactionData,
  type SafeInstance,
  type SafeConfig,
  type SafeTransactionResult,
} from "@/utils/safe.js";
import type { CtfOperationResult } from "@/types/inventory.js";

/**
 * ERC20 ABI - only the functions we need for USDC operations.
 */
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

/**
 * CTF ABI - only the functions we need for split/merge.
 */
const CTF_ABI = [
  "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
  "function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
];

/**
 * Interface for encoding ERC20 function calls.
 */
const erc20Interface = new Interface(ERC20_ABI);

/**
 * Interface for encoding CTF function calls.
 */
const ctfInterface = new Interface(CTF_ABI);

/**
 * Partition for binary markets: [1, 2] represents YES (0b01) and NO (0b10).
 */
const BINARY_PARTITION = [1, 2];

/**
 * Gets the Polygon RPC provider.
 * Uses POLYGON_RPC_URL env var if set, otherwise falls back to public RPC.
 */
export function getPolygonProvider(): JsonRpcProvider {
  const rpcUrl = getEnvOptional("POLYGON_RPC_URL", DEFAULT_POLYGON_RPC);
  return new JsonRpcProvider(rpcUrl);
}

/**
 * Gets the MATIC balance for an address.
 *
 * @param address - The address to check
 * @param provider - Optional provider (defaults to Polygon RPC)
 * @returns MATIC balance in ether units
 */
export async function getMaticBalance(
  address: string,
  provider?: JsonRpcProvider
): Promise<number> {
  const p = provider ?? getPolygonProvider();
  const balance = await p.getBalance(address);
  return parseFloat(formatEther(balance));
}

/**
 * Gets the current USDC allowance for a spender.
 *
 * @param ownerAddress - The wallet address that owns the USDC
 * @param spenderAddress - The address to check allowance for
 * @param provider - Optional provider (defaults to Polygon RPC)
 * @returns Current allowance in USDC units
 */
export async function getUsdcAllowance(
  ownerAddress: string,
  spenderAddress: string,
  provider?: JsonRpcProvider
): Promise<number> {
  const p = provider ?? getPolygonProvider();
  const usdc = new Contract(contracts.USDC, ERC20_ABI, p);
  const allowance = await usdc.allowance(ownerAddress, spenderAddress);
  return parseFloat(formatUnits(allowance, USDC_DECIMALS));
}

/**
 * Encodes USDC approval calldata.
 *
 * @param spender - Address to approve
 * @param amount - Amount to approve (use MaxUint256 for unlimited)
 * @returns Encoded calldata for approve function
 */
export function encodeUsdcApproval(spender: string, amount: bigint = BigInt(MaxUint256.toString())): string {
  return erc20Interface.encodeFunctionData("approve", [spender, amount]);
}

/**
 * Encodes CTF splitPosition calldata.
 *
 * @param conditionId - The market's condition ID
 * @param amountUnits - Amount in USDC units (6 decimals)
 * @returns Encoded calldata for splitPosition function
 */
export function encodeSplitPosition(conditionId: string, amountUnits: bigint): string {
  return ctfInterface.encodeFunctionData("splitPosition", [
    contracts.USDC,
    HashZero,
    conditionId,
    BINARY_PARTITION,
    amountUnits,
  ]);
}

/**
 * Encodes CTF mergePositions calldata.
 *
 * @param conditionId - The market's condition ID
 * @param amountUnits - Amount in USDC units (6 decimals)
 * @returns Encoded calldata for mergePositions function
 */
export function encodeMergePositions(conditionId: string, amountUnits: bigint): string {
  return ctfInterface.encodeFunctionData("mergePositions", [
    contracts.USDC,
    HashZero,
    conditionId,
    BINARY_PARTITION,
    amountUnits,
  ]);
}

// ============================================================================
// SAFE-BASED CTF OPERATIONS
// These execute transactions through the Safe (Gnosis Safe) account.
// ============================================================================

/**
 * Approves USDC for the CTF contract from the Safe account.
 *
 * Uses max approval (unlimited) to avoid repeated approvals.
 *
 * @param safe - Initialized Safe instance
 * @returns Transaction result with hash or error
 */
export async function approveUsdcForCtfFromSafe(
  safe: SafeInstance
): Promise<SafeTransactionResult> {
  const approveData = encodeUsdcApproval(contracts.CTF);
  const tx = createSafeTransactionData(contracts.USDC, approveData);
  return executeSafeTransaction(safe, tx);
}

/**
 * Ensures USDC is approved for the CTF contract from the Safe account.
 * Only sends approval transaction if current allowance is insufficient.
 *
 * @param safe - Initialized Safe instance
 * @param safeAddress - The Safe account address
 * @param requiredAmount - Minimum USDC amount that needs to be approved
 * @param provider - Optional provider (defaults to Polygon RPC)
 * @returns True if approval was sent, false if already sufficient
 */
export async function ensureUsdcApprovalFromSafe(
  safe: SafeInstance,
  safeAddress: string,
  requiredAmount: number,
  provider?: JsonRpcProvider
): Promise<boolean> {
  const currentAllowance = await getUsdcAllowance(safeAddress, contracts.CTF, provider);

  if (currentAllowance >= requiredAmount) {
    return false; // Already approved
  }

  const result = await approveUsdcForCtfFromSafe(safe);
  if (!result.success) {
    throw new Error(`Failed to approve USDC: ${result.error}`);
  }

  return true;
}

/**
 * Splits USDC into YES and NO tokens from the Safe account.
 *
 * This converts `amount` USDC into `amount` YES tokens AND `amount` NO tokens.
 * The total value is preserved: YES + NO = 1 USDC per pair.
 *
 * @param safe - Initialized Safe instance
 * @param conditionId - The market's condition ID
 * @param amount - Amount of USDC to split (creates equal YES + NO)
 * @returns Operation result with transaction hash or error
 *
 * @example
 * // Split $100 USDC into 100 YES + 100 NO tokens
 * const result = await splitPositionFromSafe(safe, conditionId, 100);
 */
export async function splitPositionFromSafe(
  safe: SafeInstance,
  conditionId: string,
  amount: number
): Promise<CtfOperationResult> {
  try {
    const amountUnits = parseUnits(amount.toString(), USDC_DECIMALS);
    const splitData = encodeSplitPosition(conditionId, BigInt(amountUnits.toString()));
    const tx = createSafeTransactionData(contracts.CTF, splitData);
    const result = await executeSafeTransaction(safe, tx);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        amount,
      };
    }

    return {
      success: true,
      transactionHash: result.transactionHash,
      amount,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      amount,
    };
  }
}

/**
 * Merges YES and NO tokens back into USDC from the Safe account.
 *
 * This converts `amount` YES tokens AND `amount` NO tokens into `amount` USDC.
 * You must have equal amounts of both tokens to merge.
 *
 * @param safe - Initialized Safe instance
 * @param conditionId - The market's condition ID
 * @param amount - Amount to merge (needs equal YES + NO tokens)
 * @returns Operation result with transaction hash or error
 *
 * @example
 * // Merge 50 YES + 50 NO tokens into $50 USDC
 * const result = await mergePositionsFromSafe(safe, conditionId, 50);
 */
export async function mergePositionsFromSafe(
  safe: SafeInstance,
  conditionId: string,
  amount: number
): Promise<CtfOperationResult> {
  try {
    const amountUnits = parseUnits(amount.toString(), USDC_DECIMALS);
    const mergeData = encodeMergePositions(conditionId, BigInt(amountUnits.toString()));
    const tx = createSafeTransactionData(contracts.CTF, mergeData);
    const result = await executeSafeTransaction(safe, tx);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        amount,
      };
    }

    return {
      success: true,
      transactionHash: result.transactionHash,
      amount,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      amount,
    };
  }
}

/**
 * Approves USDC and splits position in a single batched Safe transaction.
 *
 * This is more gas-efficient than two separate transactions and
 * ensures atomicity.
 *
 * @param safe - Initialized Safe instance
 * @param safeAddress - The Safe account address
 * @param conditionId - The market's condition ID
 * @param amount - Amount of USDC to split
 * @param provider - Optional provider for allowance check
 * @returns Operation result with transaction hash or error
 */
export async function approveAndSplitFromSafe(
  safe: SafeInstance,
  safeAddress: string,
  conditionId: string,
  amount: number,
  provider?: JsonRpcProvider
): Promise<CtfOperationResult> {
  try {
    const amountUnits = parseUnits(amount.toString(), USDC_DECIMALS);

    // Check if approval is needed
    const currentAllowance = await getUsdcAllowance(safeAddress, contracts.CTF, provider);
    const needsApproval = currentAllowance < amount;

    // Build transaction(s)
    const transactions = [];

    if (needsApproval) {
      const approveData = encodeUsdcApproval(contracts.CTF);
      transactions.push(createSafeTransactionData(contracts.USDC, approveData));
    }

    const splitData = encodeSplitPosition(conditionId, BigInt(amountUnits.toString()));
    transactions.push(createSafeTransactionData(contracts.CTF, splitData));

    // Execute as batch if multiple transactions, otherwise single
    const result = transactions.length > 1
      ? await executeSafeBatchTransaction(safe, transactions)
      : await executeSafeTransaction(safe, transactions[0]);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        amount,
      };
    }

    return {
      success: true,
      transactionHash: result.transactionHash,
      amount,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      amount,
    };
  }
}

/**
 * Creates and returns a Safe instance for CTF operations.
 *
 * This is a convenience function that uses environment variables
 * for configuration.
 *
 * @param safeConfig - Safe configuration (signerPrivateKey, safeAddress)
 * @returns Initialized Safe instance
 */
export async function createSafeForCtf(safeConfig: SafeConfig): Promise<SafeInstance> {
  return getSafeInstance(safeConfig);
}

// Re-export Safe types for convenience
export type { SafeInstance, SafeConfig, SafeTransactionResult };
