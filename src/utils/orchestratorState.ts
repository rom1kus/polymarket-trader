/**
 * Orchestrator state management - detects existing positions to prevent
 * capital fragmentation on restart.
 *
 * When the orchestrator restarts, it scans for non-neutral positions across
 * all markets and resumes the one with the largest net exposure.
 */

import fs from "fs";
import path from "path";
import type { ClobClient } from "@polymarket/clob-client";
import { getTokenBalance } from "./balance.js";
import { loadMarketState, getStoragePath } from "./storage.js";
import { log } from "./helpers.js";

/**
 * Detected position in a market.
 */
export interface DetectedPosition {
  /** Market condition ID */
  conditionId: string;

  /** YES token ID */
  yesTokenId: string;

  /** NO token ID */
  noTokenId: string;

  /** Current YES token balance */
  yesBalance: number;

  /** Current NO token balance */
  noBalance: number;

  /** Net exposure (yesBalance - noBalance) */
  netExposure: number;

  /** Absolute net exposure (for prioritization) */
  absExposure: number;

  /** Market question (from persisted data, if available) */
  marketQuestion?: string;

  /** Source of position data */
  source: "persisted" | "on-chain-only";
}

/**
 * Dust threshold - balances below this are considered effectively zero.
 * Prevents prompting for cost basis on negligible pre-existing positions.
 */
const DUST_THRESHOLD = 0.1;

/**
 * Scans all markets for non-neutral positions.
 *
 * Two-phase detection:
 * 1. Scan persisted data files (./data/fills-*.json) for known markets
 * 2. Verify on-chain balances for ground truth
 *
 * @param client - Authenticated CLOB client
 * @returns Array of detected positions (empty if all neutral)
 */
export async function detectExistingPositions(
  client: ClobClient
): Promise<DetectedPosition[]> {
  const positions: DetectedPosition[] = [];
  const dataDir = "./data";

  // Check if data directory exists
  if (!fs.existsSync(dataDir)) {
    return positions;
  }

  // Scan all fills-*.json files
  const files = fs.readdirSync(dataDir);
  const fillFiles = files.filter((f) => f.startsWith("fills-") && f.endsWith(".json"));

  if (fillFiles.length === 0) {
    return positions;
  }

  log(`[Position Detection] Scanning ${fillFiles.length} market(s) for positions...`);

  for (const file of fillFiles) {
    const filePath = path.join(dataDir, file);

    try {
      // Load persisted state
      const content = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(content);

      const { conditionId, yesTokenId, noTokenId } = state;

      if (!conditionId || !yesTokenId || !noTokenId) {
        log(`[Position Detection] Skipping ${file}: missing required fields`);
        continue;
      }

      // Get on-chain balances (ground truth)
      const yesBalanceRaw = await getTokenBalance(client, yesTokenId);
      const noBalanceRaw = await getTokenBalance(client, noTokenId);

      const yesBalance = parseFloat(yesBalanceRaw.balance);
      const noBalance = parseFloat(noBalanceRaw.balance);

      // Calculate net exposure
      const netExposure = yesBalance - noBalance;
      const absExposure = Math.abs(netExposure);

      // Ignore dust balances
      if (absExposure <= DUST_THRESHOLD) {
        continue;
      }

      // Extract market question from fills if available
      let marketQuestion: string | undefined;
      if (state.fills && state.fills.length > 0) {
        // Try to get question from first fill's outcome field
        const firstFill = state.fills[0];
        if (firstFill.outcome) {
          marketQuestion = firstFill.outcome;
        }
      }

      positions.push({
        conditionId,
        yesTokenId,
        noTokenId,
        yesBalance,
        noBalance,
        netExposure,
        absExposure,
        marketQuestion,
        source: "persisted",
      });

      log(
        `[Position Detection] Found position in ${conditionId.substring(0, 18)}...: ` +
          `YES=${yesBalance.toFixed(2)}, NO=${noBalance.toFixed(2)}, ` +
          `net=${netExposure >= 0 ? "+" : ""}${netExposure.toFixed(2)}`
      );
    } catch (error) {
      log(`[Position Detection] Error scanning ${file}: ${error}`);
    }
  }

  return positions;
}

/**
 * Finds the market with the largest net exposure (most urgent to resume).
 *
 * @param positions - Array of detected positions
 * @returns Position with largest absolute exposure, or null if empty
 */
export function findPriorityMarket(
  positions: DetectedPosition[]
): DetectedPosition | null {
  if (positions.length === 0) {
    return null;
  }

  // Sort by absolute exposure (descending)
  const sorted = [...positions].sort((a, b) => b.absExposure - a.absExposure);

  return sorted[0];
}

/**
 * Formats a detected position for display.
 *
 * @param position - Position to format
 * @returns Formatted string
 */
export function formatDetectedPosition(position: DetectedPosition): string {
  const { conditionId, yesBalance, noBalance, netExposure, marketQuestion } = position;

  const shortId = conditionId.substring(0, 18);
  const direction = netExposure >= 0 ? "YES" : "NO";
  const exposure = netExposure >= 0 ? `+${netExposure.toFixed(2)}` : netExposure.toFixed(2);

  let output = `  Condition ID: ${shortId}...\n`;
  output += `  Position:     YES=${yesBalance.toFixed(2)}, NO=${noBalance.toFixed(2)}\n`;
  output += `  Net Exposure: ${exposure} ${direction}`;

  if (marketQuestion) {
    output += `\n  Market:       ${marketQuestion}`;
  }

  return output;
}

/**
 * Prints summary of all detected positions.
 *
 * @param positions - Array of positions to display
 */
export function printPositionsSummary(positions: DetectedPosition[]): void {
  if (positions.length === 0) {
    log("[Position Detection] No existing positions detected");
    return;
  }

  console.log("");
  console.log("═".repeat(70));
  console.log("  EXISTING POSITIONS DETECTED");
  console.log("═".repeat(70));

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    console.log("");
    console.log(`Position ${i + 1} of ${positions.length}:`);
    console.log(formatDetectedPosition(position));
  }

  console.log("");
  console.log("═".repeat(70));
  console.log("");
}
