/**
 * Utility to generate MarketParams from a RankedMarketByEarnings.
 *
 * Used by the orchestrator to convert discovered high-earning markets
 * into configuration for the market maker.
 */

import type { TickSize } from "@polymarket/clob-client";
import type { RankedMarketByEarnings } from "@/types/rewards.js";
import type { MarketParams } from "@/types/strategy.js";

/**
 * Options for generating market config.
 */
export interface MarketConfigOptions {
  /** Override tick size (defaults to "0.01") */
  tickSize?: TickSize;
  /** Override negRisk flag (defaults to market's value or false) */
  negRisk?: boolean;
}

/**
 * Parses clobTokenIds string into an array of token IDs.
 * 
 * The clobTokenIds field can be either:
 * - A JSON array string: '["token1", "token2"]'
 * - A comma-separated string: "token1,token2"
 *
 * @param clobTokenIds - The raw clobTokenIds string from the API
 * @returns Array of token ID strings
 */
export function parseClobTokenIds(clobTokenIds: string): string[] {
  const trimmed = clobTokenIds.trim();
  
  if (trimmed.startsWith("[")) {
    // JSON array format
    return JSON.parse(trimmed) as string[];
  }
  
  // Comma-separated format
  return trimmed.split(",").map((id) => id.trim());
}

/**
 * Generates MarketParams from a RankedMarketByEarnings.
 *
 * This extracts the necessary trading configuration from market discovery
 * results, ready for use with the market maker.
 *
 * Token IDs are extracted from clobTokenIds in order: [YES, NO].
 * This matches the Polymarket convention where the first token is YES.
 *
 * @param market - The ranked market from discovery
 * @param options - Optional overrides for tick size or negRisk
 * @returns MarketParams ready for market maker configuration
 * @throws Error if market doesn't have required token IDs
 *
 * @example
 * const bestMarket = await findBestMarket(100);
 * if (bestMarket) {
 *   const params = generateMarketConfig(bestMarket);
 *   // Use params with market maker
 * }
 */
export function generateMarketConfig(
  market: RankedMarketByEarnings,
  options: MarketConfigOptions = {}
): MarketParams {
  if (!market.clobTokenIds) {
    throw new Error(
      `Market ${market.conditionId} is missing clobTokenIds`
    );
  }

  const tokenIds = parseClobTokenIds(market.clobTokenIds);

  if (tokenIds.length < 2) {
    throw new Error(
      `Market ${market.conditionId} has fewer than 2 token IDs: ${tokenIds.length}`
    );
  }

  // Polymarket convention: first token is YES, second is NO
  const [yesTokenId, noTokenId] = tokenIds;

  return {
    yesTokenId,
    noTokenId,
    conditionId: market.conditionId,
    // Default to "0.01" - most markets use this tick size
    tickSize: options.tickSize ?? "0.01",
    // Use market's negRisk if available, otherwise false
    negRisk: options.negRisk ?? market.negRisk ?? false,
    // From rewards params
    minOrderSize: market.rewardsMinSize,
    maxSpread: market.rewardsMaxSpread,
    // Daily reward pool for actual earnings calculation
    rewardsDaily: market.rewardsDaily,
  };
}

/**
 * Validates that a MarketParams object has all required fields.
 *
 * @param params - The market params to validate
 * @returns True if valid, throws otherwise
 * @throws Error with details about missing/invalid fields
 */
export function validateMarketParams(params: MarketParams): boolean {
  const errors: string[] = [];

  if (!params.yesTokenId || params.yesTokenId.length === 0) {
    errors.push("yesTokenId is required");
  }

  if (!params.noTokenId || params.noTokenId.length === 0) {
    errors.push("noTokenId is required");
  }

  if (!params.conditionId || params.conditionId.length === 0) {
    errors.push("conditionId is required");
  }

  if (!params.tickSize) {
    errors.push("tickSize is required");
  }

  if (params.minOrderSize < 0) {
    errors.push("minOrderSize must be non-negative");
  }

  if (params.maxSpread <= 0) {
    errors.push("maxSpread must be positive");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid MarketParams: ${errors.join(", ")}`);
  }

  return true;
}

/**
 * Creates a human-readable summary of a market config.
 *
 * @param params - The market params to summarize
 * @param marketQuestion - Optional market question for display
 * @returns Formatted string summary
 */
export function formatMarketConfig(
  params: MarketParams,
  marketQuestion?: string
): string {
  const lines: string[] = [];

  if (marketQuestion) {
    lines.push(`Market: ${marketQuestion}`);
  }

  lines.push(`Condition ID: ${params.conditionId}`);
  lines.push(`YES Token: ${params.yesTokenId.slice(0, 16)}...`);
  lines.push(`NO Token: ${params.noTokenId.slice(0, 16)}...`);
  lines.push(`Tick Size: ${params.tickSize}`);
  lines.push(`Neg Risk: ${params.negRisk}`);
  lines.push(`Min Order Size: ${params.minOrderSize} shares`);
  lines.push(`Max Spread: ${params.maxSpread} cents`);
  if (params.rewardsDaily !== undefined) {
    lines.push(`Rewards Daily: $${params.rewardsDaily.toFixed(2)}/day`);
  }

  return lines.join("\n");
}
