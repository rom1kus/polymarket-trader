/**
 * Types for the market maker orchestrator.
 *
 * The orchestrator automatically switches between markets to maximize
 * liquidity rewards.
 */

import type { RankedMarketByEarnings } from "@/types/rewards.js";
import type { MarketMakerConfig, SessionStats } from "../marketMaker/types.js";

/**
 * State machine phases for the orchestrator.
 */
export type OrchestratorPhase =
  | "startup"       // Initial market discovery
  | "market_making" // Running market maker
  | "merging"       // Merging tokens to USDC
  | "evaluating"    // Re-evaluating markets after neutral
  | "switching"     // Switching to new market
  | "shutdown";     // Graceful shutdown in progress

/**
 * Pending market switch detected by periodic re-evaluation.
 * The switch executes when position becomes neutral.
 */
export interface PendingSwitch {
  /** Target market to switch to */
  targetMarket: RankedMarketByEarnings;

  /** When the better market was detected */
  detectedAt: Date;

  /** Switch decision with earnings comparison */
  decision: SwitchDecision;
}

/**
 * Current state of the orchestrator.
 */
export interface OrchestratorState {
  /** Current phase in the state machine */
  phase: OrchestratorPhase;

  /** Currently active market (null during startup) */
  currentMarket: RankedMarketByEarnings | null;

  /** Current market maker config (null during startup) */
  currentConfig: MarketMakerConfig | null;

  /**
   * Pending switch to a better market.
   * Set by periodic re-evaluation, cleared when switch completes or conditions change.
   * Switch executes when position becomes neutral.
   */
  pendingSwitch: PendingSwitch | null;

  /** Number of market switches this session */
  switchCount: number;

  /** Condition IDs of markets visited this session */
  marketsVisited: string[];

  /** Session start timestamp */
  startTime: Date;

  /** Whether orchestrator is running */
  running: boolean;

  /** Last error message (if any) */
  lastError: string | null;

  /** Cumulative stats across all market maker runs */
  cumulativeStats: SessionStats;
}

/**
 * Decision result from shouldSwitch() evaluation.
 */
export interface SwitchDecision {
  /** Whether we should switch markets */
  shouldSwitch: boolean;

  /** Current market's daily earnings (actual if orders exist, estimated otherwise) */
  currentEarnings: number;

  /** Whether currentEarnings is from actual placed orders (true) or estimated (false) */
  currentIsActual: boolean;

  /** Candidate market's estimated daily earnings */
  candidateEarnings: number;

  /** Improvement percentage (e.g., 0.25 = 25% better) */
  improvement: number;

  /** Human-readable reason for the decision */
  reason: string;
}

/**
 * Result of a single orchestrator cycle.
 */
export interface OrchestratorCycleResult {
  /** Whether the cycle completed successfully */
  success: boolean;

  /** What action was taken */
  action: "started" | "continued" | "switched" | "shutdown" | "error";

  /** Market that was running (if any) */
  market?: RankedMarketByEarnings;

  /** Session stats from the market maker run (if any) */
  stats?: SessionStats;

  /** Error message (if action === "error") */
  error?: string;
}

/**
 * Summary of an orchestrator session (printed on shutdown).
 */
export interface OrchestratorSessionSummary {
  /** Total runtime */
  totalRuntime: number;

  /** Number of market switches */
  switchCount: number;

  /** List of market questions visited */
  marketsVisited: string[];

  /** Total fills across all markets */
  totalFills: number;

  /** Total volume traded (USD) */
  totalVolume: number;

  /** Total merges performed */
  totalMerges: number;

  /** Total tokens merged (shares) */
  totalMerged: number;
}

/**
 * Event emitted by the orchestrator for logging/monitoring.
 */
export type OrchestratorEvent =
  | { type: "started"; market: RankedMarketByEarnings }
  | { type: "neutral_detected"; market: RankedMarketByEarnings }
  | { type: "evaluating"; currentMarket: RankedMarketByEarnings; candidateMarket: RankedMarketByEarnings | null }
  | { type: "switch_decision"; decision: SwitchDecision }
  | { type: "pending_switch_set"; pendingSwitch: PendingSwitch }
  | { type: "pending_switch_cleared"; reason: string }
  | { type: "switching"; from: RankedMarketByEarnings; to: RankedMarketByEarnings }
  | { type: "continuing"; market: RankedMarketByEarnings; reason: string }
  | { type: "error"; error: string; phase: OrchestratorPhase }
  | { type: "shutdown"; summary: OrchestratorSessionSummary };

/**
 * Callback for orchestrator events.
 */
export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;
