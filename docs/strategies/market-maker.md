# Market Maker Strategy

A market maker bot that provides two-sided liquidity around the current midpoint to earn Polymarket liquidity rewards.

## Overview

The market maker strategy places BUY orders on both YES and NO tokens at calculated spreads from the market midpoint. By maintaining two-sided liquidity within reward-eligible parameters, the bot earns liquidity rewards based on Polymarket's quadratic scoring formula.

### USDC-Only Mode

The strategy operates in **USDC-only mode** - it places BUY orders on both YES and NO tokens rather than holding tokens upfront. This is economically equivalent to the traditional BUY YES + SELL YES approach but more capital efficient.

**Why this works:** Since Polymarket's YES and NO orderbooks are mirrored (YES price + NO price ≈ 1):
- BUY NO @ $0.40 is equivalent to SELL YES @ $0.60
- Both provide the same liquidity and earn the same rewards
- No need to pre-split USDC into YES+NO tokens via CTF

**IMPORTANT - CLOB Internal Conversion:**
The Polymarket CLOB only maintains order books for YES tokens. When you place a NO order:
- `BUY NO @ $0.58` is internally converted to `SELL YES @ $0.42` on the orderbook
- When filled, WebSocket events report the YES token's `asset_id`
- The `outcome` field in trade events contains the actual outcome ("Yes" or "No")
- Position tracking uses `outcome` to correctly attribute fills to YES or NO tokens

**Benefits:**
- Just hold USDC, no need to pre-split into YES+NO tokens
- **Auto-merge** automatically converts neutral positions back to USDC
- Easier on/off boarding to markets
- Same P&L profile as traditional market making

### Auto-Merge Feature

When the bot runs for a while, it can accumulate both YES and NO tokens. If you have `YES > 0` AND `NO > 0`, you have a **neutral position** - tokens that are market-neutral and lock up USDC that could be used for trading.

The **auto-merge** feature automatically:
1. Detects when you have both YES and NO tokens
2. Merges them back into USDC via the CTF contract
3. Frees up locked capital for continued trading

**Example:**
```
Before merge:  YES=15, NO=12, USDC=$50
               Neutral position = min(15, 12) = 12
               
After merge:   YES=3, NO=0, USDC=$62
               Freed $12 USDC for trading!
```

**Configuration:**
```typescript
merge: {
  enabled: true,      // Enable automatic merging (default: true)
  minMergeAmount: 0,  // Merge any neutral position (default: 0)
}
```

**P&L Economics:** When tokens are merged, the cost basis is adjusted proportionally to maintain accurate P&L tracking.

## Quick Start

```bash
# 1. Find the best markets for liquidity rewards
npm run findBestMarkets                   # Shows top 20 markets ranked by attractiveness
npm run findBestMarkets -- --details 1    # Show details for the #1 ranked market

# 2. Generate config from an event
npm run selectMarket -- <event-slug>          # List available markets
npm run selectMarket -- <event-slug> 0        # Generate config for market 0

# 3. Copy the output to src/strategies/marketMaker/config.ts

# 4. Run the bot (starts in dry-run mode by default)
npm run marketMaker

# 5. When ready for live trading, set dryRun: false in config.ts

# 6. Press Ctrl+C to stop (gracefully cancels orders)
```

