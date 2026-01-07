# Market Maker Strategy

A market maker bot that provides two-sided liquidity around the current midpoint to earn Polymarket liquidity rewards.

## Overview

The market maker strategy places simultaneous bid (buy) and ask (sell) orders at calculated spreads from the market midpoint. By maintaining two-sided liquidity within reward-eligible parameters, the bot earns liquidity rewards based on Polymarket's quadratic scoring formula.

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
│  - Size >= min?    │    │                    │    │   - Create wallet/signer   │
│  - Spread valid?   │    │                    │    │   - Get Polygon provider   │
└────────────────────┘    └────────────────────┘    └────────────────────────────┘
                                                                  │
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            PRE-FLIGHT CHECKS                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────────┐  │
│   │ CHECK INVENTORY  │───▶│ CHECK BALANCES   │───▶│ AUTO-SPLIT IF NEEDED     │  │
│   │ - USDC balance   │    │ - YES tokens     │    │ - Approve USDC to CTF    │  │
│   │ - MATIC for gas  │    │ - NO tokens      │    │ - Split USDC → YES + NO  │  │
│   └──────────────────┘    │ - Sufficient?    │    └──────────────────────────┘  │
│                           └──────────────────┘                                   │
│                                                                                  │
│   If pre-flight fails → EXIT with error                                          │
│   If pre-flight passes → Continue to main loop                                   │
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
│   │   Subscribe to: token ID with custom_feature_enabled: true               │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                           │
│                                      ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  On Midpoint Update (from WebSocket)                                      │  │
│   │  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────────┐   │  │
│   │  │ TRAILING DEBOUNCE│───▶│ REBALANCE NEEDED?│───▶│    REBALANCE      │   │  │
│   │  │ (wait 50ms for   │    │ - Threshold check│    │ 1. Cancel old     │   │  │
│   │  │  price to settle)│    │ - Has quotes?    │    │ 2. Place new      │   │  │
│   │  └──────────────────┘    └──────────────────┘    └───────────────────┘   │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  Fallback: If WebSocket disconnects → Poll REST API every 30s            │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  Periodic: Inventory check (every 10 rebalances if autoSplit on)         │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   On SIGINT/SIGTERM: Disconnect WebSocket, cancel all orders, exit gracefully   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Quote Generation

The bot generates quotes symmetrically around the midpoint:

```
           Max Spread (e.g., 3c)                 Max Spread (e.g., 3c)
        ◄───────────────────────►             ◄───────────────────────►

        ┌─────────────────────────────────────────────────────────────┐
        │                                                             │
   $0.47│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                                           │ Not eligible
        │                 ▓                                           │ (outside max spread)
        │                 ▓                                           │
   $0.48│                 ├─────── BID @ $0.485 ─────────┐            │
        │                 │       (1.5c from mid)        │            │ ◄── Reward eligible
        │                 │                              │            │     zone
   $0.49│                 │                              │            │
        │                 │                              │            │
   $0.50│─────────────────┼────── MIDPOINT ──────────────┼────────────│
        │                 │                              │            │
   $0.51│                 │                              │            │
        │                 │                              │            │
   $0.52│                 └─────── ASK @ $0.515 ─────────┤            │ ◄── Reward eligible
        │                                                │            │     zone
   $0.53│                                                ▓            │
        │                                           ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ Not eligible
        │                                                             │
        └─────────────────────────────────────────────────────────────┘

        │◄────── spreadPercent × maxSpread ──────►│
                     (e.g., 50% × 3c = 1.5c)
```

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
  
  // Condition ID for CTF operations (split/merge)
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
  
  // How often to check/refresh quotes (ms)
  refreshIntervalMs: 30_000,
  
  // Rebalance if midpoint moves by this amount
  rebalanceThreshold: 0.005,  // 0.5 cents
};

