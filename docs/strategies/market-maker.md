# Market Maker Strategy

A market maker bot that provides two-sided liquidity around the current midpoint to earn Polymarket liquidity rewards.

## Overview

The market maker strategy places simultaneous bid (buy) and ask (sell) orders at calculated spreads from the market midpoint. By maintaining two-sided liquidity within reward-eligible parameters, the bot earns liquidity rewards based on Polymarket's quadratic scoring formula.

## Quick Start

```bash
# 1. Configure your market in src/strategies/marketMaker/config.ts
# 2. Run the bot
npm run marketMaker
# 3. Press Ctrl+C to stop (gracefully cancels orders)
```

## How It Works

### High-Level Flow

```
                            ┌─────────────────────────────────────────────────────────┐
                            │                   MARKET MAKER LOOP                      │
                            └─────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│   INITIALIZATION   │───▶│  VALIDATE CONFIG   │───▶│  CREATE CLIENT     │
│                    │    │  - Token ID set?   │    │  (authenticated)   │
└────────────────────┘    │  - Size >= min?    │    └────────────────────┘
                          │  - Spread valid?   │              │
                          └────────────────────┘              │
                                                              ▼
                          ┌───────────────────────────────────────────────────────────┐
                          │                     MAIN LOOP (while running)              │
                          │  ┌─────────────────────────────────────────────────────┐  │
                          │  │                                                     │  │
                          │  │  ┌──────────────┐     ┌──────────────────────────┐  │  │
                          │  │  │ GET MIDPOINT │────▶│ CHECK IF REBALANCE NEEDED│  │  │
                          │  │  │ from CLOB    │     │ - No active quotes? YES  │  │  │
                          │  │  └──────────────┘     │ - Midpoint moved? YES    │  │  │
                          │  │                       │ - Otherwise: NO          │  │  │
                          │  │                       └──────────────────────────┘  │  │
                          │  │                                  │                  │  │
                          │  │           ┌──────────────────────┴───────────┐      │  │
                          │  │           ▼                                  ▼      │  │
                          │  │   ┌───────────────┐                  ┌───────────┐  │  │
                          │  │   │  REBALANCE    │                  │ KEEP      │  │  │
                          │  │   │ 1. Cancel old │                  │ EXISTING  │  │  │
                          │  │   │ 2. Place new  │                  │ QUOTES    │  │  │
                          │  │   └───────────────┘                  └───────────┘  │  │
                          │  │           │                                  │      │  │
                          │  │           └──────────────────────────────────┘      │  │
                          │  │                          │                          │  │
                          │  │                          ▼                          │  │
                          │  │                  ┌───────────────┐                  │  │
                          │  │                  │ SLEEP         │                  │  │
                          │  │                  │ (30s default) │                  │  │
                          │  │                  └───────────────┘                  │  │
                          │  │                          │                          │  │
                          │  └──────────────────────────┴──────────────────────────┘  │
                          │                                                           │
                          │  On SIGINT/SIGTERM: Cancel all orders, exit gracefully    │
                          └───────────────────────────────────────────────────────────┘
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
  // Token ID from getEvent script
  tokenId: "7571086539767038280082354847097805299113400214070193326451269217051324225887",
  
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
```

### Finding Market Parameters

```bash
# Get token ID, tick size, and reward params
npm run getEvent -- <event-slug-or-url>

# Example output:
# Token ID: 7571086539767038280082354847097805299113400214070193326451269217051324225887
# Tick Size: 0.01
# Rewards Min Size: 20
# Rewards Max Spread: 4.5
```

## Strategy Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `orderSize` | 10 | Size per order in shares |
| `spreadPercent` | 0.5 | Quote at X% of max spread from midpoint |
| `refreshIntervalMs` | 30000 | Check/refresh quotes every N ms |
| `rebalanceThreshold` | 0.005 | Rebalance if midpoint moves by N (0.5 cents) |

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
├── index.ts   # Main entry point and runner loop
├── config.ts  # Strategy configuration (EDIT THIS!)
├── quoter.ts  # Quote generation logic
└── types.ts   # TypeScript type definitions
```

### Component Interaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            index.ts (Runner)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │   config.ts  │    │   quoter.ts  │    │  @/utils/* (shared)      │  │
│  │              │    │              │    │                          │  │
│  │ MARKET_CONFIG│───▶│generateQuotes│    │ ● authClient.ts         │  │
│  │ STRATEGY_... │    │shouldRebalance    │ ● orders.ts              │  │
│  │              │    │estimateScore │◄──▶│ ● rewards.ts             │  │
│  │              │    │formatQuote   │    │ ● helpers.ts             │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Config    │─────▶│   Quoter    │─────▶│   Orders    │
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
  Token: 75710865397670382800...
  Order Size: 25 shares per side
  Spread: 50% of max (4.5c)
  Refresh: every 30s
  Rebalance Threshold: 0.5 cents
  Tick Size: 0.01
  Negative Risk: false
============================================================
  Press Ctrl+C to stop

[12:00:00] Initializing authenticated client...
[12:00:01] Client initialized successfully
[12:00:01] Cycle #1 | Midpoint: $0.4500
[12:00:01]   No active quotes, rebalancing...
[12:00:01]   Placing quotes:
[12:00:01]     BUY 25 @ $0.4275 (2.2c from mid)
[12:00:01]     SELL 25 @ $0.4725 (2.2c from mid)
[12:00:01]     Estimated scores: Bid=14.2, Ask=14.2
[12:00:02]     Bid placed: a1b2c3d4e5f6...
[12:00:02]     Ask placed: f6e5d4c3b2a1...
[12:00:32] Cycle #2 | Midpoint: $0.4510
[12:00:32]   Quotes still valid (Bid: $0.4275, Ask: $0.4725)
[12:01:02] Cycle #3 | Midpoint: $0.4600
[12:01:02]   Midpoint moved, rebalancing...
...

^C
[12:05:30] Shutting down...
[12:05:30] Cancelling all orders...
[12:05:31] All orders cancelled

Goodbye!
```

## Risks and Considerations

### Inventory Risk
- If the market moves directionally, you may accumulate a position
- Monitor your position and adjust accordingly

### Execution Risk
- Orders may get filled between refresh cycles
- Partial fills may leave you with one-sided exposure

### Price Impact
- Larger order sizes may move the market
- Consider market liquidity when sizing orders

### Technical Risks
- Network issues may prevent order cancellation
- Always monitor the bot while running

## Related Documentation

- [Polymarket Rewards Documentation](https://docs.polymarket.com/#liquidity-rewards)
- [CLOB API Documentation](https://docs.polymarket.com/#clob-api)

## See Also

- `npm run checkRewards` - Check if your orders are earning rewards
- `npm run getEvent` - Get market parameters for configuration