## How It Works

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            MARKET MAKER STARTUP                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────────────┐
│  VALIDATE CONFIG   │───▶│   PRINT BANNER     │───▶│   INITIALIZE CLIENT        │
│  - Token IDs set?  │    │   (show settings)  │    │   - Create auth client     │
│  - Size >= min?    │    │                    │    │   - Set up wallet/signer   │
│  - Spread valid?   │    │                    │    │                            │
└────────────────────┘    └────────────────────┘    └────────────────────────────┘
                                                                  │
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            PRE-FLIGHT CHECKS                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │                        CHECK USDC BALANCE                                 │  │
│   │   - Minimum: 2x orderSize (to place both YES and NO orders)              │  │
│   │   - Warning if < 5x orderSize (low buffer for multiple cycles)           │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   If USDC insufficient → EXIT with error                                         │
│   If USDC sufficient → Continue to main loop                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    MAIN LOOP (WebSocket Mode - Default)                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │                        WebSocket Connection                               │  │
│   │   Connect to: wss://ws-subscriptions-clob.polymarket.com/ws/market       │  │
│   │   Subscribe to: YES token ID with custom_feature_enabled: true           │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                           │
│                                      ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  On Midpoint Update (from WebSocket)                                      │  │
│   │  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────────┐   │  │
│   │  │ TRAILING DEBOUNCE│───▶│  AUTO-MERGE      │───▶│ REBALANCE NEEDED? │   │  │
│   │  │ (wait 50ms for   │    │  Check neutral   │    │ - Threshold check │   │  │
│   │  │  price to settle)│    │  position, merge │    │ - Has quotes?     │   │  │
│   │  │                  │    │  if > 0 tokens   │    │ - Merged tokens?  │   │  │
│   │  └──────────────────┘    └──────────────────┘    └───────────────────┘   │  │
│   │                                                           │               │  │
│   │                                                           ▼               │  │
│   │                                                  ┌───────────────────┐   │  │
│   │                                                  │    REBALANCE      │   │  │
│   │                                                  │ 1. Cancel old     │   │  │
│   │                                                  │ 2. Place new      │   │  │
│   │                                                  └───────────────────┘   │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  Fallback: If WebSocket disconnects → Poll REST API every 30s            │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   On SIGINT/SIGTERM: Disconnect WebSocket, cancel all orders, exit gracefully   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Quote Generation

The bot generates BUY quotes on both YES and NO tokens symmetrically around the midpoint:

```
            Max Spread (e.g., 3c)                 Max Spread (e.g., 3c)
        ◄───────────────────────►             ◄───────────────────────►

        ┌─────────────────────────────────────────────────────────────┐
        │                                                             │
   $0.47│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                                           │ Not eligible
        │                 ▓                                           │ (outside max spread)
        │                 ▓                                           │
   $0.48│                 ├─── BUY YES @ $0.485 ───────────┐          │
        │                 │    (1.5c from mid)             │          │ ◄── Reward eligible
        │                 │                                │          │     zone
   $0.49│                 │                                │          │
        │                 │                                │          │
   $0.50│─────────────────┼────── MIDPOINT ────────────────┼──────────│
        │                 │                                │          │
   $0.51│                 │                                │          │
        │                 │    BUY NO @ $0.485             │          │
   $0.52│                 └─── (= SELL YES @ $0.515) ──────┤          │ ◄── Reward eligible
        │                      (1.5c from mid)             │          │     zone
   $0.53│                                                ▓            │
        │                                           ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ Not eligible
        │                                                             │
        └─────────────────────────────────────────────────────────────┘

        │◄────── spreadPercent × maxSpread ──────►│
                     (e.g., 50% × 3c = 1.5c)
```

**Price Mirroring:**
- YES quote: BUY YES @ (midpoint - offset)
- NO quote: BUY NO @ (1 - (midpoint + offset))

Example with midpoint = 0.50, offset = 0.015 (1.5c):
- BUY YES @ 0.485
- BUY NO @ 1 - 0.515 = 0.485

Both orders are placed at 0.485 but on different tokens!

### Rebalance Logic

```
                    ┌─────────────────────────────┐
                    │  Current Midpoint: $0.52    │
                    └─────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │ Last Quoted Midpoint: $0.50 │
                    └─────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │ Difference = |0.52 - 0.50|  │
                    │            = 0.02 (2 cents) │
                    └─────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │ Threshold = 0.005 (0.5c)    │
                    └─────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │ 2c > 0.5c?  YES             │
                    │ ──────────────────────────  │
                    │ REBALANCE REQUIRED!         │
                    └─────────────────────────────┘
```

## Reward System

### Quadratic Scoring Formula

Polymarket uses a quadratic formula to calculate reward scores:

```
S(v, s) = ((v - s) / v)² × size
```

Where:
- `v` = max spread from midpoint (in cents, from `rewardsMaxSpread`)
- `s` = your order's spread from midpoint (in cents)
- `size` = order size in shares

### Score Examples

| Spread from Mid | Max Spread | Size | Score | % of Max |
|-----------------|------------|------|-------|----------|
| 0.5 cents       | 3 cents    | 100  | 69.4  | 69.4%    |
| 1.0 cents       | 3 cents    | 100  | 44.4  | 44.4%    |
| 1.5 cents       | 3 cents    | 100  | 25.0  | 25.0%    |
| 2.0 cents       | 3 cents    | 100  | 11.1  | 11.1%    |
| 2.5 cents       | 3 cents    | 100  | 2.8   | 2.8%     |
| 3.0 cents       | 3 cents    | 100  | 0     | 0%       |

