/**
 * Market discovery utilities for finding and ranking markets by earning potential.
 *
 * Provides functions to:
 * - Fetch markets with active reward programs
 * - Calculate real competition from orderbooks
 * - Rank markets by estimated daily earnings
 * - Find the best market for a given liquidity amount
 *
 * Used by:
 * - `npm run findBestMarkets` script
 * - Market maker orchestrator for automatic market selection
 *
 * @example
 * ```typescript
 * // Find the single best market for $200 liquidity
 * const best = await findBestMarket(200);
 * if (best) {
 *   console.log(`Best market: ${best.question}`);
 *   console.log(`Estimated daily earnings: $${best.earningPotential.estimatedDailyEarnings.toFixed(2)}`);
 * }
 *
 * // Get top 10 markets with full ranking
 * const ranked = await discoverMarkets({ liquidity: 200, limit: 10 });
 * ```
 */

import {
  fetchMarketsWithRewards,
  type FetchMarketsWithRewardsOptions,
} from "@/utils/gamma.js";
import type {
  MarketWithRewards,
  RankedMarketByEarnings,
} from "@/types/rewards.js";
import {
  calculateEarningPotential,
  DEFAULT_ESTIMATE_LIQUIDITY,
} from "@/utils/rewards.js";
import {
  fetchBatchCompetition,
  type MarketForCompetition,
} from "@/utils/orderbook.js";
import { checkMarketVolatility } from "@/utils/volatility.js";
import type { VolatilityThresholds } from "@/types/polymarket.js";
import { log } from "@/utils/helpers.js";

/**
 * Options for market discovery.
 */
export interface MarketDiscoveryOptions {
  /** Liquidity amount in USD (default: 100) */
  liquidity?: number;

  /** Maximum number of markets to return (default: unlimited) */
  limit?: number;

  /** Maximum minSize requirement filter (default: no filter) */
  maxMinSize?: number;

  /** Progress callback for fetch phase */
  onFetchProgress?: (fetched: number, total: number, filtered: number) => void;

  /** Progress callback for competition calculation phase */
  onCompetitionProgress?: (fetched: number, total: number) => void;

  /** Skip competition calculation (use API values, may be stale) */
  skipCompetitionFetch?: boolean;
}

/**
 * Extended options for findBestMarket with volatility filtering.
 */
export interface FindBestMarketOptions extends Omit<MarketDiscoveryOptions, "liquidity" | "limit"> {
  /** Volatility filtering thresholds (undefined = skip filtering) */
  volatilityThresholds?: VolatilityThresholds;

  /** Progress callback for volatility filtering phase */
  onVolatilityProgress?: (checked: number, total: number, filtered: number) => void;
}

/**
 * Result of market discovery.
 */
export interface MarketDiscoveryResult {
  /** Ranked markets (best first) */
  markets: RankedMarketByEarnings[];

  /** Total markets fetched from API */
  totalFetched: number;

  /** Markets that passed compatibility filters */
  compatibleCount: number;

  /** Markets with orderbook competition data */
  competitionFetched: number;
}

/**
 * Extracts the first token ID from a market's clobTokenIds field.
 * Used for fetching orderbook data.
 */
export function getFirstTokenId(market: MarketWithRewards): string | null {
  if (!market.clobTokenIds) return null;
  const trimmed = market.clobTokenIds.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as string[];
      return parsed[0] ?? null;
    } catch {
      return null;
    }
  }
  return trimmed.split(",")[0] ?? null;
}

/**
 * Ranks markets by earning potential.
 *
 * Uses Polymarket's quadratic reward formula to estimate daily earnings
 * for a given liquidity amount. Filters out incompatible markets where
 * the liquidity can't meet minSize requirements.
 *
 * @param markets - Markets with reward parameters
 * @param liquidityAmount - Liquidity amount in USD
 * @returns Markets ranked by estimated daily earnings (highest first)
 */
