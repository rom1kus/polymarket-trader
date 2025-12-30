/**
 * Position-related types for tracking holdings across markets.
 */

/**
 * A position in a single token (YES or NO outcome).
 */
export interface Position {
  /** The token ID */
  tokenId: string;
  /** Number of shares held (0 if none) */
  size: number;
  /** Whether this is a long position (size > 0) */
  hasPosition: boolean;
}

/**
 * A complete position for a binary market (YES and NO tokens).
 */
export interface MarketPosition {
  /** The market condition ID */
  conditionId?: string;
  /** YES token position */
  yes: Position;
  /** NO token position */
  no: Position;
  /** Net exposure: positive = net long YES, negative = net long NO */
  netExposure: number;
}

/**
 * Summary of all positions across multiple markets.
 */
export interface PositionsSummary {
  /** Individual token positions */
  positions: Position[];
  /** Total number of positions with non-zero balance */
  activePositionCount: number;
  /** Total value of all positions (requires price data) */
  totalValue?: number;
}
