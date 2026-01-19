/**
 * Configuration for the market maker orchestrator.
 *
 * The orchestrator automatically finds and switches between markets
 * to maximize liquidity rewards.
 */

import type { MergeConfig, WebSocketConfig, PositionLimitsConfig } from "../marketMaker/types.js";
import {
  DEFAULT_MERGE_CONFIG,
  DEFAULT_WEBSOCKET_PARAMS,
  DEFAULT_POSITION_LIMITS,
} from "../marketMaker/config.js";

/**
 * Orchestrator configuration options.
 */
export interface OrchestratorConfig {
  // =========================================================================
  // Market Selection
  // =========================================================================

  /**
   * Liquidity amount in USD for market evaluation.
   * This is the amount you plan to provide to each market.
   * Used to calculate expected earnings and filter compatible markets.
   * @default 100
   */
  liquidity: number;

  /**
   * Minimum earnings improvement required to switch markets.
   * E.g., 0.2 = only switch if new market offers 20% better earnings.
   * Higher values reduce switching frequency (less gas/slippage).
   * @default 0.2
   */
  minEarningsImprovement: number;

  /**
   * How often to re-evaluate markets for better opportunities (in milliseconds).
   * The orchestrator checks periodically if a better market exists.
   * If found, it sets a pending switch that executes when position becomes neutral.
   * @default 300000 (5 minutes)
   */
  reEvaluateIntervalMs: number;

  // =========================================================================
  // Market Maker Settings (passed to each market maker instance)
  // =========================================================================

  /**
   * Order size in shares.
   * This is the size of each BUY order on both YES and NO sides.
   * @default 20
   */
  orderSize: number;

  /**
   * Spread as percentage of market's maxSpread (0-1).
   * E.g., 0.5 = quote at 50% of max spread from midpoint.
   * Lower values = closer to midpoint = more likely to fill.
   * @default 0.5
   */
  spreadPercent: number;

  /**
   * Position limits for risk management.
   */
  positionLimits: PositionLimitsConfig;

  /**
   * WebSocket configuration for real-time price updates.
   */
  webSocket: WebSocketConfig;

  /**
   * Merge configuration for automatic neutral position consolidation.
   */
  merge: MergeConfig;

  // =========================================================================
  // Features & Safety
  // =========================================================================

  /**
   * Actually switch markets when better ones are found.
   * When false, the orchestrator only logs what it would do (safe for testing).
   * @default false
   */
  enableSwitching: boolean;

  /**
   * Dry run mode - simulate orders without placing them.
   * Applies to the underlying market maker.
   * @default true
   */
  dryRun: boolean;

  /**
   * Event handler for orchestrator events (logging, monitoring).
   */
  onEvent?: (event: import("./types.js").OrchestratorEvent) => void;
}

/**
 * Default orchestrator configuration.
 * Optimized for safety - dry run mode with switching disabled.
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  // Market selection
  liquidity: 100,
  minEarningsImprovement: 0.2, // 20% improvement required to switch
  reEvaluateIntervalMs: 5 * 60 * 1000, // 5 minutes

  // Market maker settings
  orderSize: 20,
  spreadPercent: 0.5,
  positionLimits: DEFAULT_POSITION_LIMITS,
  webSocket: DEFAULT_WEBSOCKET_PARAMS,
  merge: DEFAULT_MERGE_CONFIG,

  // Features & safety (conservative defaults)
  enableSwitching: false, // Log only by default
  dryRun: true, // No real orders by default
};

/**
 * Creates an orchestrator configuration with defaults.
 *
 * @param overrides - Partial config to override defaults
 * @returns Complete orchestrator configuration
 *
 * @example
 * const config = createOrchestratorConfig({
 *   liquidity: 200,
 *   enableSwitching: true,
 *   dryRun: false,
 * });
 */
export function createOrchestratorConfig(
  overrides?: Partial<OrchestratorConfig>
): OrchestratorConfig {
  return {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    ...overrides,
    positionLimits: {
      ...DEFAULT_ORCHESTRATOR_CONFIG.positionLimits,
      ...overrides?.positionLimits,
    },
    webSocket: {
      ...DEFAULT_ORCHESTRATOR_CONFIG.webSocket,
      ...overrides?.webSocket,
    },
    merge: {
      ...DEFAULT_ORCHESTRATOR_CONFIG.merge,
      ...overrides?.merge,
    },
  };
}

/**
 * Parses command-line arguments into orchestrator config overrides.
 *
 * Supported flags:
 * - --liquidity <number>: Liquidity amount in USD
 * - --threshold <number>: Minimum earnings improvement (e.g., 0.15 for 15%)
 * - --re-evaluate-interval <minutes>: How often to check for better markets (default: 5)
 * - --order-size <number>: Order size in shares
 * - --spread <number>: Spread percent (0-1)
 * - --enable-switching: Enable actual market switching
 * - --no-dry-run: Disable dry run (place real orders)
 *
 * @param args - Command-line arguments (typically process.argv.slice(2))
 * @returns Partial config with parsed values
 */
export function parseOrchestratorArgs(args: string[]): Partial<OrchestratorConfig> {
  const config: Partial<OrchestratorConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--liquidity":
        if (nextArg) {
          config.liquidity = parseFloat(nextArg);
          i++;
        }
        break;

      case "--threshold":
        if (nextArg) {
          config.minEarningsImprovement = parseFloat(nextArg);
          i++;
        }
        break;

      case "--re-evaluate-interval":
        if (nextArg) {
          // Parse as minutes, convert to milliseconds
          config.reEvaluateIntervalMs = parseFloat(nextArg) * 60 * 1000;
          i++;
        }
        break;

      case "--order-size":
        if (nextArg) {
          config.orderSize = parseFloat(nextArg);
          i++;
        }
        break;

      case "--spread":
        if (nextArg) {
          config.spreadPercent = parseFloat(nextArg);
          i++;
        }
        break;

      case "--enable-switching":
        config.enableSwitching = true;
        break;

      case "--no-dry-run":
        config.dryRun = false;
        break;

      case "--dry-run":
        config.dryRun = true;
        break;
    }
  }

  return config;
}

/**
 * Validates orchestrator configuration.
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateOrchestratorConfig(config: OrchestratorConfig): void {
  if (config.liquidity <= 0) {
    throw new Error("Liquidity must be positive");
  }

  if (config.minEarningsImprovement < 0) {
    throw new Error("minEarningsImprovement must be non-negative");
  }

  if (config.reEvaluateIntervalMs < 30000) {
    throw new Error("reEvaluateIntervalMs must be at least 30 seconds (30000ms)");
  }

  if (config.orderSize <= 0) {
    throw new Error("orderSize must be positive");
  }

  if (config.spreadPercent <= 0 || config.spreadPercent > 1) {
    throw new Error("spreadPercent must be between 0 and 1");
  }

  // Warn about dangerous configurations
  if (!config.dryRun && config.enableSwitching) {
    console.warn(
      "\n⚠️  WARNING: Running with LIVE orders and switching enabled!\n" +
      "   This will place real orders and automatically switch markets.\n" +
      "   Make sure you understand the risks.\n"
    );
  }
}
