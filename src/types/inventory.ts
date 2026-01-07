/**
 * Types for inventory management in market making strategies.
 *
 * Used for pre-flight checks, balance tracking, and CTF operations
 * (split/merge positions).
 */

/**
 * Current inventory status - balances of all relevant assets.
 */
export interface InventoryStatus {
  /** USDC balance (collateral) in dollars */
  usdc: number;
  /** YES token balance (shares) */
  yesTokens: number;
  /** NO token balance (shares) */
  noTokens: number;
  /** MATIC balance for gas fees */
  matic: number;
}

/**
 * Calculated inventory requirements based on strategy config.
 */
export interface InventoryRequirements {
  /**
   * Minimum tokens needed per side.
   * Calculated as max(config.minTokenBalance, market.minOrderSize).
   */
  minTokensPerSide: number;
  /**
   * USDC to reserve for buy-side orders.
   * Calculated as orderSize * usdcReserveMultiplier.
   */
  reservedUsdc: number;
}

/**
 * Analysis of inventory deficit and required actions.
 */
export interface InventoryDeficit {
  /** Additional YES tokens needed (0 if sufficient) */
  yesDeficit: number;
  /** Additional NO tokens needed (0 if sufficient) */
  noDeficit: number;
  /**
   * USDC amount to split into tokens.
   * This is the max of yesDeficit and noDeficit since
   * splitting creates equal amounts of YES and NO.
   */
  splitAmount: number;
  /** Total USDC needed (splitAmount + reservedUsdc) */
  totalUsdcNeeded: number;
  /** Whether current USDC balance covers the deficit */
  canCoverDeficit: boolean;
  /** Whether MATIC balance is sufficient for gas */
  hasEnoughMatic: boolean;
}

/**
 * Result of pre-flight inventory checks.
 */
export interface PreFlightResult {
  /** Whether all checks passed and bot can start */
  ready: boolean;
  /** Current inventory status */
  status: InventoryStatus;
  /** Calculated requirements */
  requirements: InventoryRequirements;
  /** Deficit analysis (null if no deficit) */
  deficit: InventoryDeficit | null;
  /** Warning messages (non-fatal issues) */
  warnings: string[];
  /** Error messages (fatal issues preventing start) */
  errors: string[];
}

/**
 * Configuration for inventory management.
 */
export interface InventoryConfig {
  /**
   * Minimum token balance per side before warning/auto-split.
   * The effective minimum will be max(this, market.minOrderSize).
   */
  minTokenBalance: number;
  /** Whether to automatically split USDC when tokens are low */
  autoSplitEnabled: boolean;
  /**
   * Multiplier for USDC reserve calculation.
   * E.g., 1.2 means keep 20% extra USDC as buffer.
   */
  usdcReserveMultiplier: number;
}

/**
 * Result of a CTF operation (split or merge).
 */
export interface CtfOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Transaction hash if successful */
  transactionHash?: string;
  /** Error message if failed */
  error?: string;
  /** Amount that was split or merged */
  amount: number;
}
