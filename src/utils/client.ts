import { ClobClient, Chain } from "@polymarket/clob-client";
import { config } from "@/config/index.js";

/**
 * Options for creating a CLOB client.
 */
export interface ClobClientOptions {
  /** API host URL (defaults to production CLOB API) */
  host?: string;
  /** Blockchain chain (defaults to Polygon mainnet) */
  chain?: Chain;
}

/**
 * Creates a ClobClient instance for read-only operations.
 *
 * Uses production CLOB host and Polygon mainnet by default.
 * Optional parameters allow overriding for testing or different environments.
 *
 * @param options - Optional client configuration
 * @returns ClobClient instance
 *
 * @example
 * // Production client (default)
 * const client = createClobClient();
 *
 * @example
 * // Custom host for testing
 * const client = createClobClient({ host: "http://localhost:8080" });
 */
export function createClobClient(options: ClobClientOptions = {}): ClobClient {
  const host = options.host ?? config.clobHost;
  const chain = options.chain ?? config.chain;
  return new ClobClient(host, chain);
}