export function rankMarketsByEarnings(
  markets: MarketWithRewards[],
  liquidityAmount: number
): RankedMarketByEarnings[] {
  return markets
    .map((market) => ({
      ...market,
      earningPotential: calculateEarningPotential(
        market.rewardsDaily ?? 0,
        market.competitive ?? 0,
        market.rewardsMaxSpread,
        market.rewardsMinSize,
        liquidityAmount,
        market.midpoint ?? 0.5
      ),
    }))
    .filter(
      (m) =>
        m.earningPotential.compatible &&
        m.earningPotential.estimatedDailyEarnings > 0 &&
        !m.negRisk // Skip NegRisk markets due to signature compatibility issues
    )
    .sort(
      (a, b) =>
        b.earningPotential.estimatedDailyEarnings -
        a.earningPotential.estimatedDailyEarnings
    );
}

/**
 * Updates markets with real competition data from orderbooks.
 *
 * The API's `market_competitiveness` field is often stale, so we fetch
 * the actual orderbook and calculate the real Q score.
 *
 * @param markets - Markets with basic data
 * @param options - Progress callback options
 * @returns Markets with updated competition values
 */
export async function fetchRealCompetition(
  markets: MarketWithRewards[],
  options?: {
    onProgress?: (fetched: number, total: number) => void;
    batchSize?: number;
  }
): Promise<Map<string, number>> {
  // Prepare markets for competition fetch
  const marketsForCompetition: MarketForCompetition[] = markets
    .map((m) => {
      const tokenId = getFirstTokenId(m);
      if (!tokenId || !m.midpoint) return null;
      return {
        tokenId,
        conditionId: m.conditionId,
        midpoint: m.midpoint,
        maxSpreadCents: m.rewardsMaxSpread,
        minSize: m.rewardsMinSize,
      };
    })
    .filter((m): m is MarketForCompetition => m !== null);

  const competitionMap = await fetchBatchCompetition(marketsForCompetition, {
    batchSize: options?.batchSize ?? 20,
    onProgress: options?.onProgress,
  });

  // Convert Q scores to effective competition values
  const result = new Map<string, number>();

  for (const market of markets) {
    const qScore = competitionMap.get(market.conditionId);
    if (qScore) {
      const midpoint = market.midpoint ?? 0.5;
      const twoSidedRequired = midpoint < 0.1 || midpoint > 0.9;

      let effectiveCompetition: number;
      if (twoSidedRequired) {
        // Strict two-sided: use min
        effectiveCompetition = qScore.totalQMin;
      } else {
        // Single-sided allowed with 3x penalty
        effectiveCompetition = Math.max(
          qScore.totalQMin,
          Math.max(qScore.totalBidScore / 3, qScore.totalAskScore / 3)
        );
      }

      result.set(market.conditionId, effectiveCompetition);
    }
  }

  return result;
}

/**
 * Discovers and ranks markets by earning potential.
 *
 * This is the main function for market discovery. It:
 * 1. Fetches markets with active reward programs
 * 2. Calculates real competition from orderbooks
 * 3. Ranks markets by estimated daily earnings
 *
 * Note: Volatility filtering is handled by findBestMarket() using an
 * optimized approach (checking top candidates only).
 *
 * @param options - Discovery options
 * @returns Discovery result with ranked markets
 */
