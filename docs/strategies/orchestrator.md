# Market Maker Orchestrator

Automatic market selection and switching to maximize liquidity rewards.

## Overview

The orchestrator automates the market maker workflow:

1. **Position detection on startup** - Scans for existing positions to prevent capital fragmentation
2. **Restore liquidations** - Automatically restores markets from `./data/liquidations.json` into liquidation queue
3. **Handle active positions** - Prompts to liquidate other non-neutral positions (or auto-liquidates with `--auto-resume`)
4. **Discover best market** - Finds best new market for active trading (excluding liquidation markets)
5. **Run market maker** - Continuously provides liquidity on active market
6. **Manage liquidations** - Passively exits positions in background on liquidation markets
7. **Periodic re-evaluation** - Checks for better markets every N minutes
8. **Smart switching** - Only switches when position is neutral AND better market exists

This eliminates manual market selection and enables 24/7 operation with automatic optimization,
while preventing capital fragmentation across multiple markets when restarting.

## Quick Start

```bash
# Dry run (default) - see what it would do
npm run orchestrate

# With custom liquidity
npm run orchestrate -- --liquidity 200

# Check for existing positions only (diagnostics)
npm run orchestrate -- --check-positions-only

# Auto-liquidate mode for 24/7 operation
npm run orchestrate -- --auto-resume

# Adjust volatility filtering
npm run orchestrate -- --max-volatility 0.15      # Allow 15% price changes
npm run orchestrate -- --volatility-lookback 30   # 30-minute lookback
npm run orchestrate -- --no-volatility-filter     # Disable filter entirely

# Enable switching (still dry run)
npm run orchestrate -- --enable-switching

# Full live mode (careful!)
npm run orchestrate -- --enable-switching --no-dry-run --auto-resume
```

## How It Works

### State Machine

```
STARTUP
   │
   │ detect existing positions
   ▼
┌──────────────────────────────┐
│ Liquidations in json file?   │
└──────────────────────────────┘
   │              │
   YES            NO
   │              │
   ▼              ▼
RESTORE       CHECK ACTIVE
LIQUIDATIONS   POSITIONS
   │              │
   └──────┬───────┘
          │
          ▼
┌──────────────────────────────┐
│ Other non-neutral positions? │
└──────────────────────────────┘
   │              │
   YES            NO
   │              │
   ▼              ▼
PROMPT/AUTO   FIND BEST MARKET
LIQUIDATE     (excl. liq markets)
   │              │
   └──────┬───────┘
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

**Restart Protection:**
- On startup, the orchestrator scans all `./data/fills-*.json` files for existing positions
- Markets already in `./data/liquidations.json` are automatically restored to the liquidation queue
- Other non-neutral positions (net exposure > 0.1 tokens) are handled based on mode:
  - **Supervised mode** (default): Prompts to liquidate all or exit
  - **24/7 mode** (`--auto-resume`): Automatically queues them for liquidation (passive exit orders)
- This prevents capital fragmentation when restarting unexpectedly (crash, manual stop, etc.)
- **Priority**: Positions with larger net exposure are highlighted as more urgent

**Pending Switch Pattern:**
- Neutral position **enables** switching but doesn't **trigger** it
- Finding a better market **triggers** the pending switch flag
- Switch executes only when BOTH: pending switch exists AND position is neutral

**Why this design?**
- Market maker keeps earning rewards while waiting for neutral
- Liquidation markets exit passively in parallel (no blocking)
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
| `--auto-resume` | false | Auto-liquidate detected non-liquidation positions without prompting (24/7 mode) |
| `--ignore-positions` | false | Force new discovery (dangerous, requires confirmation) |
| `--check-positions-only` | false | Only check and report positions, don't start |
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
- **NegRisk support:** NegRisk markets (multi-outcome markets) are fully supported
  - Can be optionally filtered via `--exclude-negrisk` flag (disabled by default)

## Session Summary

On shutdown, the orchestrator prints a summary:

```
══════════════════════════════════════════════════════════════════════
  SESSION SUMMARY
══════════════════════════════════════════════════════════════════════
  Runtime:        4h 23m 15s
  Markets:        3 visited
  Switches:       2
  Liquidations:   1 completed, 0 active
  Total Fills:    47
  Total Volume:   $2,345.67
  Total Merges:   12
  Total Merged:   156.00 tokens
  Rebalances:     892
  Orders:         1784 placed, 1737 cancelled
══════════════════════════════════════════════════════════════════════
```

## Example Session

### Normal Startup (No Existing Position)

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

[2026-01-19 10:00:01] [Orchestrator] Checking for existing positions...
[2026-01-19 10:00:02] [Orchestrator] No existing positions detected

[2026-01-19 10:00:02] [Orchestrator] Finding best market...
[2026-01-19 10:00:03] [Discovery] Fetch: 45/120 markets, 12 passed filters
[2026-01-19 10:00:05] [Discovery] Using optimized volatility checking (top-first)
[2026-01-19 10:00:05] [Discovery] Ranked 12 markets by earnings, checking volatility on top candidates...
[2026-01-19 10:00:05]   ✅ "Will Bitcoin reach $100k by March 2026?" - 2.3% move (safe)
[2026-01-19 10:00:05] [Discovery] Found safe market after checking 1 candidates (0 filtered)
[2026-01-19 10:00:06] [Discovery] Competition: 12/12 orderbooks

──────────────────────────────────────────────────────────────────────
  SELECTED MARKET
──────────────────────────────────────────────────────────────────────
  Question: Will Bitcoin reach $100k by March 2026?
  Event:    bitcoin-100k-march
  Est. Daily: $1.2345
  Min Size:   20 shares
  Max Spread: 4 cents
──────────────────────────────────────────────────────────────────────

[2026-01-19 10:00:06] [Orchestrator] Starting re-evaluation timer (every 5.0 min)
[2026-01-19 10:00:06] [Orchestrator] Starting market maker for: Will Bitcoin reach $100k?

... market maker running ...
```