// Inventory management settings
export const DEFAULT_INVENTORY_PARAMS: InventoryConfig = {
  // Minimum token balance per side (YES and NO)
  minTokenBalance: 50,
  
  // Auto-split USDC into tokens if inventory is low
  autoSplitEnabled: true,
  
  // Reserve multiplier for USDC (keeps extra for gas/emergencies)
  usdcReserveMultiplier: 1.2,
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

### Inventory Management

The bot now supports **two-sided inventory** using CTF `splitPosition()`:

1. **Pre-flight checks**: Before starting, the bot verifies:
   - Sufficient USDC balance
   - Sufficient YES and NO token balances
   - Minimum MATIC for gas fees

2. **Auto-split**: If `autoSplitEnabled: true` and token inventory is low:
   - Bot automatically splits USDC into YES+NO tokens
   - Amount calculated based on `minTokenBalance` and `usdcReserveMultiplier`

3. **Periodic checks**: Every 10 cycles, inventory is re-checked

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

### Inventory Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `minTokenBalance` | 50 | Minimum YES/NO tokens to hold per side |
| `autoSplitEnabled` | true | Auto-split USDC into tokens if low |
| `usdcReserveMultiplier` | 1.2 | Keep 20% extra USDC as reserve |

### Tuning Guidelines

**Aggressive (higher rewards, higher risk):**
```typescript
spreadPercent: 0.3,      // Closer to midpoint = more rewards
refreshIntervalMs: 15000, // More frequent updates
orderSize: 50,           // Larger orders
```

**Conservative (lower rewards, lower risk):**
```typescript
spreadPercent: 0.8,      // Farther from midpoint = safer
refreshIntervalMs: 60000, // Less frequent updates
orderSize: 25,           // Smaller orders
```

## Architecture

### File Structure

```
src/strategies/marketMaker/
├── index.ts       # Main entry point (thin orchestrator, ~110 lines)
├── config.ts      # Strategy configuration (EDIT THIS!)
├── types.ts       # TypeScript type definitions
├── quoter.ts      # Quote generation logic
├── lifecycle.ts   # Startup/shutdown, validation, banner
├── executor.ts    # Order placement, cancellation, CTF splits
└── modes/         # Execution mode implementations
    ├── index.ts       # Mode exports
    ├── websocket.ts   # WebSocket real-time runner
    └── polling.ts     # REST polling runner
```

### Component Interaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       index.ts (Thin Orchestrator)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Validate config (lifecycle.ts)                                       │
│  2. Print banner (lifecycle.ts)                                          │
│  3. Initialize clients (authClient, Safe)                                │
│  4. Run pre-flight checks (inventory.ts)                                 │
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
│ createShutdown           │ executeSplit │           │estimateScore │
└──────────────┘           └──────────────┘           └──────────────┘
                                    │
                                    ▼
                           ┌──────────────────────────┐
                           │  @/utils/* (shared)      │
                           │                          │
                           │ ● authClient.ts          │
                           │ ● orders.ts              │
                           │ ● rewards.ts             │
                           │ ● websocket.ts           │
                           │ ● inventory.ts           │
                           │ ● ctf.ts                 │
                           └──────────────────────────┘
```

### Data Flow

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Config    │─────▶│   Quoter    │─────▶│  Executor   │
│             │      │             │      │             │
│ tokenId     │      │ Calculates  │      │ Places BID  │
│ orderSize   │      │ bid/ask     │      │ and ASK     │
│ spreadPct   │      │ prices      │      │ orders      │
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
  MARKET MAKER BOT
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

[12:00:00] Running pre-flight checks...
[12:00:01] Inventory Status:
           USDC: $250.00
           YES:  100 tokens
           NO:   100 tokens
           MATIC: 0.15
[12:00:01] Pre-flight checks passed
[12:00:01] Initializing authenticated client...
[12:00:02] Client initialized successfully
[12:00:02] Cycle #1 | Midpoint: $0.4500
[12:00:02]   No active quotes, rebalancing...
[12:00:02]   Placing quotes:
[12:00:02]     BUY 25 @ $0.4275 (2.2c from mid)
[12:00:02]     SELL 25 @ $0.4725 (2.2c from mid)
[12:00:02]     Estimated scores: Bid=14.2, Ask=14.2
[12:00:02]   [DRY RUN] Would place bid: BUY 25 @ $0.4275
[12:00:02]   [DRY RUN] Would place ask: SELL 25 @ $0.4725
[12:00:32] Cycle #2 | Midpoint: $0.4510
[12:00:32]   Quotes still valid (Bid: $0.4275, Ask: $0.4725)
...

^C
[12:05:30] Shutting down...
[12:05:30] [DRY RUN] Would cancel all orders

Goodbye!
```

### Live Trading Session

```
[12:00:00] Running pre-flight checks...
[12:00:01] Inventory Status:
           USDC: $50.00
           YES:  10 tokens
           NO:   10 tokens
           MATIC: 0.15
[12:00:01] WARNING: Insufficient YES tokens (10 < 50 required)
[12:00:01] WARNING: Insufficient NO tokens (10 < 50 required)
[12:00:01] Auto-split enabled, splitting $100 USDC into tokens...
[12:00:05] Split successful: +100 YES, +100 NO tokens
[12:00:05] Pre-flight checks passed
...
```

## Risks and Considerations

### Inventory Risk
- If the market moves directionally, you may accumulate a position
- Monitor your position and adjust accordingly
- **Mitigated**: Bot now starts with two-sided inventory (YES+NO tokens)

### Execution Risk
- Orders may get filled between refresh cycles
- Partial fills may leave you with one-sided exposure
- **Mitigated**: Pre-flight checks verify sufficient inventory before starting

### Price Impact
- Larger order sizes may move the market
- Consider market liquidity when sizing orders

### Technical Risks
- Network issues may prevent order cancellation
- Always monitor the bot while running
- **Mitigated**: Dry-run mode allows testing without real orders

### Gas Costs
- CTF `splitPosition()` operations require MATIC for gas
- Bot checks for minimum MATIC balance (0.01) before starting
- Keep sufficient MATIC in your wallet for operations

## Related Documentation

- [Polymarket Rewards Documentation](https://docs.polymarket.com/#liquidity-rewards)
- [CLOB API Documentation](https://docs.polymarket.com/#clob-api)

## See Also

- `npm run findBestMarkets` - Find the highest-paying markets for liquidity rewards
- `npm run checkRewards` - Check if your orders are earning rewards
- `npm run getEvent` - Get market parameters for configuration