export async function discoverMarkets(
  options: MarketDiscoveryOptions = {}
): Promise<MarketDiscoveryResult> {
  const liquidity = options.liquidity ?? DEFAULT_ESTIMATE_LIQUIDITY;

  // Fetch markets with reward programs
  const fetchOptions: FetchMarketsWithRewardsOptions = {
    maxMinSize: options.maxMinSize,
    liquidityAmount: liquidity,
    onProgress: options.onFetchProgress,
  };

  const markets = await fetchMarketsWithRewards(fetchOptions);

  if (markets.length === 0) {
    return {
      markets: [],
      totalFetched: 0,
      compatibleCount: 0,
      competitionFetched: 0,
    };
  }

  // Fetch real competition from orderbooks (unless skipped)
  let marketsWithRealCompetition = markets;
  let competitionFetched = 0;

  if (!options.skipCompetitionFetch) {
    const competitionMap = await fetchRealCompetition(markets, {
      onProgress: options.onCompetitionProgress,
      batchSize: 20,
    });

    competitionFetched = competitionMap.size;

    // Update markets with real competition
    marketsWithRealCompetition = markets.map((m) => {
      const competition = competitionMap.get(m.conditionId);
      if (competition !== undefined) {
        return { ...m, competitive: competition };
      }
      return m;
    });
  }

  // Rank by earnings
  let rankedMarkets = rankMarketsByEarnings(
    marketsWithRealCompetition,
    liquidity
  );

  // Apply limit if specified
  if (options.limit && options.limit > 0) {
    rankedMarkets = rankedMarkets.slice(0, options.limit);
  }

  return {
    markets: rankedMarkets,
    totalFetched: markets.length,
    compatibleCount: rankedMarkets.length,
    competitionFetched,
  };
}

/**
 * Finds the single best market for a given liquidity amount.
 *
 * Optimized version that checks volatility only on top candidates:
 * 1. Fetches markets with rewards
 * 2. Calculates competition and ranks by earnings
 * 3. Iterates through top markets checking volatility until a safe one is found
 *
 * This is much faster than checking volatility on all markets upfront.
 *
 * @param liquidity - Liquidity amount in USD
 * @param options - Additional discovery options
 * @returns The best market, or null if no eligible markets found
 *
 * @example
 * ```typescript
 * const best = await findBestMarket(200);
 * if (best) {
 *   console.log(`Best: ${best.question} - $${best.earningPotential.estimatedDailyEarnings.toFixed(2)}/day`);
 * }
 * ```
 */
export async function findBestMarket(
  liquidity: number,
  options: FindBestMarketOptions = {}
): Promise<RankedMarketByEarnings | null> {
  // If no volatility filtering requested, use old approach
  if (!options.volatilityThresholds) {
    const result = await discoverMarkets({
      ...options,
      liquidity,
      limit: 1,
    });
    return result.markets[0] ?? null;
  }

  // Optimized approach: rank first, then check volatility iteratively
  log("[Discovery] Using optimized volatility checking (top-first)");

  // Get all markets ranked by earnings WITHOUT volatility filtering
  const result = await discoverMarkets({
    maxMinSize: options.maxMinSize,
    skipCompetitionFetch: options.skipCompetitionFetch,
    onFetchProgress: options.onFetchProgress,
    onCompetitionProgress: options.onCompetitionProgress,
    liquidity,
  });

  if (result.markets.length === 0) {
    return null;
  }

  log(`[Discovery] Ranked ${result.markets.length} markets by earnings, checking volatility on top candidates...`);

  // Iterate through ranked markets, checking volatility one at a time
  let checked = 0;
  let filtered = 0;

  for (const market of result.markets) {
    const tokenId = getFirstTokenId(market);
    if (!tokenId) {
      checked++;
      filtered++;
      if (options.onVolatilityProgress) {
        options.onVolatilityProgress(checked, result.markets.length, filtered);
      }
      continue;
    }

    // Check this specific market's volatility
    const isSafe = await checkMarketVolatility(
      tokenId,
      market.question,
      options.volatilityThresholds
    );

    checked++;
    if (options.onVolatilityProgress) {
      options.onVolatilityProgress(checked, result.markets.length, filtered);
    }

    if (isSafe) {
      log(`[Discovery] Found safe market after checking ${checked} candidates (${filtered} filtered)`);
      return market;
    }

    filtered++;
  }

  log(`[Discovery] No safe markets found after checking all ${checked} candidates`);
  return null;
}

/**
 * Re-exports for convenience.
 */
export { DEFAULT_ESTIMATE_LIQUIDITY } from "@/utils/rewards.js";
export type { MarketWithRewards, RankedMarketByEarnings } from "@/types/rewards.js";
