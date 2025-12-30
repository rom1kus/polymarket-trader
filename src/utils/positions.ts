/**
 * Position tracking utilities for monitoring holdings across markets.
 *
 * Positions are derived from token balances - if you hold tokens,
 * you have a position in that market outcome.
 */

import { ClobClient } from "@polymarket/clob-client";
import { getTokenBalance, getBalances } from "@/utils/balance.js";
import type { Position, MarketPosition, PositionsSummary } from "@/types/positions.js";

/**
 * Gets the position for a single token.
 *
 * @param client - Authenticated ClobClient
 * @param tokenId - The token ID to check
 * @returns Position with size and hasPosition flag
 *
 * @example
 * const client = await createAuthenticatedClobClient();
 * const position = await getPosition(client, yesTokenId);
 * if (position.hasPosition) {
 *   console.log(`Holding ${position.size} YES shares`);
 * }
 */
export async function getPosition(
  client: ClobClient,
  tokenId: string
): Promise<Position> {
  const balance = await getTokenBalance(client, tokenId);

  return {
    tokenId,
    size: balance.balanceNumber,
    hasPosition: balance.balanceNumber > 0,
  };
}

/**
 * Gets positions for multiple tokens.
 *
 * @param client - Authenticated ClobClient
 * @param tokenIds - Array of token IDs to check
 * @returns Array of positions
 *
 * @example
 * const positions = await getPositions(client, [yesTokenId, noTokenId]);
 * const activePositions = positions.filter(p => p.hasPosition);
 */
export async function getPositions(
  client: ClobClient,
  tokenIds: string[]
): Promise<Position[]> {
  const balances = await getBalances(client, tokenIds);

  return tokenIds.map((tokenId) => {
    const balance = balances.tokens.get(tokenId);
    const size = balance?.balanceNumber ?? 0;

    return {
      tokenId,
      size,
      hasPosition: size > 0,
    };
  });
}

/**
 * Gets the complete position for a binary market (YES and NO tokens).
 *
 * @param client - Authenticated ClobClient
 * @param yesTokenId - The YES outcome token ID
 * @param noTokenId - The NO outcome token ID
 * @param conditionId - Optional market condition ID for reference
 * @returns Complete market position with net exposure
 *
 * @example
 * const marketPos = await getMarketPosition(client, yesTokenId, noTokenId);
 * if (marketPos.netExposure > 0) {
 *   console.log(`Net long YES by ${marketPos.netExposure} shares`);
 * } else if (marketPos.netExposure < 0) {
 *   console.log(`Net long NO by ${Math.abs(marketPos.netExposure)} shares`);
 * }
 */
export async function getMarketPosition(
  client: ClobClient,
  yesTokenId: string,
  noTokenId: string,
  conditionId?: string
): Promise<MarketPosition> {
  const [yesPosition, noPosition] = await getPositions(client, [
    yesTokenId,
    noTokenId,
  ]);

  // Net exposure: YES tokens - NO tokens
  // Positive = bullish (expect YES), Negative = bearish (expect NO)
  const netExposure = yesPosition.size - noPosition.size;

  return {
    conditionId,
    yes: yesPosition,
    no: noPosition,
    netExposure,
  };
}

/**
 * Gets a summary of all positions for the given tokens.
 *
 * @param client - Authenticated ClobClient
 * @param tokenIds - Array of token IDs to check
 * @returns Summary with positions and active count
 */
export async function getPositionsSummary(
  client: ClobClient,
  tokenIds: string[]
): Promise<PositionsSummary> {
  const positions = await getPositions(client, tokenIds);
  const activePositions = positions.filter((p) => p.hasPosition);

  return {
    positions,
    activePositionCount: activePositions.length,
  };
}

/**
 * Checks if there is any position in the given tokens.
 *
 * @param client - Authenticated ClobClient
 * @param tokenIds - Array of token IDs to check
 * @returns True if any token has a non-zero balance
 */
export async function hasAnyPosition(
  client: ClobClient,
  tokenIds: string[]
): Promise<boolean> {
  const positions = await getPositions(client, tokenIds);
  return positions.some((p) => p.hasPosition);
}

/**
 * Checks if there is a position of at least the specified size.
 *
 * @param client - Authenticated ClobClient
 * @param tokenId - Token ID to check
 * @param minSize - Minimum position size required
 * @returns True if position size >= minSize
 */
export async function hasMinimumPosition(
  client: ClobClient,
  tokenId: string,
  minSize: number
): Promise<boolean> {
  const position = await getPosition(client, tokenId);
  return position.size >= minSize;
}
