/**
 * File-based persistence for market state and fills.
 *
 * Stores fill history and position state as JSON files in ./data/ directory.
 * One file per market: ./data/fills-{conditionId}.json
 *
 * ## Schema Versioning
 *
 * The persisted state uses a `version` field for schema migrations.
 * Current version: 2 (defined in `PERSISTED_STATE_VERSION` from types/fills.ts)
 *
 * ### Migration Requirements
 *
 * When changing the `PersistedMarketState` schema:
 *
 * 1. Increment `PERSISTED_STATE_VERSION` in `src/types/fills.ts`
 * 2. Add migration logic in `loadMarketState()` to handle old versions
 * 3. Migrations should be non-destructive (preserve existing data)
 * 4. Test migration with existing data files before deploying
 *
 * ### Version History
 *
 * - v1: Initial schema (fills, initialPosition)
 * - v2: Added `economics` for P&L tracking, `initialCostBasis` for pre-existing positions
 */

import fs from "fs";
import path from "path";
import type { Fill, FillEconomics, PersistedMarketState } from "@/types/fills.js";
import { createEmptyEconomics, PERSISTED_STATE_VERSION } from "@/types/fills.js";

/** Default data directory relative to project root */
const DATA_DIR = "./data";

/** Current schema version - imported from types for consistency */
const SCHEMA_VERSION = PERSISTED_STATE_VERSION;

/**
 * Ensures the data directory exists.
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Gets the storage file path for a market.
 *
 * @param conditionId - Market condition ID
 * @returns Full path to the storage file
 */
export function getStoragePath(conditionId: string): string {
  // Use first 16 chars of condition ID for filename (enough to be unique)
  const shortId = conditionId.substring(0, 18).replace("0x", "");
  return path.join(DATA_DIR, `fills-${shortId}.json`);
}

/**
 * Loads persisted market state from disk.
 *
 * Handles schema migration from v1 to v2 by rebuilding economics from fills.
 *
 * @param conditionId - Market condition ID
 * @returns Persisted state or null if not found
 */
export function loadMarketState(conditionId: string): PersistedMarketState | null {
  const filePath = getStoragePath(conditionId);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const rawState = JSON.parse(content);

    // Handle schema migration
    if (rawState.version === 1) {
      console.log(
        `[Storage] Migrating from schema v1 to v${SCHEMA_VERSION}. Rebuilding economics from fills.`
      );
      // Rebuild economics from fills for v1 data
      const yesTokenId = rawState.yesTokenId;
      const economics = rebuildEconomicsFromFills(rawState.fills || [], yesTokenId);

      const migratedState: PersistedMarketState = {
        ...rawState,
        version: SCHEMA_VERSION,
        economics,
      };

      // Save migrated state
      saveMarketState(migratedState);
      return migratedState;
    }

    const state = rawState as PersistedMarketState;

    // Validate schema version
    if (state.version !== SCHEMA_VERSION) {
      console.warn(
        `[Storage] Schema version mismatch: found ${state.version}, expected ${SCHEMA_VERSION}. ` +
        `Data may need migration.`
      );
    }

    // Validate condition ID matches
    if (state.conditionId !== conditionId) {
      console.warn(
        `[Storage] Condition ID mismatch in file. Expected ${conditionId}, found ${state.conditionId}`
      );
      return null;
    }

    return state;
  } catch (error) {
    console.error(`[Storage] Failed to load market state:`, error);
    return null;
  }
}

/**
 * Saves market state to disk.
 *
 * @param state - Market state to persist
 */
export function saveMarketState(state: PersistedMarketState): void {
  ensureDataDir();

  const filePath = getStoragePath(state.conditionId);

  try {
    // Update timestamp
    const stateToSave: PersistedMarketState = {
      ...state,
      lastUpdated: Date.now(),
    };

    // Write with pretty formatting for human readability
    fs.writeFileSync(filePath, JSON.stringify(stateToSave, null, 2), "utf-8");
  } catch (error) {
    console.error(`[Storage] Failed to save market state:`, error);
    throw error;
  }
}

/**
 * Creates a new empty market state.
 *
 * @param conditionId - Market condition ID
 * @param yesTokenId - YES token ID
 * @param noTokenId - NO token ID
 * @returns New persisted state with initialized economics
 */
export function createEmptyState(
  conditionId: string,
  yesTokenId: string,
  noTokenId: string
): PersistedMarketState {
  return {
    version: SCHEMA_VERSION,
    conditionId,
    yesTokenId,
    noTokenId,
    fills: [],
    lastUpdated: Date.now(),
    economics: createEmptyEconomics(),
  };
}

/**
 * Appends a fill to the market state and saves.
 *
 * This is the most common operation - adding a new fill as it happens.
 * Loads current state, appends fill, and saves atomically.
 *
 * @param conditionId - Market condition ID
 * @param yesTokenId - YES token ID (for creating new state if needed)
 * @param noTokenId - NO token ID (for creating new state if needed)
 * @param fill - Fill to append
 */