**Key insight**: Orders closer to midpoint earn exponentially more rewards!

```
Score
  │
  │▓▓
  │▓▓▓▓
  │▓▓▓▓▓▓
  │▓▓▓▓▓▓▓▓▓
  │▓▓▓▓▓▓▓▓▓▓▓▓▓
  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  └──────────────────────────► Spread from midpoint
    0c   0.5c   1c   1.5c  2c  2.5c  3c (max)
```

### Two-Sided Liquidity Rules

| Midpoint Range | Two-Sided Required? | Single-Sided Penalty |
|----------------|---------------------|----------------------|
| 0.10 - 0.90    | No (but penalized)  | Score / 3            |
| < 0.10 or > 0.90 | Yes (required)    | Score = 0            |

```
    0.00          0.10                            0.90          1.00
      │             │                              │             │
      │  STRICT     │     FLEXIBLE ZONE            │   STRICT    │
      │  2-SIDED    │   (single-sided with 3x      │   2-SIDED   │
      │  REQUIRED   │    penalty allowed)          │   REQUIRED  │
      │             │                              │             │
      ▼             ▼                              ▼             ▼
      ├─────────────┼──────────────────────────────┼─────────────┤
```

## Configuration

### File: `src/strategies/marketMaker/config.ts`

```typescript
export const MARKET_CONFIG: MarketParams = {
  // YES token ID (first outcome)
  yesTokenId: "75710865397670382800823548470978...",
  
  // NO token ID (second outcome)  
  noTokenId: "10842869574567893452345678901234...",
  
  // Condition ID (for position tracking)
  conditionId: "0x1234567890abcdef...",
  
  // Tick size (minimum price increment)
  tickSize: "0.01",
  
  // Negative risk market? (true for multi-outcome markets)
  negRisk: false,
  
  // Minimum order size for rewards (from rewardsMinSize)
  minOrderSize: 20,
  
  // Maximum spread for rewards in cents (from rewardsMaxSpread)
  maxSpread: 4.5,
};

export const STRATEGY_OVERRIDES = {
  // Order size per side (must be >= minOrderSize)
  orderSize: 25,
  
  // Spread as % of maxSpread (0.5 = 50% = place at half max spread)
  spreadPercent: 0.5,
  
  // How often to check/refresh quotes (ms) - polling mode only
  refreshIntervalMs: 30_000,
  
  // Rebalance if midpoint moves by this amount
  rebalanceThreshold: 0.005,  // 0.5 cents
  
  // Maximum net position exposure (blocks one side when exceeded)
  positionLimits: {
    maxNetExposure: 100,
    warnThreshold: 0.8,
  },
  
  // Auto-merge neutral positions back to USDC
  merge: {
    enabled: true,      // Enable automatic merging
    minMergeAmount: 0,  // Merge any neutral position
  },
};

// Set to false when ready for live trading
export const dryRun = true;
```

### Dry Run Mode

The bot starts in **dry-run mode** by default (`dryRun: true`). In this mode:
- All order calculations are performed normally
- Orders are logged but NOT actually placed
- Useful for testing configuration and observing behavior
- Set `dryRun: false` in config.ts for live trading

### Finding Market Parameters

```bash
# Option 1: Find the best markets automatically
npm run findBestMarkets                       # Shows ranked list of markets
npm run findBestMarkets -- --details 1        # Details for top market

# Option 2: Generate config from a specific event
npm run selectMarket -- <event-slug-or-url>

# Example workflow:
npm run findBestMarkets                       # Find "nfc-south-winner-11" is top
npm run selectMarket -- nfc-south-winner-11   # List markets in event
npm run selectMarket -- nfc-south-winner-11 0 # Generate config for market 0
# Outputs ready-to-paste TypeScript config
```

## Strategy Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `orderSize` | 10 | Size per order in shares |
| `spreadPercent` | 0.5 | Quote at X% of max spread from midpoint |
| `refreshIntervalMs` | 30000 | Check/refresh quotes every N ms (polling mode only) |
| `rebalanceThreshold` | 0.005 | Rebalance if midpoint moves by N (0.5 cents) |
| `dryRun` | true | Simulate orders without placing them |

