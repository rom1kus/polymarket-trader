/**
 * Polygon mainnet contract addresses and constants.
 *
 * These are the core contracts used for Polymarket trading on Polygon.
 */

/**
 * Contract addresses on Polygon mainnet.
 */
export const contracts = {
  /** Conditional Token Framework (CTF) contract for split/merge/redeem */
  CTF: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",

  /** USDC on Polygon (bridged, 6 decimals) */
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",

  /** Negative Risk CTF Adapter (for multi-outcome markets) */
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",

  /** Negative Risk CTF Exchange */
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
} as const;

/** USDC has 6 decimals on Polygon */
export const USDC_DECIMALS = 6;

/** Minimum MATIC balance required for gas fees (in MATIC) */
export const MIN_MATIC_BALANCE = 0.1;

/** Default public RPC URL for Polygon mainnet */
export const DEFAULT_POLYGON_RPC = "https://polygon.drpc.org";
