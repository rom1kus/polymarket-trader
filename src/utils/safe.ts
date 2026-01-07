/**
 * Safe (Gnosis Safe) SDK utilities for executing transactions from a Safe account.
 *
 * Provides functions for initializing the Safe Protocol Kit and executing
 * transactions from the Polymarket proxy wallet (which is a Gnosis Safe).
 *
 * @see https://docs.safe.global/sdk/protocol-kit
 */

import SafeDefault from "@safe-global/protocol-kit";
import type { MetaTransactionData } from "@safe-global/types-kit";
import { OperationType } from "@safe-global/types-kit";
import { getEnvOptional } from "@/utils/env.js";
import { DEFAULT_POLYGON_RPC } from "@/config/contracts.js";

// Access the Safe class from the default export
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Safe = SafeDefault as any;

/**
 * Configuration for Safe SDK initialization.
 */
export interface SafeConfig {
  /** Polygon RPC URL */
  rpcUrl?: string;
  /** Private key of the Safe owner/signer */
  signerPrivateKey: string;
  /** Address of the Safe account */
  safeAddress: string;
}

/**
 * Result of a Safe transaction execution.
 */
export interface SafeTransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Interface for an initialized Safe instance.
 * Defines the methods we use from the Safe Protocol Kit.
 */
export interface SafeInstance {
  createTransaction(props: {
    transactions: MetaTransactionData[];
  }): Promise<SafeTransaction>;
  executeTransaction(
    safeTransaction: SafeTransaction
  ): Promise<TransactionResponse>;
  getAddress(): Promise<string>;
  getOwners(): Promise<string[]>;
  getThreshold(): Promise<number>;
}

interface SafeTransaction {
  data: unknown;
}

interface TransactionResponse {
  hash: string;
  transactionResponse?: {
    wait(): Promise<{ hash: string }>;
  };
}

// Cache the Safe instance for reuse
let cachedSafeInstance: SafeInstance | null = null;
let cachedConfig: string | null = null;

/**
 * Gets or creates a Safe Protocol Kit instance.
 *
 * Caches the instance for reuse to avoid repeated initialization.
 *
 * @param config - Safe configuration
 * @returns Initialized Safe Protocol Kit instance
 */
export async function getSafeInstance(config: SafeConfig): Promise<SafeInstance> {
  const rpcUrl = config.rpcUrl ?? getEnvOptional("POLYGON_RPC_URL", DEFAULT_POLYGON_RPC);
  const configKey = `${rpcUrl}:${config.safeAddress}:${config.signerPrivateKey}`;

  // Return cached instance if config matches
  if (cachedSafeInstance && cachedConfig === configKey) {
    return cachedSafeInstance;
  }

  // Initialize new Safe instance
  const safeInstance: SafeInstance = await Safe.init({
    provider: rpcUrl,
    signer: config.signerPrivateKey,
    safeAddress: config.safeAddress,
  });

  // Cache for reuse
  cachedSafeInstance = safeInstance;
  cachedConfig = configKey;

  return safeInstance;
}

/**
 * Clears the cached Safe instance.
 * Useful for testing or when configuration changes.
 */
export function clearSafeCache(): void {
  cachedSafeInstance = null;
  cachedConfig = null;
}

/**
 * Executes a single transaction through the Safe account.
 *
 * @param safe - Initialized Safe instance
 * @param transaction - Transaction data to execute
 * @returns Result with transaction hash or error
 */
export async function executeSafeTransaction(
  safe: SafeInstance,
  transaction: MetaTransactionData
): Promise<SafeTransactionResult> {
  try {
    // Create Safe transaction
    const safeTransaction = await safe.createTransaction({
      transactions: [transaction],
    });

    // Execute the transaction
    const txResponse = await safe.executeTransaction(safeTransaction);

    // Wait for confirmation
    const receipt = await txResponse.transactionResponse?.wait();

    return {
      success: true,
      transactionHash: receipt?.hash ?? txResponse.hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Executes multiple transactions in a single Safe batch.
 *
 * Batching saves gas and ensures atomicity - all transactions
 * succeed or all fail together.
 *
 * @param safe - Initialized Safe instance
 * @param transactions - Array of transactions to batch
 * @returns Result with transaction hash or error
 */
export async function executeSafeBatchTransaction(
  safe: SafeInstance,
  transactions: MetaTransactionData[]
): Promise<SafeTransactionResult> {
  try {
    // Create batched Safe transaction
    const safeTransaction = await safe.createTransaction({
      transactions,
    });

    // Execute the batch
    const txResponse = await safe.executeTransaction(safeTransaction);

    // Wait for confirmation
    const receipt = await txResponse.transactionResponse?.wait();

    return {
      success: true,
      transactionHash: receipt?.hash ?? txResponse.hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Creates a transaction data object for the Safe SDK.
 *
 * @param to - Target contract address
 * @param data - Encoded function call data
 * @param value - ETH/MATIC value to send (default "0")
 * @returns MetaTransactionData ready for Safe execution
 */
export function createSafeTransactionData(
  to: string,
  data: string,
  value: string = "0"
): MetaTransactionData {
  return {
    to,
    data,
    value,
    operation: OperationType.Call,
  };
}
