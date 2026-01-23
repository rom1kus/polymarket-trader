# Market Maker Orchestrator

Automatic market selection and switching to maximize liquidity rewards.

## Overview

The orchestrator automates the market maker workflow:

1. **Find best market** - Ranks all eligible markets by earning potential
2. **Run market maker** - Continuously provides liquidity
3. **Periodic re-evaluation** - Checks for better markets every N minutes
4. **Smart switching** - Only switches when position is neutral AND better market exists

This eliminates manual market selection and enables 24/7 operation with automatic optimization.

## Quick Start

```bash
# Dry run (default) - see what it would do
npm run orchestrate

# With custom liquidity
npm run orchestrate -- --liquidity 200

# Adjust volatility filtering
npm run orchestrate -- --max-volatility 0.15      # Allow 15% price changes
npm run orchestrate -- --volatility-lookback 30   # 30-minute lookback
npm run orchestrate -- --no-volatility-filter     # Disable filter entirely

# Enable switching (still dry run)
npm run orchestrate -- --enable-switching

# Full live mode (careful!)
npm run orchestrate -- --enable-switching --no-dry-run
```

## How It Works

### State Machine

```
STARTUP
   │
   │ findBestMarket()
   ▼
MARKET_MAKING ◄──────────────────────────────┐
   │                                          │
   ├─── [periodic timer] ─────┐               │
   │    every N minutes       │               │
   │                          ▼               │
   │                   re-evaluate markets    │
   │                          │               │
   │                   if better market:      │
   │                   set pendingSwitch      │
   │                          │               │
   ├─── [fills occur] ────────┤               │
   │                          │               │
   │    check onCheckPendingSwitch            │
   │                          │               │
   │    if pendingSwitch && neutral:          │
   │                          │               │
   ▼                          ▼               │
SWITCHING ───────────────────────────────────►┘
   │
   │ switch to new market
   │ clear pendingSwitch
   │
   └──► MARKET_MAKING (new market)
```

### Key Concepts

**Pending Switch Pattern:**
- Neutral position **enables** switching but doesn't **trigger** it
- Finding a better market **triggers** the pending switch flag
- Switch executes only when BOTH: pending switch exists AND position is neutral

**Why this design?**
- Market maker keeps earning rewards while waiting for neutral
- No forced liquidation or market crossing
- Natural position unwind through normal trading

### Switching Logic

The orchestrator only switches markets when:

1. **Better market exists** - Candidate earnings > current × (1 + threshold)
2. **Position is neutral** - Net exposure is zero (YES tokens = NO tokens = 0, or merged)
3. **Switching enabled** - `--enable-switching` flag is set

Example with 20% threshold:
- Current market: $0.50/day estimated
- Candidate market: $0.65/day estimated
- Improvement: 30% > 20% threshold
- Decision: **SWITCH** (when neutral)

## Configuration

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--liquidity <n>` | 100 | Liquidity amount in USD for market evaluation |
| `--threshold <n>` | 0.2 | Min improvement to switch (0.2 = 20%) |
| `--re-evaluate-interval <n>` | 5 | Minutes between market checks |
| `--order-size <n>` | 20 | Order size in shares |
| `--spread <n>` | 0.5 | Spread as fraction of maxSpread (0-1) |
| `--max-volatility <n>` | 0.10 | Max price change % threshold (0.10 = 10%) |
| `--volatility-lookback <n>` | 60 | Volatility lookback window in minutes |
| `--no-volatility-filter` | - | Disable volatility filtering entirely |
| `--enable-switching` | false | Enable automatic market switching |
| `--no-dry-run` | false | Place real orders |
| `--dry-run` | true | Simulate orders (default) |

### Programmatic Configuration

```typescript
import { createOrchestratorConfig, runOrchestrator } from "@/strategies/orchestrator";