### Restart with Existing Position (Supervised Mode)

```
[2026-01-19 10:15:00] [Orchestrator] Initializing client...
[2026-01-19 10:15:01] [Orchestrator] Client initialized
[2026-01-19 10:15:01] [Orchestrator] USDC balance: $500.00

[2026-01-19 10:15:01] [Orchestrator] Checking for existing positions...
[2026-01-19 10:15:02] [Position Detection] Scanning 2 market(s) for positions...
[2026-01-19 10:15:02] [Position Detection] Found position in 0xabc123...: YES=35.50, NO=18.20, net=+17.30
[2026-01-19 10:15:02] [Position Detection] Found position in 0xdef456... (marked as liquidation)

[2026-01-19 10:15:02] [Orchestrator] Restoring 1 liquidation(s) from previous session...
[2026-01-19 10:15:03] [Orchestrator] ✓ Liquidation reconstructed for 0xdef456...

[2026-01-19 10:15:03] [Orchestrator] Found 1 non-liquidation position(s)

What would you like to do with the detected position(s)?
1. Liquidate all positions (queue them for passive exit)
2. Exit (manually handle positions)

Choice: 1

[2026-01-19 10:15:10] [Orchestrator] User chose to liquidate all positions
[2026-01-19 10:15:11] [Orchestrator] Reconstructing liquidation for 0xabc123...
[2026-01-19 10:15:12] [Orchestrator] ✓ 1 position(s) queued for liquidation

[2026-01-19 10:15:12] [Orchestrator] Finding best market for active trading...
[2026-01-19 10:15:15] [Orchestrator] Selected: Will ETH flip BTC?
[2026-01-19 10:15:15] [Orchestrator] Starting liquidation management timer (every 30s)
[2026-01-19 10:15:15] [Orchestrator] Starting market maker for: Will ETH flip BTC?

... market maker runs on ETH market, liquidations exit passively in background ...
```

### Restart with Auto-Liquidate (24/7 Mode)

```
[2026-01-19 10:20:00] [Orchestrator] Initializing client...
[2026-01-19 10:20:01] [Orchestrator] Client initialized
[2026-01-19 10:20:01] [Orchestrator] USDC balance: $500.00

[2026-01-19 10:20:01] [Orchestrator] Checking for existing positions...
[2026-01-19 10:20:02] [Position Detection] Scanning 1 market(s) for positions...
[2026-01-19 10:20:02] [Position Detection] Found position in 0xabc123...: YES=35.50, NO=18.20, net=+17.30
[2026-01-19 10:20:02] [Orchestrator] Auto-liquidating 1 position(s) (--auto-resume enabled)
[2026-01-19 10:20:03] [Orchestrator] Reconstructing liquidation for 0xabc123...
[2026-01-19 10:20:04] [Orchestrator] ✓ 1 position(s) queued for liquidation

[2026-01-19 10:20:04] [Orchestrator] Finding best market for active trading...
[2026-01-19 10:20:07] [Orchestrator] Selected: Will ETH flip BTC?
[2026-01-19 10:20:07] [Orchestrator] Starting liquidation management timer (every 30s)
[2026-01-19 10:20:07] [Orchestrator] Starting market maker for: Will ETH flip BTC?

... market maker continues automatically on new market, old position exits passively ...
```

### Active Session (Market Evaluation & Switching)

```
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

### Restart Scenarios

**"Existing position detected" prompt on startup**

The orchestrator found a non-neutral position from a previous session. This is **normal and safe**.

Options:
- Choose "Liquidate all" to queue them for passive liquidation (recommended - lets you start earning on a new market immediately)
- Choose "Exit" to manually handle positions before starting
- Use `--auto-resume` flag to skip prompt in 24/7 mode (auto-liquidates)

**Want to check positions without starting?**

```bash
npm run orchestrate -- --check-positions-only
```

This scans for positions and reports them without starting the orchestrator.

**Need to force a new market despite existing position?**

```bash
npm run orchestrate -- --ignore-positions
```

⚠️ **WARNING:** This will prompt for confirmation with the exact phrase `yes-ignore-positions`.
Only use this if you understand the risk of having capital locked in multiple markets.

**Lost track of which markets you're in?**

Check the `./data/` directory for `fills-*.json` files and `liquidations.json`. Each fills file corresponds to a market
where you have (or had) positions. The `liquidations.json` file lists markets currently in passive liquidation mode.

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
├── index.ts        # Main orchestrator loop, CLI entry point, dual-market operation
├── config.ts       # Configuration types and defaults
├── types.ts        # TypeScript types (state, events, decisions, liquidation)
└── liquidation.ts  # Liquidation management for passive position exit
```

**Related utilities:**
- `src/utils/liquidationState.ts` - Persistence for `./data/liquidations.json`
- `src/utils/orchestratorState.ts` - Position detection on startup

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