### WebSocket Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `webSocket.enabled` | true | Use WebSocket for real-time price updates |
| `webSocket.debounceMs` | 50 | Trailing debounce delay before rebalancing (ms) |
| `webSocket.fallbackPollingMs` | 30000 | Fallback polling interval when WebSocket disconnects |
| `webSocket.pingIntervalMs` | 10000 | Ping interval to keep WebSocket alive |
| `webSocket.reconnectDelayMs` | 1000 | Initial reconnect delay (exponential backoff) |
| `webSocket.maxReconnectDelayMs` | 30000 | Maximum reconnect delay |

### Position Limits

The bot tracks positions and enforces net exposure limits:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `positionLimits.maxNetExposure` | 100 | Maximum YES - NO position before blocking |
| `positionLimits.warnThreshold` | 0.8 | Warn when at 80% of limit |

**How it works:**
- Net exposure = YES tokens - NO tokens
- Positive = long YES, Negative = long NO
- Blocks BUY YES when exposure >= maxNetExposure
- Blocks BUY NO when exposure <= -maxNetExposure

### Auto-Merge Parameters

The bot automatically merges neutral positions back to USDC:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `merge.enabled` | true | Enable automatic merging of neutral positions |
| `merge.minMergeAmount` | 0 | Minimum neutral position to trigger merge (0 = any) |

**How it works:**
- Neutral position = min(YES tokens, NO tokens)
- When neutral > minMergeAmount, merge is triggered
- Merging converts equal YES + NO tokens back to USDC
- P&L cost basis is adjusted proportionally

### Tuning Guidelines

**Aggressive (higher rewards, higher risk):**
```typescript
spreadPercent: 0.3,      // Closer to midpoint = more rewards
refreshIntervalMs: 15000, // More frequent updates
orderSize: 50,           // Larger orders
maxNetExposure: 200,     // Higher position limits
```

**Conservative (lower rewards, lower risk):**
```typescript
spreadPercent: 0.8,      // Farther from midpoint = safer
refreshIntervalMs: 60000, // Less frequent updates
orderSize: 25,           // Smaller orders
maxNetExposure: 50,      // Tighter position limits
```

## Architecture

### File Structure

```
src/strategies/marketMaker/
├── index.ts       # Main entry point (thin orchestrator)
├── config.ts      # Strategy configuration (EDIT THIS!)
├── types.ts       # TypeScript type definitions (MergeConfig, WebSocketConfig, SessionStats, etc.)
├── quoter.ts      # Quote generation logic (BUY YES + BUY NO)
├── lifecycle.ts   # Startup/shutdown, validation, banner, merge check, session summary
├── executor.ts    # Order placement and cancellation
└── modes/         # Execution mode implementations
    ├── index.ts       # Mode exports
    ├── websocket.ts   # WebSocket real-time runner (includes merge, fill tracking)
    └── polling.ts     # REST polling runner (includes merge)
```