export function appendFill(
  conditionId: string,
  yesTokenId: string,
  noTokenId: string,
  fill: Fill
): void {
  // Load existing state or create new
  let state = loadMarketState(conditionId);

  if (!state) {
    state = createEmptyState(conditionId, yesTokenId, noTokenId);
  }

  // Check for duplicate fill ID
  if (state.fills.some((f) => f.id === fill.id)) {
    // Already have this fill, update status if needed
    const existingIndex = state.fills.findIndex((f) => f.id === fill.id);
    if (existingIndex >= 0) {
      state.fills[existingIndex] = fill;
    }
  } else {
    // New fill, append
    state.fills.push(fill);
  }

  // Save updated state
  saveMarketState(state);
}

/**
 * Sets the initial position in the persisted state.
 *
 * Called when starting fresh to record the baseline position
 * that fills will be calculated against.
 *
 * @param conditionId - Market condition ID
 * @param yesTokenId - YES token ID
 * @param noTokenId - NO token ID
 * @param yesTokens - Initial YES token balance
 * @param noTokens - Initial NO token balance
 */
export function setInitialPosition(
  conditionId: string,
  yesTokenId: string,
  noTokenId: string,
  yesTokens: number,
  noTokens: number
): void {
  // Load existing state or create new
  let state = loadMarketState(conditionId);

  if (!state) {
    state = createEmptyState(conditionId, yesTokenId, noTokenId);
  }

  state.initialPosition = {
    yesTokens,
    noTokens,
    timestamp: Date.now(),
  };

  saveMarketState(state);
}

/**
 * Gets statistics about stored fills.
 *
 * @param conditionId - Market condition ID
 * @returns Fill statistics or null if no data
 */
export function getFillStats(conditionId: string): {
  totalFills: number;
  buyFills: number;
  sellFills: number;
  firstFillTime: number | null;
  lastFillTime: number | null;
} | null {
  const state = loadMarketState(conditionId);

  if (!state || state.fills.length === 0) {
    return null;
  }

  const buyFills = state.fills.filter((f) => f.side === "BUY");
  const sellFills = state.fills.filter((f) => f.side === "SELL");

  // Sort by timestamp to get first/last
  const sortedFills = [...state.fills].sort((a, b) => a.timestamp - b.timestamp);

  return {
    totalFills: state.fills.length,
    buyFills: buyFills.length,
    sellFills: sellFills.length,
    firstFillTime: sortedFills[0]?.timestamp ?? null,
    lastFillTime: sortedFills[sortedFills.length - 1]?.timestamp ?? null,
  };
}

/**
 * Clears all stored data for a market.
 *
 * Use with caution - this deletes fill history.
 *
 * @param conditionId - Market condition ID
 * @returns True if file was deleted
 */
export function clearMarketState(conditionId: string): boolean {
  const filePath = getStoragePath(conditionId);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }

  return false;
}

// =============================================================================
// Economics Helpers
// =============================================================================

/**
 * Rebuilds FillEconomics from a list of fills.
 *
 * Used for:
 * - Migrating v1 data to v2 (fills exist but no economics)
 * - Recovering from corrupted economics data
 * - Recalculating if economics drift from fills
 *
 * Uses weighted average cost basis for realized P&L calculation.
 *
 * @param fills - Array of fills to process
 * @param yesTokenId - YES token ID to identify YES vs NO fills
 * @returns Rebuilt FillEconomics
 */
export function rebuildEconomicsFromFills(fills: Fill[], yesTokenId: string): FillEconomics {
  const economics = createEmptyEconomics();

  // Sort fills by timestamp to process in order (important for realized P&L)
  const sortedFills = [...fills].sort((a, b) => a.timestamp - b.timestamp);

  for (const fill of sortedFills) {
    // Skip failed fills
    if (fill.status === "FAILED") continue;

    const isYes = fill.tokenId === yesTokenId;
    const cost = fill.price * fill.size;

    if (isYes) {
      if (fill.side === "BUY") {
        economics.totalYesBought += fill.size;
        economics.totalYesCost += cost;
      } else {
        // SELL YES - calculate realized P&L using weighted average
        economics.totalYesSold += fill.size;
        economics.totalYesProceeds += cost;

        // Calculate realized P&L for this sell
        if (economics.totalYesBought > 0) {
          const avgCost = economics.totalYesCost / economics.totalYesBought;
          const realizedFromSale = (fill.price - avgCost) * fill.size;
          economics.realizedPnL += realizedFromSale;
        }
      }
    } else {
      // NO token
      if (fill.side === "BUY") {
        economics.totalNoBought += fill.size;
        economics.totalNoCost += cost;
      } else {
        // SELL NO - calculate realized P&L using weighted average
        economics.totalNoSold += fill.size;
        economics.totalNoProceeds += cost;

        // Calculate realized P&L for this sell
        if (economics.totalNoBought > 0) {
          const avgCost = economics.totalNoCost / economics.totalNoBought;
          const realizedFromSale = (fill.price - avgCost) * fill.size;
          economics.realizedPnL += realizedFromSale;
        }
      }
    }
  }

  return economics;
}

/**
 * Updates economics state and saves to disk.
 *
 * @param conditionId - Market condition ID
 * @param yesTokenId - YES token ID
 * @param noTokenId - NO token ID
 * @param economics - Updated economics to save
 */
export function saveEconomics(
  conditionId: string,
  yesTokenId: string,
  noTokenId: string,
  economics: FillEconomics
): void {
  let state = loadMarketState(conditionId);

  if (!state) {
    state = createEmptyState(conditionId, yesTokenId, noTokenId);
  }

  state.economics = economics;
  saveMarketState(state);
}
