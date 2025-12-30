/**
 * Balance utilities for querying USDC and conditional token balances.
 *
 * These utilities wrap the CLOB client's getBalanceAllowance method
 * and provide convenient helpers for checking wallet balances.
 */

import { ClobClient, AssetType } from "@polymarket/clob-client";
import type { BalanceInfo, WalletBalances, TokenBalanceSummary } from "@/types/balance.js";

/**
 * Parses a balance/allowance string to a number.
 * USDC has 6 decimals, but the API returns values in USDC units (not wei).
 */
function parseBalanceString(value: string): number {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Gets the USDC (collateral) balance for the authenticated wallet.
 *
 * @param client - Authenticated ClobClient
 * @returns Balance info including raw strings and parsed numbers
 *
 * @example
 * const client = await createAuthenticatedClobClient();
 * const usdc = await getUsdcBalance(client);
 * console.log(`USDC Balance: $${usdc.balanceNumber.toFixed(2)}`);
 */
export async function getUsdcBalance(client: ClobClient): Promise<BalanceInfo> {
  const response = await client.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });

  return {
    balance: response.balance,
    allowance: response.allowance,
    balanceNumber: parseBalanceString(response.balance),
    allowanceNumber: parseBalanceString(response.allowance),
  };
}

/**
 * Gets the balance of a specific conditional token.
 *
 * @param client - Authenticated ClobClient
 * @param tokenId - The token ID to check (from market data)
 * @returns Balance info including raw strings and parsed numbers
 *
 * @example
 * const client = await createAuthenticatedClobClient();
 * const tokenBalance = await getTokenBalance(client, "123456...");
 * console.log(`Token Balance: ${tokenBalance.balanceNumber} shares`);
 */
export async function getTokenBalance(
  client: ClobClient,
  tokenId: string
): Promise<BalanceInfo> {
  const response = await client.getBalanceAllowance({
    asset_type: AssetType.CONDITIONAL,
    token_id: tokenId,
  });

  return {
    balance: response.balance,
    allowance: response.allowance,
    balanceNumber: parseBalanceString(response.balance),
    allowanceNumber: parseBalanceString(response.allowance),
  };
}

/**
 * Gets balances for USDC and multiple conditional tokens.
 *
 * @param client - Authenticated ClobClient
 * @param tokenIds - Array of token IDs to check
 * @returns Complete wallet balances including USDC and all requested tokens
 *
 * @example
 * const client = await createAuthenticatedClobClient();
 * const balances = await getBalances(client, [yesTokenId, noTokenId]);
 * console.log(`USDC: $${balances.usdc.balanceNumber}`);
 * console.log(`YES tokens: ${balances.tokens.get(yesTokenId)?.balanceNumber}`);
 */
export async function getBalances(
  client: ClobClient,
  tokenIds: string[]
): Promise<WalletBalances> {
  // Fetch USDC and all tokens in parallel
  const [usdc, ...tokenBalances] = await Promise.all([
    getUsdcBalance(client),
    ...tokenIds.map((tokenId) => getTokenBalance(client, tokenId)),
  ]);

  // Build token map
  const tokens = new Map<string, BalanceInfo>();
  tokenIds.forEach((tokenId, index) => {
    tokens.set(tokenId, tokenBalances[index]);
  });

  return { usdc, tokens };
}

/**
 * Creates a summary of token balances for display/logging.
 *
 * @param balances - Wallet balances from getBalances()
 * @returns Array of token balance summaries
 */
export function summarizeTokenBalances(balances: WalletBalances): TokenBalanceSummary[] {
  const summaries: TokenBalanceSummary[] = [];

  for (const [tokenId, balance] of balances.tokens) {
    summaries.push({
      tokenId,
      balance: balance.balanceNumber,
      allowance: balance.allowanceNumber,
    });
  }

  return summaries;
}

/**
 * Checks if there is sufficient USDC balance for an order.
 *
 * @param client - Authenticated ClobClient
 * @param requiredAmount - Amount of USDC needed
 * @returns True if balance >= requiredAmount
 */
export async function hasSufficientUsdc(
  client: ClobClient,
  requiredAmount: number
): Promise<boolean> {
  const usdc = await getUsdcBalance(client);
  return usdc.balanceNumber >= requiredAmount;
}

/**
 * Checks if there is sufficient token balance for a sell order.
 *
 * @param client - Authenticated ClobClient
 * @param tokenId - Token ID to check
 * @param requiredAmount - Number of tokens needed
 * @returns True if balance >= requiredAmount
 */
export async function hasSufficientTokens(
  client: ClobClient,
  tokenId: string,
  requiredAmount: number
): Promise<boolean> {
  const token = await getTokenBalance(client, tokenId);
  return token.balanceNumber >= requiredAmount;
}