const config = createOrchestratorConfig({
  liquidity: 200,
  minEarningsImprovement: 0.15, // 15% threshold
  reEvaluateIntervalMs: 10 * 60 * 1000, // 10 minutes
  orderSize: 25,
  spreadPercent: 0.4,
  enableSwitching: true,
  dryRun: false,
});

await runOrchestrator(config);
```

## Safety Features

### Default Safe Mode

The orchestrator starts with conservative defaults:
- `dryRun: true` - No real orders placed
- `enableSwitching: false` - Only logs what it would do

### Switching Safeguards

1. **Threshold protection** - Only switch if improvement exceeds threshold (default 20%)
2. **Neutral required** - Never switches with open position
3. **Re-evaluation clears** - Pending switch clears if conditions change
4. **Graceful shutdown** - Ctrl+C finishes current cycle cleanly

### Position Protection

The underlying market maker has:
- Position limits (blocks one side when exceeded)
- Auto-merge (converts neutral positions back to USDC)
- Fill tracking with P&L calculation

## Market Discovery

The orchestrator uses the same ranking algorithm as `npm run findBestMarkets`:

```
Score = estimatedDailyEarnings = (rewardsDaily / competition) × yourQScore
```

Where:
- `rewardsDaily` - Daily reward pool for the market
- `competition` - Total Q score from all liquidity providers
- `yourQScore` - Your expected score based on liquidity and spread

Markets are filtered by:
- Active reward program
- Compatible with your liquidity amount (minSize)
- Binary markets (YES/NO outcomes)
- **Volatility filtering (default enabled):** Markets with excessive price movement are filtered out to prevent adverse selection
  - Default: >10% price change over 60-minute window (conservative)
  - Configurable via `--max-volatility` and `--volatility-lookback` flags
  - Can be disabled with `--no-volatility-filter`
  - Uses optimized top-first checking (only checks top-ranked candidates, not all markets upfront for performance)
- **NegRisk exclusion:** NegRisk markets (multi-outcome markets) are automatically excluded due to signature compatibility issues (requires testing and fixing)

## Session Summary

On shutdown, the orchestrator prints a summary:

```
══════════════════════════════════════════════════════════════════════
  SESSION SUMMARY
══════════════════════════════════════════════════════════════════════
  Runtime:        4h 23m 15s
  Markets:        3 visited
  Switches:       2
  Total Fills:    47
  Total Volume:   $2,345.67
  Total Merges:   12
  Total Merged:   156.00 tokens
  Rebalances:     892
  Orders:         1784 placed, 1737 cancelled
══════════════════════════════════════════════════════════════════════
```

## Example Session

```
══════════════════════════════════════════════════════════════════════
  MARKET MAKER ORCHESTRATOR
══════════════════════════════════════════════════════════════════════

  Configuration:
    Liquidity:         $200
    Switch Threshold:  20% improvement
    Re-evaluate:       Every 5.0 minutes
    Order Size:        25 shares
    Spread:            50% of maxSpread

  Mode:
    Dry Run:           NO (live orders)
    Switching:         ENABLED

══════════════════════════════════════════════════════════════════════

[2026-01-19 10:00:00] [Orchestrator] Initializing client...
[2026-01-19 10:00:01] [Orchestrator] Client initialized
[2026-01-19 10:00:01] [Orchestrator] USDC balance: $500.00

[2026-01-19 10:00:01] [Orchestrator] Finding best market...
[2026-01-19 10:00:02] [Discovery] Fetch: 45/120 markets, 12 passed filters
[2026-01-19 10:00:04] [Discovery] Using optimized volatility checking (top-first)
[2026-01-19 10:00:04] [Discovery] Ranked 12 markets by earnings, checking volatility on top candidates...
[2026-01-19 10:00:04]   ✅ "Will Bitcoin reach $100k by March 2026?" - 2.3% move (safe)
[2026-01-19 10:00:04] [Discovery] Found safe market after checking 1 candidates (0 filtered)
[2026-01-19 10:00:05] [Discovery] Competition: 12/12 orderbooks

