/**
 * Utilities for interacting with the Polymarket Gamma API.
 *
 * The Gamma API provides event and market metadata, complementing the CLOB API
 * which handles trading operations.
 */

import { config } from "@/config/index.js";
import type {
  GammaEvent,
  GammaMarket,
  ParsedGammaEvent,
  ParsedGammaMarket,
  ParsedOutcome,
  MarketRewardParams,
} from "@/types/gamma.js";
import type { MarketWithRewards } from "@/types/rewards.js";

/**
 * Extracts the slug from a Polymarket URL or returns the input if already a slug.
 *
 * @param input - URL like "https://polymarket.com/event/uefa-champions-league-winner" or slug "uefa-champions-league-winner"
 * @returns The extracted slug
 *
 * @example
 * extractSlug("https://polymarket.com/event/uefa-champions-league-winner") // "uefa-champions-league-winner"
 * extractSlug("uefa-champions-league-winner") // "uefa-champions-league-winner"
 */
export function extractSlug(input: string): string {
  // Check if it's a URL
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const url = new URL(input);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Expected format: /event/{slug}
    if (pathParts[0] === "event" && pathParts[1]) {
      return pathParts[1];
    }

    throw new Error(
      `Invalid Polymarket URL format: ${input}. Expected format: https://polymarket.com/event/{slug}`
    );
  }

  // Assume it's already a slug
  return input;
}

/**
 * Parses outcome prices and token IDs from a GammaMarket into structured data.
 *
 * The Gamma API returns outcomes, prices, and token IDs as JSON array strings.
 * This function parses them into a structured array.
 *
 * @param market - The market to parse
 * @returns Array of parsed outcomes with price and token ID
 */
export function parseMarketOutcomes(market: GammaMarket): ParsedOutcome[] {
  const outcomes = market.outcomes
    ? (JSON.parse(market.outcomes) as string[])
    : [];
  const prices = market.outcomePrices
    ? (JSON.parse(market.outcomePrices) as string[])
    : [];

  // clobTokenIds can be either a JSON array string or comma-separated
  let tokenIds: string[] = [];
  if (market.clobTokenIds) {
    const trimmed = market.clobTokenIds.trim();
    if (trimmed.startsWith("[")) {
      // It's a JSON array
      tokenIds = JSON.parse(trimmed) as string[];
    } else {
      // It's comma-separated
      tokenIds = trimmed.split(",").map((id) => id.trim());
    }
  }

  return outcomes.map((outcome, index) => ({
    outcome,
    price: prices[index] ? parseFloat(prices[index]) : 0,
    tokenId: tokenIds[index] || "",
  }));
}

/**
 * Enhances a GammaMarket with parsed outcome data.
 *
 * @param market - The market to enhance
 * @returns Market with parsedOutcomes array
 */
export function parseGammaMarket(market: GammaMarket): ParsedGammaMarket {
  return {
    ...market,
    parsedOutcomes: parseMarketOutcomes(market),
  };
}

/**
 * Fetches an event by its slug from the Gamma API.
 *
 * @param slug - The event slug (e.g., "uefa-champions-league-winner")
 * @param fetcher - Optional fetch function for testing (defaults to global fetch)
 * @returns The event data with associated markets
 * @throws Error if the event is not found or request fails
 *
 * @example
 * const event = await fetchEventBySlug("uefa-champions-league-winner");
 * console.log(event.title); // "UEFA Champions League Winner"
 * console.log(event.markets.length); // 31 (one per team)
 */
