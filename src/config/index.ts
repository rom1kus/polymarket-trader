import { Chain } from "@polymarket/clob-client";

/**
 * Polymarket CLOB API configuration
 */
export const config = {
  /** Production CLOB API host */
  clobHost: "https://clob.polymarket.com",

  /** Polygon mainnet chain */
  chain: Chain.POLYGON,
} as const;
