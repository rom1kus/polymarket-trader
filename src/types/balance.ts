/**
 * Balance-related types for wallet and position tracking.
 *
 * Uses library types from @polymarket/clob-client where available:
 * - AssetType (COLLATERAL, CONDITIONAL)
 * - BalanceAllowanceResponse (balance, allowance)
 */

import type { BalanceAllowanceResponse } from "@polymarket/clob-client";

/**
 * Extended balance info with parsed numeric value for convenience.
 */
export interface BalanceInfo extends BalanceAllowanceResponse {
  /** Balance parsed as a number (USDC has 6 decimals, shown as whole units) */
  balanceNumber: number;
  /** Allowance parsed as a number */
  allowanceNumber: number;
}

/**
 * Complete wallet balances including USDC and conditional tokens.
 */
export interface WalletBalances {
  /** USDC (collateral) balance */
  usdc: BalanceInfo;
  /** Map of token ID -> balance info for conditional tokens */
  tokens: Map<string, BalanceInfo>;
}

/**
 * Summary of a single token balance for display/logging.
 */
export interface TokenBalanceSummary {
  tokenId: string;
  balance: number;
  allowance: number;
}
