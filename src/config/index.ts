import { Chain } from "@polymarket/clob-client";

/**
 * Polymarket API configuration
 */
export const config = {
  /** Production CLOB API host (for trading, order book, prices) */
  clobHost: "https://clob.polymarket.com",

  /** Production Gamma API host (for events, markets metadata) */
  gammaHost: "https://gamma-api.polymarket.com",

  /** Polygon mainnet chain */
  chain: Chain.POLYGON,
} as const;
