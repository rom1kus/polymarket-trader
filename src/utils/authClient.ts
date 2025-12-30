/**
 * Authenticated CLOB client factory for trading operations.
 *
 * Creates a ClobClient with full authentication for placing and managing orders.
 * Uses Gnosis Safe (POLY_GNOSIS_SAFE) signature type.
 */

import { ClobClient, Chain } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { config } from "@/config/index.js";
import { env } from "@/utils/env.js";

/**
 * Signature types supported by Polymarket CLOB:
 * - 0: EOA (Externally Owned Account) - direct wallet
 * - 1: POLY_PROXY - Magic/Email login proxy wallet
 * - 2: POLY_GNOSIS_SAFE - Gnosis Safe wallet
 */
export const SIGNATURE_TYPE = {
  EOA: 0,
  POLY_PROXY: 1,
  POLY_GNOSIS_SAFE: 2,
} as const;

export type SignatureType = (typeof SIGNATURE_TYPE)[keyof typeof SIGNATURE_TYPE];

/**
 * Configuration for creating an authenticated CLOB client.
 * All fields are optional and default to environment/config values.
 */
export interface AuthClientConfig {
  /** Funder wallet private key (defaults to env.FUNDER_PRIVATE_KEY) */
  privateKey?: string;
  /** Polymarket proxy address (defaults to env.POLYMARKET_PROXY_ADDRESS) */
  proxyAddress?: string;
  /** CLOB API host (defaults to config.clobHost) */
  host?: string;
  /** Blockchain chain (defaults to config.chain) */
  chain?: Chain;
  /** Signature type (defaults to POLY_GNOSIS_SAFE) */
  signatureType?: SignatureType;
}

/**
 * Creates an authenticated ClobClient for trading operations.
 *
 * Uses Gnosis Safe signature type (2) with the configured proxy address.
 * Automatically derives or creates API credentials on first use.
 *
 * @param authConfig - Optional configuration overrides for testing
 * @returns Fully authenticated ClobClient ready for order operations
 *
 * @example
 * // Production client (uses env vars)
 * const client = await createAuthenticatedClobClient();
 * await client.createAndPostOrder(...);
 *
 * @example
 * // Custom config for testing
 * const client = await createAuthenticatedClobClient({
 *   privateKey: "0x...",
 *   proxyAddress: "0x...",
 *   host: "http://localhost:8080"
 * });
 */
export async function createAuthenticatedClobClient(
  authConfig: AuthClientConfig = {}
): Promise<ClobClient> {
  const privateKey = authConfig.privateKey ?? env.FUNDER_PRIVATE_KEY;
  const proxyAddress = authConfig.proxyAddress ?? env.POLYMARKET_PROXY_ADDRESS;
  const host = authConfig.host ?? config.clobHost;
  const chain = authConfig.chain ?? config.chain;
  const signatureType = authConfig.signatureType ?? SIGNATURE_TYPE.POLY_GNOSIS_SAFE;

  const signer = new Wallet(privateKey);

  // Create client with Gnosis Safe signature type from the start
  // This ensures API key derivation uses the correct proxy address
  const client = new ClobClient(
    host,
    chain,
    signer,
    undefined, // no creds yet
    signatureType,
    proxyAddress
  );

  // Derive API credentials deterministically from the wallet signature
  // Note: We use deriveApiKey() instead of createOrDeriveApiKey() to avoid
  // noisy error logs when the API key already exists on the server
  const creds = await client.deriveApiKey();

  // Create fully authenticated client with credentials
  return new ClobClient(
    host,
    chain,
    signer,
    creds,
    signatureType,
    proxyAddress
  );
}
