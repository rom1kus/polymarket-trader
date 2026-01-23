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
import type { VolatilityThresholds } from "../../types/polymarket.js";

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

  /**
   * Volatility filtering configuration.
   * If enabled, markets with excessive price movement are filtered out
   * during discovery to prevent adverse selection.
   * Set to undefined to disable volatility filtering.
   * 
   * Default: Conservative settings (10% max change over 1 hour)
   * - Prevents entering markets like the Zelenskyy WEF incident (31% move)
   * - Can be relaxed with --max-volatility flag if needed
   * 
   * @default { maxPriceChangePercent: 0.10, lookbackMinutes: 60 }
   */
  volatilityFilter?: VolatilityThresholds;

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

  // =========================================================================
  // Position Resume (Restart Protection)
  // =========================================================================

  /**
   * Automatically resume existing positions on restart without prompting.
   * When false (default), prompts user to confirm resuming detected positions.
   * Set to true for fully automated 24/7 operation.
   * @default false
   */
  autoResume: boolean;

  /**
   * Ignore existing positions and force new market discovery on startup.
   * DANGEROUS: May fragment capital across multiple markets.
   * Requires manual confirmation via prompt.
   * @default false
   */
  ignorePositions: boolean;

  /**
   * Only check for positions and report, don't start orchestrator.
   * Useful for diagnostics.
   * @default false
   */
  checkPositionsOnly: boolean;

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

  // Volatility filtering (enabled by default per FINDINGS.md recommendations)
  // Conservative settings to prevent adverse selection
  volatilityFilter: {
    maxPriceChangePercent: 0.10, // 10% max price change (conservative)
    lookbackMinutes: 60, // Over 1-hour window
  },

  // Market maker settings
  orderSize: 20,
  spreadPercent: 0.5,
  positionLimits: DEFAULT_POSITION_LIMITS,
  webSocket: DEFAULT_WEBSOCKET_PARAMS,
  merge: DEFAULT_MERGE_CONFIG,

  // Features & safety (conservative defaults)
  enableSwitching: false, // Log only by default
  dryRun: true, // No real orders by default

  // Position resume (conservative defaults)
  autoResume: false, // Prompt user by default
  ignorePositions: false, // Always check for positions
  checkPositionsOnly: false, // Normal operation
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
    volatilityFilter:
      overrides?.volatilityFilter !== undefined
        ? overrides.volatilityFilter
        : DEFAULT_ORCHESTRATOR_CONFIG.volatilityFilter,
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
 * - --max-volatility <number>: Max price change % threshold (e.g., 0.15 for 15%)
  * - --volatility-lookback <minutes>: Volatility lookback window in minutes (default: 60)
 * - --no-volatility-filter: Disable volatility filtering entirely
 * - --enable-switching: Enable actual market switching
 * - --no-dry-run: Disable dry run (place real orders)
 * - --auto-resume: Automatically resume positions without prompting (for 24/7 mode)
 * - --ignore-positions: Force new market discovery even with open positions (dangerous)
 * - --check-positions-only: Only check and report positions, don't start
 *
 * @param args - Command-line arguments (typically process.argv.slice(2))
 * @returns Partial config with parsed values
 */
export function parseOrchestratorArgs(args: string[]): Partial<OrchestratorConfig> {
  const config: Partial<OrchestratorConfig> = {};
  let volatilityConfig: Partial<VolatilityThresholds> = {};
  let disableVolatilityFilter = false;

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

      case "--max-volatility":
        if (nextArg) {
          volatilityConfig.maxPriceChangePercent = parseFloat(nextArg);
          i++;
        }
        break;

      case "--volatility-lookback":
        if (nextArg) {
          volatilityConfig.lookbackMinutes = parseFloat(nextArg);
          i++;
        }
        break;

      case "--no-volatility-filter":
        disableVolatilityFilter = true;
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

      case "--auto-resume":
        config.autoResume = true;
        break;

      case "--ignore-positions":
        config.ignorePositions = true;
        break;

      case "--check-positions-only":
        config.checkPositionsOnly = true;
        break;
    }
  }

  // Apply volatility config if specified
  if (disableVolatilityFilter) {
    config.volatilityFilter = undefined;
  } else if (
    volatilityConfig.maxPriceChangePercent !== undefined ||
    volatilityConfig.lookbackMinutes !== undefined
  ) {
    config.volatilityFilter = {
      maxPriceChangePercent:
        volatilityConfig.maxPriceChangePercent ??
        DEFAULT_ORCHESTRATOR_CONFIG.volatilityFilter!.maxPriceChangePercent,
      lookbackMinutes:
        volatilityConfig.lookbackMinutes ??
        DEFAULT_ORCHESTRATOR_CONFIG.volatilityFilter!.lookbackMinutes,
    };
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