### Component Interaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       index.ts (Thin Orchestrator)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Validate config (lifecycle.ts)                                       │
│  2. Print banner (lifecycle.ts)                                          │
│  3. Initialize authenticated client                                      │
│  4. Check USDC balance                                                   │
│  5. Delegate to mode runner ──┬──▶ modes/websocket.ts (default)          │
│                               └──▶ modes/polling.ts   (fallback)         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│ lifecycle.ts │           │  executor.ts │           │  quoter.ts   │
│              │           │              │           │              │
│ validateConfig           │ placeQuotes  │           │generateQuotes│
│ printBanner  │           │ cancelOrders │           │shouldRebalance
│ createShutdown           │              │           │estimateScore │
│ checkAndMerge│           │              │           │              │
└──────────────┘           └──────────────┘           └──────────────┘
        │                           │
        ▼                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    @/utils/* (shared)                             │
│                                                                   │
│ ● authClient.ts      ● websocket.ts       ● positionTracker.ts   │
│ ● orders.ts          ● inventory.ts       ● ctf.ts (merge)       │
│ ● rewards.ts         ● safe.ts                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Config    │─────▶│   Quoter    │─────▶│  Executor   │
│             │      │             │      │             │
│ yesTokenId  │      │ Calculates  │      │ Places BUY  │
│ noTokenId   │      │ YES + NO    │      │ orders on   │
│ orderSize   │      │ buy prices  │      │ both tokens │
│ spreadPct   │      │             │      │             │
└─────────────┘      └─────────────┘      └─────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │  Rewards    │
                     │  Utilities  │
                     │             │
                     │ Calculates  │
                     │ scores      │
                     └─────────────┘
```

## Example Session

```
============================================================
  MARKET MAKER BOT - USDC-Only Mode
============================================================
  YES Token: 75710865397670382800...
  NO Token:  10842869574567893452...
  Order Size: 25 shares per side
  Spread: 50% of max (4.5c)
  Refresh: every 30s
  Rebalance Threshold: 0.5 cents
  Tick Size: 0.01
  Negative Risk: false
  Mode: DRY RUN (orders will NOT be placed)
============================================================
  Press Ctrl+C to stop

[12:00:00] Checking USDC balance...
[12:00:01] USDC Balance: $250.00 (minimum: $50.00)
[12:00:01] Pre-flight checks passed
[12:00:01] Initializing authenticated client...
[12:00:02] Client initialized successfully
[12:00:02] Connecting to WebSocket...
[12:00:02] WebSocket connected
[12:00:02] Cycle #1 | Midpoint: $0.4500
[12:00:02]   No active quotes, placing new orders...
[12:00:02]   Placing quotes:
[12:00:02]     BUY YES 25 @ $0.4275 (2.2c from mid)
[12:00:02]     BUY NO 25 @ $0.5275 (= SELL YES @ $0.4725, 2.2c from mid)
[12:00:02]     Estimated scores: YES=14.2, NO=14.2
[12:00:02]   [DRY RUN] Would place: BUY YES 25 @ $0.4275
[12:00:02]   [DRY RUN] Would place: BUY NO 25 @ $0.5275
[12:00:32] Cycle #2 | Midpoint: $0.4510
[12:00:32]   Quotes still valid (YES: $0.4275, NO: $0.5275)
...

^C
[12:05:30] Shutting down...
[12:05:30] Cancelling orders on YES token...
[12:05:30] Cancelling orders on NO token...
[12:05:30] [DRY RUN] Would cancel all orders

============================================================
  SESSION SUMMARY
============================================================
  Duration: 5m 30s
  Cycles: 12
------------------------------------------------------------
  TRADING:
    Fills: 0
    Volume: $0.00
    Orders Placed: 24
    Orders Cancelled: 22
------------------------------------------------------------
  MERGE OPERATIONS:
    Merges: 0
    USDC Freed: $0.00
============================================================

Goodbye!
```

### Session Statistics

On shutdown, the bot displays a summary of the session including:

| Statistic | Description |
|-----------|-------------|
| Duration | How long the bot ran |
| Cycles | Number of rebalance cycles |
| Fills | Number of orders that were filled |
| Volume | Total dollar volume traded |
| Orders Placed | Number of orders placed |
| Orders Cancelled | Number of orders cancelled |
| Merges | Number of merge operations performed |
| USDC Freed | Total USDC returned from merging |

This summary helps you understand the bot's activity and efficiency during the session.

## Risks and Considerations

### Position Risk
- If one side fills more than the other, you accumulate a position
- Monitor your net exposure and adjust accordingly
- **Mitigated**: Position tracker blocks one side when limits exceeded

### Capital Lock-up Risk
- When you accumulate both YES and NO tokens, capital is locked
- Neutral position (min of YES, NO) cannot be used for trading
- **Mitigated**: Auto-merge automatically converts neutral positions back to USDC

### Execution Risk
- Orders may get filled between refresh cycles
- Partial fills may leave you with one-sided exposure
- **Mitigated**: WebSocket mode provides ~50ms reaction time

### Price Impact
- Larger order sizes may move the market
- Consider market liquidity when sizing orders

### Technical Risks
- Network issues may prevent order cancellation
- Always monitor the bot while running
- **Mitigated**: Dry-run mode allows testing without real orders

## Related Documentation

- [Polymarket Rewards Documentation](https://docs.polymarket.com/#liquidity-rewards)
- [CLOB API Documentation](https://docs.polymarket.com/#clob-api)

## See Also

- `npm run findBestMarkets` - Find the highest-paying markets for liquidity rewards
- `npm run checkRewards` - Check if your orders are earning rewards
- `npm run getEvent` - Get market parameters for configuration
