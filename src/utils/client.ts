import { ClobClient } from "@polymarket/clob-client";
import { config } from "@/config/index.js";

/**
 * Creates a ClobClient instance with default configuration.
 * Uses production CLOB host and Polygon mainnet.
 */
export function createClobClient(): ClobClient {
  return new ClobClient(config.clobHost, config.chain);
}