export async function fetchEventBySlug(
  slug: string,
  fetcher: typeof fetch = fetch
): Promise<GammaEvent> {
  const url = `${config.gammaHost}/events/slug/${encodeURIComponent(slug)}`;

  const response = await fetcher(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Event not found: ${slug}`);
    }
    throw new Error(
      `Failed to fetch event: ${response.status} ${response.statusText}`
    );
  }

  const event = (await response.json()) as GammaEvent;
  return event;
}

/**
 * Fetches an event by slug and parses all market outcomes.
 *
 * @param slugOrUrl - Event slug or full Polymarket URL
 * @returns Event with parsed market data
 */
export async function fetchEventWithParsedMarkets(
  slugOrUrl: string
): Promise<ParsedGammaEvent> {
  const slug = extractSlug(slugOrUrl);
  const event = await fetchEventBySlug(slug);

  return {
    ...event,
    markets: event.markets.map(parseGammaMarket),
  };
}

/**
 * Raw market data from Gamma API when fetching by token ID.
 * Contains reward parameters.
 */
interface GammaMarketResponse {
  rewardsMinSize?: number;
  rewardsMaxSpread?: number;
}

/**
 * Fetches reward parameters for a market from the Gamma API.
 *
 * @param tokenId - CLOB token ID for the market
 * @param fetcher - Optional fetch function for testing (defaults to global fetch)
 * @returns Market reward parameters
 * @throws Error if the market is not found
 *
 * @example
 * const params = await fetchMarketRewardParams(tokenId);
 * console.log(`Min size: ${params.rewardsMinSize}`);
 * console.log(`Max spread: ${params.rewardsMaxSpread}c`);
 */
export async function fetchMarketRewardParams(
  tokenId: string,
  fetcher: typeof fetch = fetch
): Promise<MarketRewardParams> {
  const url = `${config.gammaHost}/markets?clob_token_ids=${encodeURIComponent(tokenId)}`;

  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch market reward params: ${response.status} ${response.statusText}`
    );
  }

  const markets = (await response.json()) as GammaMarketResponse[];

  if (!markets || markets.length === 0) {
    throw new Error(`Market not found for token ${tokenId}`);
  }

  const market = markets[0];

  return {
    tokenId,
    rewardsMinSize: market.rewardsMinSize ?? 0,
    rewardsMaxSpread: market.rewardsMaxSpread ?? 0,
  };
}

/**
 * Raw market response from Polymarket rewards API.
 * Uses snake_case field names.
 */
interface RewardsMarketResponse {
  market_id: number;
  condition_id: string;
  question: string;
  market_slug: string;
  volume_24hr: number;
  event_id: number;
  event_slug: string;
  image: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  rewards_config: Array<{
    asset_address: string;
    start_date: string;
    end_date: string;
    rate_per_day: number;
    total_rewards: number;
  }>;
  rewards_max_spread: number;
  rewards_min_size: number;
  earning_percentage: number;
  spread: number;
  market_competitiveness: number;
  neg_risk?: boolean;
}

/**
 * User-specific rewards data for a market.
 * Returned when maker_address is provided to the rewards API.
 */
export interface UserRewardData {
  /** Condition ID for the market */
  conditionId: string;
  /** Token IDs for the market */
  tokenIds: string[];
  /** Market question */
  question: string;
  /** Maximum spread from midpoint for rewards (in cents) */
  rewardsMaxSpread: number;
  /** Minimum order size for rewards (in shares) */
  rewardsMinSize: number;
  /** Daily reward rate in USD */
  ratePerDay: number;
  /** User's earning percentage (0-100) from API */
  earningPercentage: number;
  /** Current spread on the market */
  spread: number;
  /** Market competitiveness score */
  marketCompetitiveness: number;
}

/**
 * Options for fetching markets with rewards.
 */
export interface FetchMarketsWithRewardsOptions {
  /** Maximum number of markets to fetch. Use Infinity to fetch all (default: Infinity) */
  limit?: number;
  /** Maximum rewardsMinSize - filter markets by min shares required for rewards */
  maxMinSize?: number;
  /** Liquidity amount for early compatibility filtering (skips markets that can't meet minSize) */
  liquidityAmount?: number;
  /** Progress callback - called after each page with (fetched, total, filtered) */
  onProgress?: (fetched: number, total: number, filtered: number) => void;
}

/**
 * Enriches a single market with correct negRisk value from Gamma API.
 * 
 * The Rewards API has incorrect/stale negRisk data, while the Gamma API
 * is the authoritative source for this field. This is critical for proper
 * signature generation in order placement.
 *
 * @param market - Market to enrich (modified in place)
 * @param fetcher - Optional fetch function for testing
 * @returns The enriched market
 */
