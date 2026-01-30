/**
 * Persistence for liquidation state.
 * 
 * Saves the list of markets currently in liquidation mode so they can be
 * resumed on restart.
 * 
 * File: ./data/liquidations.json
 * 
 * Schema:
 * {
 *   version: 1,
 *   markets: [
 *     { conditionId: "0x...", startedAt: 1234567890, stage: "passive" }
 *   ]
 * }
 */

import fs from "fs";
import path from "path";

const DATA_DIR = "./data";
const LIQUIDATIONS_FILE = path.join(DATA_DIR, "liquidations.json");
const SCHEMA_VERSION = 1;

/**
 * Minimal liquidation state for persistence.
 */
export interface PersistedLiquidation {
  conditionId: string;
  startedAt: number;
  stage: "passive" | "skewed" | "aggressive" | "market";
}

export interface LiquidationsFile {
  version: number;
  markets: PersistedLiquidation[];
  lastUpdated: number;
}

/**
 * Ensures the data directory exists.
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Loads the liquidations file from disk.
 * 
 * @returns Liquidations file or null if not found
 */
export function loadLiquidations(): LiquidationsFile | null {
  if (!fs.existsSync(LIQUIDATIONS_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(LIQUIDATIONS_FILE, "utf-8");
    const data = JSON.parse(content) as LiquidationsFile;

    // Validate schema version
    if (data.version !== SCHEMA_VERSION) {
      console.warn(
        `[LiquidationState] Schema version mismatch: found ${data.version}, expected ${SCHEMA_VERSION}`
      );
      // For now, just ignore old versions
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[LiquidationState] Failed to load liquidations file:`, error);
    return null;
  }
}

/**
 * Saves the liquidations file to disk.
 * 
 * @param liquidations - Array of liquidation states
 */
export function saveLiquidations(liquidations: PersistedLiquidation[]): void {
  ensureDataDir();

  const data: LiquidationsFile = {
    version: SCHEMA_VERSION,
    markets: liquidations,
    lastUpdated: Date.now(),
  };

  try {
    fs.writeFileSync(LIQUIDATIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`[LiquidationState] Failed to save liquidations file:`, error);
    throw error;
  }
}

/**
 * Adds a market to the liquidations file.
 * 
 * @param conditionId - Market condition ID
 * @param stage - Liquidation stage
 */
export function addLiquidation(conditionId: string, stage: PersistedLiquidation["stage"]): void {
  const existing = loadLiquidations();
  const markets = existing?.markets ?? [];

  // Check if already exists
  if (markets.some((m) => m.conditionId === conditionId)) {
    // Already in liquidation, don't add duplicate
    return;
  }

  markets.push({
    conditionId,
    startedAt: Date.now(),
    stage,
  });

  saveLiquidations(markets);
}

/**
 * Removes a market from the liquidations file.
 * 
 * @param conditionId - Market condition ID
 */
export function removeLiquidation(conditionId: string): void {
  const existing = loadLiquidations();
  if (!existing) return;

  const markets = existing.markets.filter((m) => m.conditionId !== conditionId);
  saveLiquidations(markets);
}

/**
 * Clears all liquidations from the file.
 */
export function clearLiquidations(): void {
  if (fs.existsSync(LIQUIDATIONS_FILE)) {
    fs.unlinkSync(LIQUIDATIONS_FILE);
  }
}

/**
 * Gets all markets currently in liquidation.
 * 
 * @returns Array of condition IDs
 */
export function getLiquidationConditionIds(): string[] {
  const data = loadLiquidations();
  return data?.markets.map((m) => m.conditionId) ?? [];
}
