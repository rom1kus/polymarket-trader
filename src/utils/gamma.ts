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
  /** Maximum number of markets to fetch (default: 100) */
  limit?: number;
  /** Maximum rewardsMinSize - filter markets by min shares required for rewards */
  maxMinSize?: number;
}

/**
 * Fetches markets with active reward programs from Polymarket rewards API.
 *
 * @param options - Filtering options
 * @param fetcher - Optional fetch function for testing
 * @returns Array of markets with reward info
 *
 * @example
 * const markets = await fetchMarketsWithRewards({ limit: 50 });
 * console.log(`Found ${markets.length} markets with rewards`);
 */
export async function fetchMarketsWithRewards(
  options: FetchMarketsWithRewardsOptions = {},
  fetcher: typeof fetch = fetch
): Promise<MarketWithRewards[]> {
  const {
    limit = 100,
    maxMinSize,
  } = options;

  // Use the Polymarket rewards API which returns only markets with active rewards
  const url = `https://polymarket.com/api/rewards/markets?limit=${limit}`;
  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch rewards markets: ${response.status} ${response.statusText}`
    );
  }

  const responseData = (await response.json()) as {
    data: RewardsMarketResponse[];
    total_count: number;
  };
  const rawMarkets = responseData.data;

  // Filter and transform markets
  const markets: MarketWithRewards[] = rawMarkets
    .filter((m) => {
      // Apply max min size filter (for reward eligibility)
      if (maxMinSize !== undefined && m.rewards_min_size > maxMinSize) return false;
      // Only include markets with active reward config
      if (!m.rewards_max_spread || m.rewards_max_spread <= 0) return false;
      return true;
    })
    .map((m) => {
      // Calculate daily rewards from rewards_config
      const rewardsDaily = m.rewards_config?.reduce(
        (sum, rc) => sum + (rc.rate_per_day || 0),
        0
      ) ?? 0;

      return {
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
        negRisk: undefined,
        liquidityNum: 0, // Not provided by rewards API
        volume24hr: m.volume_24hr ?? 0,
        rewardsMinSize: m.rewards_min_size ?? 0,
        rewardsMaxSpread: m.rewards_max_spread ?? 0,
        spread: m.spread,
        competitive: m.market_competitiveness,
        rewardsDaily,
      };
    });

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
 * Fetches market rewards data for specific condition IDs.
 *
 * Note: The Polymarket rewards API doesn't support filtering by condition ID,
 * so this fetches all markets and filters client-side. This is inefficient
 * but necessary since the API ignores filter params.
 *
 * @param conditionIds - Array of condition IDs to look up
 * @param fetcher - Optional fetch function for testing
 * @returns Map of condition ID to market rewards info
 */
export async function fetchMarketRewardsInfo(
  conditionIds: string[],
  fetcher: typeof fetch = fetch
): Promise<Map<string, MarketRewardsInfo>> {
  // The API returns paginated results, we need to fetch enough to find our markets
  // For now, fetch up to 500 markets (should cover most cases)
  const url = `https://polymarket.com/api/rewards/markets?limit=500`;
  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch market rewards info: ${response.status} ${response.statusText}`
    );
  }

  const responseData = (await response.json()) as {
    data: RewardsMarketResponse[];
    total_count: number;
  };

  const conditionIdSet = new Set(conditionIds);
  const result = new Map<string, MarketRewardsInfo>();

  for (const m of responseData.data) {
    if (conditionIdSet.has(m.condition_id)) {
      const ratePerDay = m.rewards_config?.reduce(
        (sum, rc) => sum + (rc.rate_per_day || 0),
        0
      ) ?? 0;

      result.set(m.condition_id, {
        marketCompetitiveness: m.market_competitiveness ?? 0,
        ratePerDay,
      });
    }
  }

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