──────────────────────────────────────────────────────────────────────
  SELECTED MARKET
──────────────────────────────────────────────────────────────────────
  Question: Will Bitcoin reach $100k by March 2026?
  Event:    bitcoin-100k-march
  Est. Daily: $1.2345
  Min Size:   20 shares
  Max Spread: 4 cents
──────────────────────────────────────────────────────────────────────

[2026-01-19 10:00:05] [Orchestrator] Starting re-evaluation timer (every 5.0 min)

[2026-01-19 10:00:05] [Orchestrator] Starting market maker for: Will Bitcoin reach $100k?

... market maker running ...

[2026-01-19 10:05:05] [Orchestrator] Periodic re-evaluation...
[2026-01-19 10:05:08] [Orchestrator] Current market is still optimal

... more trading ...

[2026-01-19 10:10:05] [Orchestrator] Periodic re-evaluation...
[2026-01-19 10:10:08] [Orchestrator] Found better market: Will ETH flip BTC?
[2026-01-19 10:10:08] [Orchestrator] Pending switch set - will execute when neutral

──────────────────────────────────────────────────────────────────────
  SWITCH EVALUATION
──────────────────────────────────────────────────────────────────────
  Current earnings:   $1.2345/day
  Candidate earnings: $1.5678/day
  Improvement:        27.0%
  Decision:           SWITCH
  Reason:             27.0% improvement (threshold: 20%)
──────────────────────────────────────────────────────────────────────

... waiting for neutral position ...

[2026-01-19 10:15:30] Fill: BUY 25 YES @ $0.4800
[2026-01-19 10:15:30]   Position: YES=0, NO=0 | Net: 0.00
[2026-01-19 10:15:30] [Orchestrator] Neutral position detected
[2026-01-19 10:15:30] [Orchestrator] Market maker exited: neutral
[2026-01-19 10:15:30] [Orchestrator] Executing pending switch to: Will ETH flip BTC?

... now trading new market ...
```

## Troubleshooting

### "No eligible markets found"

The orchestrator couldn't find markets matching your criteria. Try:
- Increasing `--liquidity` (some markets have high minSize)
- Check if Polymarket rewards are active
- Run `npm run findBestMarkets` to see available markets

### "Insufficient USDC"

You need at least `2 × orderSize` USDC to start. The orchestrator checks balance on startup.

### Stuck in one market

If `--enable-switching` is set but no switches occur:
- Check the threshold - default 20% improvement is significant
- Markets may not have a clear winner
- Position may never reach neutral (inventory skewing helps - future feature)

### WebSocket disconnections

The underlying market maker has auto-reconnect. If persistent:
- Check network connectivity
- Polymarket WebSocket may be having issues

## Architecture

### Files

```
src/strategies/orchestrator/
├── index.ts    # Main orchestrator loop, CLI entry point
├── config.ts   # Configuration types and defaults
└── types.ts    # TypeScript types (state, events, decisions)
```

### Dependencies

The orchestrator uses:
- `@/utils/marketDiscovery.ts` - Finding and ranking markets
- `@/utils/marketConfigGenerator.ts` - Creating MarketParams from ranked markets
- `@/strategies/marketMaker/` - Underlying market maker

### Integration Points

The market maker is extended with orchestrator hooks:

```typescript
interface OrchestratableMarketMakerConfig extends MarketMakerConfig {
  // Called when neutral position detected (for logging)
  onNeutralPosition?: (position: PositionSnapshot) => void;

  // Called after fills - returns true if should stop
  onCheckPendingSwitch?: (position: PositionSnapshot) => boolean;
}
```

## See Also

- [Market Maker Documentation](./market-maker.md) - Underlying market maker details
- [Market Maker Roadmap](./market-maker-roadmap.md) - Future enhancements
- `npm run findBestMarkets` - Manual market discovery
- `npm run selectMarket` - Manual config generation
