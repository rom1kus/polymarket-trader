/**
 * Authenticated CLOB client factory for trading operations.
 *
 * Creates a ClobClient with full authentication for placing and managing orders.
 * Uses Gnosis Safe (POLY_GNOSIS_SAFE) signature type.
 */

import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { config } from "@/config/index.js";
import { env } from "@/utils/env.js";

/**
 * Signature types supported by Polymarket CLOB:
 * - 0: EOA (Externally Owned Account) - direct wallet
 * - 1: POLY_PROXY - Magic/Email login proxy wallet
 * - 2: POLY_GNOSIS_SAFE - Gnosis Safe wallet
 */
const SIGNATURE_TYPE = {
  EOA: 0,
  POLY_PROXY: 1,
  POLY_GNOSIS_SAFE: 2,
} as const;

/**
 * Creates an authenticated ClobClient for trading operations.
 *
 * Uses Gnosis Safe signature type (2) with the configured proxy address.
 * Automatically derives or creates API credentials on first use.
 *
 * @returns Fully authenticated ClobClient ready for order operations
 *
 * @example
 * const client = await createAuthenticatedClobClient();
 * await client.createAndPostOrder(...);
 */
export async function createAuthenticatedClobClient(): Promise<ClobClient> {
  const signer = new Wallet(env.FUNDER_PRIVATE_KEY);

  // Create client with Gnosis Safe signature type from the start
  // This ensures API key derivation uses the correct proxy address
  const client = new ClobClient(
    config.clobHost,
    config.chain,
    signer,
    undefined, // no creds yet
    SIGNATURE_TYPE.POLY_GNOSIS_SAFE,
    env.POLYMARKET_PROXY_ADDRESS
  );

  // Derive API credentials deterministically from the wallet signature
  // Note: We use deriveApiKey() instead of createOrDeriveApiKey() to avoid
  // noisy error logs when the API key already exists on the server
  const creds = await client.deriveApiKey();

  // Create fully authenticated client with credentials
  return new ClobClient(
    config.clobHost,
    config.chain,
    signer,
    creds,
    SIGNATURE_TYPE.POLY_GNOSIS_SAFE,
    env.POLYMARKET_PROXY_ADDRESS
  );
}
