/**
 * Gamma API types for events and markets metadata.
 *
 * These types are for the Polymarket Gamma API (https://gamma-api.polymarket.com)
 * which provides event and market metadata, separate from the CLOB trading API.
 */

/**
 * Token/outcome within a Gamma market
 */
export interface GammaToken {
  token_id: string;
  outcome: string;
  price: number;
  winner: boolean;
}

/**
 * Market data from Gamma API.
 * Each market represents a single outcome/team within an event.
 */
export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  description?: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  volumeNum: number;
  volume24hr: number;
  liquidity: string;
  liquidityNum: number;
  active: boolean;
  closed: boolean;
  archived: boolean;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  endDateIso?: string;
  startDateIso?: string;
  image?: string;
  icon?: string;
  clobTokenIds?: string;
  groupItemTitle?: string;
  orderPriceMinTickSize?: number;
  orderMinSize?: number;
  makerBaseFee?: number;
  takerBaseFee?: number;
  negRisk?: boolean;
  negRiskMarketId?: string;
  /** Parsed tokens with outcome and price info */
  tokens?: GammaToken[];
}

/**
 * Category associated with an event
 */
export interface GammaCategory {
  id: string;
  label: string;
  slug: string;
}

/**
 * Tag associated with an event
 */
export interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

/**
 * Event data from Gamma API.
 * An event groups multiple related markets (e.g., "UEFA Champions League Winner" with one market per team).
 */
export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  description?: string;
  resolutionSource?: string;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  updatedAt?: string;
  closedTime?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  new: boolean;
  featured: boolean;
  restricted: boolean;
  liquidity: number;
  volume: number;
  openInterest?: number;
  volume24hr?: number;
  volume1wk?: number;
  volume1mo?: number;
  volume1yr?: number;
  commentCount?: number;
  image?: string;
  icon?: string;
  negRisk?: boolean;
  negRiskMarketId?: string;
  enableOrderBook?: boolean;
  liquidityClob?: number;
  liquidityAmm?: number;
  /** Associated markets (outcomes) */
  markets: GammaMarket[];
  /** Categories the event belongs to */
  categories?: GammaCategory[];
  /** Tags associated with the event */
  tags?: GammaTag[];
}

/**
 * Parsed token info combining token_id with price for trading
 */
export interface ParsedOutcome {
  outcome: string;
  price: number;
  tokenId: string;
}

/**
 * Market with parsed outcome data ready for display/trading
 */
export interface ParsedGammaMarket extends GammaMarket {
  parsedOutcomes: ParsedOutcome[];
}

/**
 * Event with parsed market data, ready for display
 */
export interface ParsedGammaEvent extends Omit<GammaEvent, "markets"> {
  markets: ParsedGammaMarket[];
}

/**
 * Reward parameters for a market from Gamma API.
 * Used to determine reward eligibility for orders.
 */
export interface MarketRewardParams {
  /** Token ID for the market */
  tokenId: string;
  /** Minimum order size for reward eligibility (in shares) */
  rewardsMinSize: number;
  /** Maximum spread from midpoint for rewards (in cents) */
  rewardsMaxSpread: number;
}