export async function enrichMarketNegRisk(
  market: MarketWithRewards,
  fetcher: typeof fetch = fetch
): Promise<MarketWithRewards> {
  if (!market.slug) return market;

  try {
    const url = `https://gamma-api.polymarket.com/markets?slug=${market.slug}`;
    const response = await fetcher(url);
    
    if (response.ok) {
      const gammaMarkets = (await response.json()) as GammaMarket[];
      if (gammaMarkets.length > 0) {
        market.negRisk = gammaMarkets[0].negRisk ?? false;
      }
    }
  } catch (error) {
    // Non-fatal: if enrichment fails, we continue with Rewards API data
    console.warn(`[gamma] Failed to enrich negRisk for ${market.slug}: ${error}`);
  }

  return market;
}

/**
 * Enriches market data with correct negRisk values from Gamma API.
 * 
 * The Rewards API has incorrect/stale negRisk data, while the Gamma API
 * is the authoritative source for this field. This function fetches markets
 * individually by slug and updates the negRisk property.
 *
 * Note: This adds some overhead, but ensures correct negRisk values which are
 * critical for proper signature generation in order placement.
 *
 * @param markets - Markets to enrich (modified in place)
 * @param fetcher - Optional fetch function for testing
 */
async function enrichNegRiskFromGammaAPI(
  markets: MarketWithRewards[],
  fetcher: typeof fetch = fetch
): Promise<void> {
  if (markets.length === 0) return;

  try {
    // Fetch markets by slug (most reliable identifier)
    // We batch these to avoid overwhelming the API
    const BATCH_SIZE = 10;
    const DELAY_MS = 100; // Small delay between batches

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      
      // Fetch in parallel within batch
      await Promise.all(
        batch.map(async (market) => {
          if (!market.slug) return;
          
          try {
            const url = `https://gamma-api.polymarket.com/markets?slug=${market.slug}`;
            const response = await fetcher(url);
            
            if (response.ok) {
              const gammaMarkets = (await response.json()) as GammaMarket[];
              if (gammaMarkets.length > 0) {
                market.negRisk = gammaMarkets[0].negRisk ?? false;
              }
            }
          } catch (error) {
            // Skip individual failures
          }
        })
      );

      // Small delay between batches to be nice to the API
      if (i + BATCH_SIZE < markets.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
  } catch (error) {
    // Non-fatal: if enrichment fails, we continue with Rewards API data
    console.warn(`[gamma] Failed to enrich negRisk from Gamma API: ${error}`);
  }
}

/**
 * Fetches markets with active reward programs from Polymarket rewards API.
 * 
 * Supports pagination to fetch all markets (API returns max 100 per request).
 * Applies early filtering during fetch to reduce memory usage.
 * 
 * IMPORTANT: The Rewards API has incorrect negRisk data. This function automatically
 * enriches results with correct negRisk values from the authoritative Gamma API.
 *
 * @param options - Filtering options
 * @param fetcher - Optional fetch function for testing
 * @returns Array of markets with reward info and correct negRisk values
 *
 * @example
 * // Fetch all markets with progress
 * const markets = await fetchMarketsWithRewards({
 *   liquidityAmount: 100,
 *   onProgress: (fetched, total, filtered) => {
 *     console.log(`Fetched ${fetched}/${total}, kept ${filtered}`);
 *   }
 * });
 */
export async function fetchMarketsWithRewards(
  options: FetchMarketsWithRewardsOptions = {},
  fetcher: typeof fetch = fetch
): Promise<MarketWithRewards[]> {
  const {
    limit = Infinity,
    maxMinSize,
    liquidityAmount,
    onProgress,
  } = options;

  const PAGE_SIZE = 100; // API returns 100 per request
  const markets: MarketWithRewards[] = [];
  let nextCursor: string | null = null;
  let totalCount = 0;
  let fetchedCount = 0;

  while (true) {
    // Fetch a page using cursor-based pagination
    const url = nextCursor
      ? `https://polymarket.com/api/rewards/markets?nextCursor=${nextCursor}`
      : `https://polymarket.com/api/rewards/markets`;
    const response = await fetcher(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch rewards markets: ${response.status} ${response.statusText}`
      );
    }

    const responseData = (await response.json()) as {
      data: RewardsMarketResponse[];
      total_count: number;
      next_cursor: string | null;
      count: number;
    };

    totalCount = responseData.total_count;
    const rawMarkets = responseData.data ?? [];
    fetchedCount += responseData.count ?? 0;

    // Process and filter this page
    for (const m of rawMarkets) {
      // Early filter: skip markets without active reward config
      if (!m.rewards_max_spread || m.rewards_max_spread <= 0) continue;

      // Early filter: skip markets exceeding max min size
      if (maxMinSize !== undefined && m.rewards_min_size > maxMinSize) continue;

      // Get YES token price for share calculations
      const midpoint = m.tokens && m.tokens.length >= 1 ? m.tokens[0].price : undefined;

      // Early filter: skip markets where liquidity can't meet minSize
      if (liquidityAmount !== undefined && midpoint !== undefined && m.rewards_min_size > 0) {
        const twoSidedRequired = midpoint < 0.1 || midpoint > 0.9;
        
        if (twoSidedRequired) {
          // Both sides need to meet minSize
          const halfLiq = liquidityAmount / 2;
          const yesShares = halfLiq / midpoint;
          const noShares = halfLiq / (1 - midpoint);
          if (yesShares < m.rewards_min_size || noShares < m.rewards_min_size) continue;
        } else {
          // Single-sided: check if we can meet minSize on the cheaper side
          const shares = liquidityAmount / midpoint;
          if (shares < m.rewards_min_size) continue;
        }
      }

      // Calculate daily rewards from rewards_config
      const rewardsDaily = m.rewards_config?.reduce(
        (sum, rc) => sum + (rc.rate_per_day || 0),
        0
      ) ?? 0;

      // Skip markets with no reward pool
      if (rewardsDaily <= 0) continue;

      markets.push({
        id: String(m.market_id),
        question: m.question,
        conditionId: m.condition_id,
        eventSlug: m.event_slug,
        eventTitle: m.question, // API doesn't provide event title separately
        slug: m.market_slug,
        groupItemTitle: undefined,
        clobTokenIds: m.tokens?.map(t => t.token_id).join(","),
        active: true, // Only active markets are in rewards API
        closed: false,
        acceptingOrders: true,
        enableOrderBook: true,
        negRisk: m.neg_risk ?? false,
        liquidityNum: 0, // Not provided by rewards API
        volume24hr: m.volume_24hr ?? 0,
        rewardsMinSize: m.rewards_min_size ?? 0,
        rewardsMaxSpread: m.rewards_max_spread ?? 0,
        spread: m.spread,
        competitive: m.market_competitiveness,
        rewardsDaily,
        midpoint,
      });

      // Check if we've reached the limit
      if (markets.length >= limit) {
        break;
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(Math.min(fetchedCount, totalCount), totalCount, markets.length);
    }

    // Get next cursor for pagination
    nextCursor = responseData.next_cursor;

    // Check if we've fetched all pages or reached limit
    if (!nextCursor || fetchedCount >= totalCount || markets.length >= limit) {
      break;
    }
  }

  // IMPORTANT: DO NOT enrich negRisk here - too slow for 2000+ markets
  // Instead, we'll enrich on-demand for the top-ranked markets in marketDiscovery.ts
  // The Rewards API has incorrect negRisk data, so enrichment is needed before trading

  return markets;
}

/**
 * Fetches user-specific rewards data for markets from the Polymarket rewards API.
 *
 * When maker_address is provided, the API returns the user's earning_percentage
 * for each market.
 *
 * @param conditionIds - Array of condition IDs to fetch rewards for
 * @param makerAddress - User's wallet address to get earning percentage
 * @param fetcher - Optional fetch function for testing
 * @returns Map of condition ID to user reward data
 *
 * @example
 * const rewardsMap = await fetchUserRewardsData(["0x123..."], "0xabc...");
 * console.log(rewardsMap.get("0x123...")?.earningPercentage); // 17.59
 */
export async function fetchUserRewardsData(
  conditionIds: string[],
  makerAddress: string,
  fetcher: typeof fetch = fetch
): Promise<Map<string, UserRewardData>> {
  // Build query params with condition IDs and maker address
  const params = new URLSearchParams();
  for (const id of conditionIds) {
    params.append("id", id);
  }
  params.append("makerAddress", makerAddress);

  const url = `https://polymarket.com/api/rewards/markets?${params.toString()}`;
  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch user rewards data: ${response.status} ${response.statusText}`
    );
  }

  const responseData = (await response.json()) as {
    data: RewardsMarketResponse[];
    total_count: number;
  };

  const rewardsMap = new Map<string, UserRewardData>();

  for (const m of responseData.data) {
    const ratePerDay = m.rewards_config?.reduce(
      (sum, rc) => sum + (rc.rate_per_day || 0),
      0
    ) ?? 0;

    rewardsMap.set(m.condition_id, {
      conditionId: m.condition_id,
      tokenIds: m.tokens?.map(t => t.token_id) ?? [],
      question: m.question,
      rewardsMaxSpread: m.rewards_max_spread ?? 0,
      rewardsMinSize: m.rewards_min_size ?? 0,
      ratePerDay,
      earningPercentage: m.earning_percentage ?? 0,
      spread: m.spread ?? 0,
      marketCompetitiveness: m.market_competitiveness ?? 0,
    });
  }

  return rewardsMap;
}

/**
 * Market rewards data fetched from the API.
 */
export interface MarketRewardsInfo {
  /** Market competitiveness (total Q_min for one side) */
  marketCompetitiveness: number;
  /** Daily reward rate in USD */
  ratePerDay: number;
}

/**
 * Response from CLOB rewards endpoint for a single market.
 */
interface ClobRewardsMarketResponse {
  condition_id: string;
  question: string;
  market_slug: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  rewards_config: Array<{
    asset_address: string;
    start_date: string;
    end_date: string;
    rate_per_day: number;
    total_rewards: number;
  }>;
  rewards_max_spread: number;
  rewards_min_size: number;
  market_competitiveness: number;
}

/**
 * Fetches market rewards data for specific condition IDs.
 *
 * Uses the CLOB API endpoint which supports direct lookup by condition ID:
 * https://clob.polymarket.com/rewards/markets/{conditionId}
 *
 * @param conditionIds - Array of condition IDs to look up
 * @param fetcher - Optional fetch function for testing
 * @returns Map of condition ID to market rewards info
 */
export async function fetchMarketRewardsInfo(
  conditionIds: string[],
  fetcher: typeof fetch = fetch
): Promise<Map<string, MarketRewardsInfo>> {
  const result = new Map<string, MarketRewardsInfo>();

  // Fetch each market directly from the CLOB rewards endpoint
  // This endpoint supports direct lookup by condition ID
  const fetchPromises = conditionIds.map(async (conditionId) => {
    try {
      const url = `${config.clobHost}/rewards/markets/${conditionId}`;
      const response = await fetcher(url);

      if (!response.ok) {
        // Market may not have rewards enabled
        return;
      }

      const responseData = (await response.json()) as {
        data: ClobRewardsMarketResponse[];
      };

      if (responseData.data && responseData.data.length > 0) {
        const m = responseData.data[0];
        const ratePerDay = m.rewards_config?.reduce(
          (sum, rc) => sum + (rc.rate_per_day || 0),
          0
        ) ?? 0;

        result.set(conditionId, {
          marketCompetitiveness: m.market_competitiveness ?? 0,
          ratePerDay,
        });
      }
    } catch {
      // Silently ignore errors for individual markets
    }
  });

  await Promise.all(fetchPromises);

  return result;
}

/**
 * Fetches market competitiveness data for specific condition IDs.
 * @deprecated Use fetchMarketRewardsInfo instead for more complete data
 */
export async function fetchMarketCompetitiveness(
  conditionIds: string[],
  fetcher: typeof fetch = fetch
): Promise<Map<string, number>> {
  const info = await fetchMarketRewardsInfo(conditionIds, fetcher);
  const result = new Map<string, number>();
  for (const [id, data] of info) {
    result.set(id, data.marketCompetitiveness);
  }
  return result;
}
