/**
 * Types for fill tracking and position management.
 *
 * Used for tracking trades, calculating net exposure, and enforcing
 * position limits in market making strategies.
 */

// =============================================================================
// Fill Types
// =============================================================================

/**
 * Status of a trade/fill as it progresses through the system.
 */
export type FillStatus = "MATCHED" | "MINED" | "CONFIRMED" | "RETRYING" | "FAILED";

/**
 * A single fill event from the WebSocket user channel.
 *
 * Represents a trade execution where one of our orders was matched.
 */
export interface Fill {
  /** Unique trade ID from Polymarket */
  id: string;
  /** Token ID that was traded (YES or NO token) */
  tokenId: string;
  /** Market condition ID */
  conditionId: string;
  /** Trade direction from our perspective */
  side: "BUY" | "SELL";
  /** Fill price (0-1) */
  price: number;
  /** Size filled in tokens */
  size: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Original order ID that was filled */
  orderId: string;
  /** Current status of the trade */
  status: FillStatus;
  /** Outcome from WebSocket event ("Yes" or "No") - for debugging */
  outcome?: string;
}

// =============================================================================
// Position Types
// =============================================================================

/**
 * Current position state for a binary market.
 *
 * Tracks both YES and NO tokens to calculate net exposure.
 * Market neutral when yesTokens === noTokens (can merge back to USDC).
 */
export interface PositionState {
  /** Current YES token balance */
  yesTokens: number;
  /** Current NO token balance */
  noTokens: number;
  /**
   * Net exposure: yesTokens - noTokens
   * - Positive = long YES (profit if YES wins)
   * - Negative = long NO (profit if NO wins)
   * - Zero = market neutral
   */
  netExposure: number;
  /**
   * Neutral position: min(yesTokens, noTokens)
   * This portion can be merged back to USDC at any time.
   */
  neutralPosition: number;
}

/**
 * Position limits configuration.
 *
 * Controls how much directional exposure the market maker can take.
 */
export interface PositionLimitsConfig {
  /**
   * Maximum net exposure (absolute value) before stopping one side.
   * E.g., 100 means stop when |netExposure| > 100 tokens.
   *
   * When netExposure > maxNetExposure: stop buying YES (would increase exposure)
   * When netExposure < -maxNetExposure: stop selling YES (would decrease exposure)
   */
  maxNetExposure: number;
  /**
   * Warning threshold as percentage of max (0-1).
   * E.g., 0.8 means warn when at 80% of limit.
   */
  warnThreshold: number;
}

/**
 * Result of checking if a quote side is allowed.
 */
export interface QuoteSideCheck {
  /** Whether this side is allowed to quote */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
}

/**
 * Position limit status for monitoring.
 */
export interface PositionLimitStatus {
  /** Current net exposure (yesTokens - noTokens) */
  netExposure: number;
  /** Maximum allowed exposure from config */
  maxAllowed: number;
  /** Current utilization as percentage (0-100) */
  utilizationPercent: number;
  /** Whether we're at warning threshold */
  isWarning: boolean;
  /** Whether limit is reached (one side blocked) */
  isLimitReached: boolean;
  /** Which side is blocked (if any) */
  blockedSide: "BUY" | "SELL" | null;
}

// =============================================================================
// Economics Types
// =============================================================================

/**
 * Cumulative fill economics for P&L tracking.
 *
 * Tracks total bought/sold and cost/proceeds for each token type.
 * Uses weighted average cost basis for realized P&L calculation.
 */
export interface FillEconomics {
  /** Cumulative YES tokens bought */
  totalYesBought: number;
  /** Cumulative YES tokens sold */
  totalYesSold: number;
  /** Cumulative NO tokens bought */
  totalNoBought: number;
  /** Cumulative NO tokens sold */
  totalNoSold: number;
  /** Sum of (price × size) for all YES buys - total cost basis */
  totalYesCost: number;
  /** Sum of (price × size) for all YES sells - total proceeds */
  totalYesProceeds: number;
  /** Sum of (price × size) for all NO buys - total cost basis */
  totalNoCost: number;
  /** Sum of (price × size) for all NO sells - total proceeds */
  totalNoProceeds: number;
  /** Accumulated realized P&L from completed round-trips */
  realizedPnL: number;
}

/**
 * Creates an empty FillEconomics object with all values initialized to 0.
 */
export function createEmptyEconomics(): FillEconomics {
  return {
    totalYesBought: 0,
    totalYesSold: 0,
    totalNoBought: 0,
    totalNoSold: 0,
    totalYesCost: 0,
    totalYesProceeds: 0,
    totalNoCost: 0,
    totalNoProceeds: 0,
    realizedPnL: 0,
  };
}

/**
 * User-provided initial cost basis for pre-existing positions.
 *
 * When the bot starts with tokens that weren't acquired through tracked fills,
 * the user can provide the average cost they paid.
 */
export interface InitialCostBasis {
  /** Average cost per YES token (0-1), null if none held */
  yesAvgCost: number | null;
  /** Average cost per NO token (0-1), null if none held */
  noAvgCost: number | null;
  /** Timestamp when cost basis was provided */
  timestamp: number;
}

// =============================================================================
// Persistence Types
// =============================================================================

/** Current schema version for PersistedMarketState */
export const PERSISTED_STATE_VERSION = 2;

/**
 * Persisted state for a market.
 *
 * Saved to disk as JSON for recovery across bot restarts.
 * One file per market: ./data/fills-{conditionId}.json
 *
 * Version history:
 * - v1: Initial version with fills and position tracking
 * - v2: Added economics for P&L tracking, initialCostBasis for pre-existing positions
 */
export interface PersistedMarketState {
  /** Schema version for migrations (current: 2) */
  version: typeof PERSISTED_STATE_VERSION;
  /** Market condition ID */
  conditionId: string;
  /** YES token ID */
  yesTokenId: string;
  /** NO token ID */
  noTokenId: string;
  /** All recorded fills for this market */
  fills: Fill[];
  /** Last update timestamp (Unix ms) */
  lastUpdated: number;
  /**
   * Initial position when tracking started.
   * Used for reconciliation when fills don't account for full position.
   */
  initialPosition?: {
    yesTokens: number;
    noTokens: number;
    timestamp: number;
  };
  /**
   * Cumulative fill economics for P&L tracking.
   * Added in v2. May be undefined in migrated v1 data (will be rebuilt from fills).
   */
  economics?: FillEconomics;
  /**
   * User-provided cost basis for pre-existing positions.
   * Used when initial position exists but wasn't acquired through tracked fills.
   */
  initialCostBasis?: InitialCostBasis;
}

// =============================================================================
// Reconciliation Types
// =============================================================================

/**
 * Result of reconciling persisted state with actual balances.
 */
export interface ReconciliationResult {
  /** Whether reconciliation was successful */
  success: boolean;
  /** Expected position from fills */
  expectedPosition: PositionState;
  /** Actual position from balance API */
  actualPosition: PositionState;
  /** Difference between expected and actual */
  discrepancy: {
    yesTokens: number;
    noTokens: number;
  };
  /** Warning message if there's a discrepancy */
  warning?: string;
}
