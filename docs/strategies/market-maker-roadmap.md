# Market Maker Strategy - Roadmap

> **Note:** This roadmap is specific to the **Market Maker strategy** (`src/strategies/marketMaker/`).
> For strategy documentation, see [market-maker.md](./market-maker.md).

Organized by **Impact** and **Effort**. Priority items directly prevent losses or enable profitability.

---

## Critical (High Impact, Low-Medium Effort)

Fix before next production run.

### Pre-Flight Checks
- [x] Balance check before placing orders (query USDC + token balances)
- [x] Skip orders when insufficient balance (don't attempt orders that will fail)
- [x] Halt bot if both sides fail repeatedly
- [x] Log warnings when operating one-sided

### Two-Sided Liquidity
- [x] Seed inventory before starting (require both USDC + tokens)
- [x] Token minting via CTF `splitPosition()` (split USDC into YES+NO tokens)

### Inventory Management
- [x] Track current position on each cycle
- [x] Position limits (max tokens before stopping BUY/SELL side)
- [ ] Inventory-skewed quoting *(see Phase 2 below)*
  - [ ] Skew factor configuration
  - [ ] Dynamic offset calculation based on position
  - [ ] Start-skew threshold (% of limit)

### Testing
- [x] **Dry-run mode** - Simulate without placing real orders

### Two-Sided Quoting ✅ RESOLVED
- [x] **Order books ARE mirrored** - Confirmed that placing orders on YES token automatically
      appears on the NO order book with inverted prices (BUY YES @ $0.48 = SELL NO @ $0.52)
- [x] **No separate NO token orders needed** - Would be redundant and could create conflicts
- [x] **Rewards already account for both books** - Per Polymarket docs, reward formulas use
      both `m` (YES) and `m'` (NO complement), but since books are mirrored, the same orders
      are counted correctly from both perspectives

> **Investigation (2025-01-09):** Tested by placing YES orders and switching to NO orderbook -
> orders appeared mirrored with inverted prices and could be cancelled from either view.
> Polymarket's reward equations (Qone/Qtwo) explicitly include both m and m' but this is
> handled automatically via the mirrored order book. Current implementation (BUY+SELL on YES)
> provides full two-sided liquidity on both books.

---

## High Priority (High Impact, Medium Effort)

### Risk Management
- [x] Fill tracking (real-time via user WebSocket)
- [ ] Fill economics tracking *(see Phase 1 below)*
  - [ ] Average cost calculation per token type
  - [ ] Unrealized P&L (mark-to-market)
  - [ ] Realized P&L (completed round-trips)
  - [ ] Total P&L display in logs
  - [ ] Persist economics across restarts
- [ ] Stop-loss with position liquidation *(see Phase 3 below)*
  - [ ] Max unrealized loss threshold
  - [ ] Max daily loss threshold  
  - [ ] Liquidation mode (market/limit/passive)
  - [ ] Auto-resume after liquidation (configurable)
  - [ ] Cooldown period before resuming

### Market Volatility Protection
- [ ] Volatility filter (pause when price swings exceed threshold)
- [ ] Trend detection (don't quote into trending markets)
- [ ] Dynamic spread widening during high volatility

### Real-Time Data
- [x] WebSocket for midpoint updates
- [x] WebSocket for fill notifications (user channel)
- [x] Order book depth monitoring (via WebSocket book events)

### UI / Visualization
- [ ] Separate web UI for monitoring and debugging
- [ ] Real-time charts (price, inventory, P&L)
- [ ] Order visualization (current quotes on order book)
- [ ] Trade history display
- [ ] Alerts and notifications

---

## Medium Priority (Medium Impact, Medium Effort)

### Order Management
- [ ] Order amendment instead of cancel/replace
- [ ] Batch order placement for multiple markets
- [ ] Order expiration handling

### Market Selection
- [ ] Auto-select high-reward markets from Gamma API
- [ ] Filter by liquidity, volume, reward amount
- [ ] Fetch reward parameters dynamically
- [ ] Support multi-outcome events (negative risk)

### Negative Risk Markets
- [ ] Full `negRisk: true` support
- [ ] Augmented negative risk markets
- [ ] Auto-detection from market data

### Monitoring
- [ ] Order scoring verification
- [ ] Reward estimation from order book depth
- [ ] Trade history logging
- [ ] Performance metrics (fill rate, reward rate)

---

## Lower Priority (Various Impact/Effort)

### Infrastructure
- [ ] Config file support (JSON/YAML)
- [ ] Multiple markets in single run
- [ ] Logging to file with rotation
- [ ] Prometheus metrics export
- [ ] Docker container
- [ ] Health check endpoint

### Developer Experience
- [ ] Unit tests for quoter logic
- [ ] Integration tests with mock CLOB
- [ ] CLI argument parsing
- [ ] Verbose logging levels

### Additional Strategies
- [ ] Grid trading
- [ ] Cross-market arbitrage
- [ ] Mean reversion
- [ ] Momentum/trend following

---

## Lessons Learned (2026-01-16 Production Run)

**What happened:** Bot running in USDC-only mode with position limit ±10. A single fill 
of 20 NO @ $0.52 immediately hit 200% of the position limit (net exposure -20). Bot 
correctly blocked further NO purchases and went single-sided, only quoting YES.

**Observations (things working correctly):**
1. **Fill attribution works** - OrderTracker + UserWebSocket correctly identified 
   BUY NO @ $0.52 from the maker_orders array
2. **Position limits work** - Blocked NO side when exposure exceeded -10
3. **Data persistence works** - Fill saved to `./data/fills-*.json` with correct structure
4. **Deduplication works** - Same WebSocket event received 3 times but only processed once

**Problems identified:**
1. **Single-sided mode is passive** - Bot waits for market to come to us, doesn't actively 
   work to return to neutral. In trending markets, could be stuck one-sided indefinitely.
2. **Fill prices not utilized** - We know we paid $0.52 for 20 NO tokens, but this isn't 
   used for P&L calculation, average cost tracking, or informing quote prices.
3. **Order size vs limit mismatch** - `orderSize: 20` exceeds `maxNetExposure: 10`, so a 
   single fill overshoots the limit by 2x. Consider: `orderSize ≤ maxNetExposure`.
4. **No stop-loss mechanism** - If market moves against our position, no automatic response.

**Key takeaways:**
- Position limits prevent *additional* exposure but don't help recover from existing exposure
- Need inventory-skewed quoting to naturally work back to neutral (Phase 2)
- Need P&L tracking to know when to cut losses (Phase 1)
- Need configurable stop-loss with automatic position reduction (Phase 3)

---

## Lessons Learned (2024-12-29 Production Run)

**What happened:** Bot started with USDC only. Could only BUY (SELL failed). Market rose $0.44 -> $0.55 (buys filled around $0.53). Market then crashed to $0.32. Bot now had tokens but no USDC, so it could only SELL - liquidating the position around $0.35. Lost ~$0.18/share.

**Key takeaways:**
- Market making requires two-sided inventory
- One-sided quoting = directional bet
- Need fill tracking, volatility filter, position limits, stop-loss

---

*Last updated: 2026-01-16 - Added implementation phases for P&L tracking, inventory skewing, and stop-loss*

---

## Implementation Phases

Detailed implementation plans for major features. Each phase builds on the previous.

### Phase 1: Fill Economics & P&L Tracking
**Priority: HIGH | Effort: Medium | Impact: High**

**Problem:** Fills are tracked but their economic impact is not calculated. We don't know:
- What's our average cost for YES/NO tokens?
- What's our current unrealized P&L?
- What's our realized P&L from round-trips?

Without this, we can't make informed decisions about when to cut losses or take profits.

**Solution:** Extend position tracking to include economic calculations, persisted across restarts.

**Data structure changes:**

Add to `PersistedMarketState` in `src/types/fills.ts`:
```typescript
interface FillEconomics {
  totalYesBought: number;      // Cumulative YES tokens bought
  totalYesSold: number;        // Cumulative YES tokens sold
  totalNoBought: number;       // Cumulative NO tokens bought  
  totalNoSold: number;         // Cumulative NO tokens sold
  totalYesCost: number;        // Sum of (price × size) for YES buys
  totalYesProceeds: number;    // Sum of (price × size) for YES sells
  totalNoCost: number;         // Sum of (price × size) for NO buys
  totalNoProceeds: number;     // Sum of (price × size) for NO sells
  realizedPnL: number;         // P&L from completed round-trips
}
```

**New methods for `PositionTracker`:**
- `getAverageCost(tokenType: "YES" | "NO"): number` - Average entry price
- `getUnrealizedPnL(currentMidpoint: number): number` - Mark-to-market P&L
- `getRealizedPnL(): number` - Closed position P&L
- `getTotalPnL(currentMidpoint: number): number` - Combined P&L

**P&L Calculation Logic:**
```typescript
// Average cost for YES tokens
avgYesCost = totalYesCost / totalYesBought;

// Unrealized P&L (mark-to-market)
// YES tokens: current value - cost basis
// NO tokens: current value - cost basis
yesUnrealized = yesPosition * (midpoint - avgYesCost);
noUnrealized = noPosition * ((1 - midpoint) - avgNoCost);
unrealizedPnL = yesUnrealized + noUnrealized;

// Realized P&L (from sells)
// When we sell YES: proceeds - (avgCost × size)
// Accumulated in realizedPnL field
```

**Example log output:**
```
[2026-01-16 15:30:08] Fill: BUY 20 NO @ $0.5200
  Position: YES=0, NO=20 | Net: -20.00
  Avg Cost: YES=N/A, NO=$0.5200
  P&L: Unrealized=$0.00, Realized=$0.00, Total=$0.00
```

**Files to modify:**
- `src/types/fills.ts` - Add FillEconomics interface to PersistedMarketState
- `src/utils/positionTracker.ts` - Add P&L calculation methods, update processFill()
- `src/utils/storage.ts` - Ensure economics are loaded/saved (already handles full state)
- `src/strategies/marketMaker/modes/websocket.ts` - Log P&L on fills

---

### Phase 2: Inventory-Skewed Quoting
**Priority: HIGH | Effort: Medium | Impact: High**

**Problem:** When position limit is reached, bot goes single-sided and passively waits.
In trending markets, this could mean being stuck with a losing position indefinitely.
The bot should actively work to return to neutral, not just wait for the market.

**Solution:** Dynamically adjust quote prices based on current inventory to naturally 
encourage fills that return position to neutral.

**How it works:**
- When **long NO** (negative net exposure): Tighten YES quote to attract YES buys
- When **long YES** (positive net exposure): Tighten NO quote to attract NO buys
- "Tighten" = move closer to midpoint = higher reward score = more attractive to takers

**Why this is better than just blocking:**
1. Tighter quotes earn MORE rewards (quadratic scoring favors tight spreads)
2. More likely to get filled (closer to market)
3. Natural mean-reversion without aggressive market crossing
4. Still earns rewards while working back to neutral

**Skew calculation:**
```typescript
// positionRatio: how much of limit is used (-1 to +1)
// skewFactor: 0 = no skew, 1 = max skew (quote at midpoint)
const positionRatio = netExposure / maxNetExposure;  // e.g., -20/10 = -2 (clamped to -1)
const clampedRatio = Math.max(-1, Math.min(1, positionRatio));
const skewAmount = Math.abs(clampedRatio) * skewFactor * baseOffset;

if (netExposure < 0) {
  // Long NO, want to buy YES - tighten YES quote
  yesOffset = baseOffset - skewAmount;  // Closer to midpoint
  noOffset = baseOffset + skewAmount;   // Further from midpoint (or blocked by limits)
} else if (netExposure > 0) {
  // Long YES, want to buy NO - tighten NO quote  
  noOffset = baseOffset - skewAmount;   // Closer to midpoint
  yesOffset = baseOffset + skewAmount;  // Further from midpoint
}
```

**Example (current situation: long 20 NO, limit ±10, skewFactor 0.5):**
```
Normal (neutral):     BUY YES @ 2.0c from mid, BUY NO @ 2.0c from mid
Skewed (at limit):    BUY YES @ 1.0c from mid, BUY NO @ blocked (position limit)

Result: YES quote is twice as attractive, more likely to fill and reduce NO exposure
```

**Configuration:**
```typescript
interface InventorySkewConfig {
  enabled: boolean;           // Enable/disable skewing (default: true)
  skewFactor: number;         // 0-1, how aggressive (default: 0.5)
  startSkewAt: number;        // Start skewing at this % of limit (default: 0.3 = 30%)
}
```

**Behavior by position:**

| Net Exposure | % of Limit | YES Offset | NO Offset | Notes |
|--------------|------------|------------|-----------|-------|
| 0            | 0%         | 2.0c       | 2.0c      | Normal two-sided |
| -3           | 30%        | 1.7c       | 2.3c      | Slight skew starts |
| -7           | 70%        | 1.3c       | 2.7c      | Moderate skew |
| -10          | 100%       | 1.0c       | BLOCKED   | Max skew + limit |

**Files to modify:**
- `src/strategies/marketMaker/types.ts` - Add InventorySkewConfig
- `src/strategies/marketMaker/config.ts` - Add default skew configuration
- `src/strategies/marketMaker/quoter.ts` - Implement `generateSkewedQuotes()`
- `src/strategies/marketMaker/executor.ts` - Pass position state to quoter

---

### Phase 3: Stop-Loss with Position Liquidation
**Priority: HIGH | Effort: Medium | Impact: High**

**Problem:** No mechanism to cut losses when market moves against our position.
Without stop-loss, a market maker can hold a losing position until market resolution,
potentially losing the entire position value.

**Solution:** Configurable stop-loss that monitors P&L and automatically liquidates
position when thresholds are breached.

**Trigger conditions:**
1. **Unrealized P&L threshold** - e.g., stop if unrealized P&L < -$10
2. **Daily P&L threshold** - e.g., stop if total daily P&L < -$50
3. **Position age** (optional) - e.g., liquidate if stuck one-sided for >30 minutes

**Liquidation modes:**

| Mode | Behavior | Speed | Cost |
|------|----------|-------|------|
| `market` | Cross the spread to exit immediately | Fastest | Pays spread |
| `limit` | Place at midpoint, wait for fill | Medium | No spread cost |
| `passive` | Cancel quotes, wait for manual intervention | Slowest | None |

**Configuration:**
```typescript
interface StopLossConfig {
  enabled: boolean;                    // Enable stop-loss (default: false)
  maxUnrealizedLoss: number;           // e.g., -10 = stop if unrealized < -$10
  maxDailyLoss: number;                // e.g., -50 = stop if daily P&L < -$50
  liquidationMode: "market" | "limit" | "passive";  // How to exit (default: "market")
  resumeAfterLiquidation: boolean;     // Continue after position closed? (default: false)
  cooldownMinutes: number;             // Wait before resuming (default: 30)
}
```

**Liquidation logic:**
```typescript
async function checkStopLoss(tracker: PositionTracker, midpoint: number): Promise<boolean> {
  const unrealizedPnL = tracker.getUnrealizedPnL(midpoint);
  const dailyPnL = tracker.getDailyPnL(midpoint);
  
  const triggered = 
    unrealizedPnL < config.stopLoss.maxUnrealizedLoss ||
    dailyPnL < config.stopLoss.maxDailyLoss;
  
  if (!triggered) return false;
  
  log(`⚠️ STOP-LOSS TRIGGERED`);
  log(`  Unrealized P&L: $${unrealizedPnL.toFixed(2)} (limit: $${config.stopLoss.maxUnrealizedLoss})`);
  log(`  Daily P&L: $${dailyPnL.toFixed(2)} (limit: $${config.stopLoss.maxDailyLoss})`);
  
  // Cancel all open orders immediately
  await cancelAllOrders(client, config);
  
  if (config.stopLoss.liquidationMode === "passive") {
    log(`  Mode: PASSIVE - Waiting for manual intervention`);
    return true;
  }
  
  // Calculate liquidation order
  const netExposure = tracker.getNetExposure();
  
  if (config.stopLoss.liquidationMode === "market") {
    // Cross the spread to exit immediately
    if (netExposure > 0) {
      // Long YES, need to sell - place BUY NO above ask
      const price = (1 - midpoint) + 0.01;  // Cross spread
      log(`  Liquidating: BUY NO ${netExposure} @ $${price.toFixed(4)} (market cross)`);
      await placeOrder(client, { token: noTokenId, side: "BUY", price, size: netExposure });
    } else if (netExposure < 0) {
      // Long NO, need to sell - place BUY YES above ask  
      const price = midpoint + 0.01;  // Cross spread
      log(`  Liquidating: BUY YES ${-netExposure} @ $${price.toFixed(4)} (market cross)`);
      await placeOrder(client, { token: yesTokenId, side: "BUY", price, size: -netExposure });
    }
  } else if (config.stopLoss.liquidationMode === "limit") {
    // Place at midpoint and wait
    if (netExposure > 0) {
      const price = 1 - midpoint;  // NO midpoint
      log(`  Liquidating: BUY NO ${netExposure} @ $${price.toFixed(4)} (limit at mid)`);
      await placeOrder(client, { token: noTokenId, side: "BUY", price, size: netExposure });
    } else if (netExposure < 0) {
      const price = midpoint;  // YES midpoint
      log(`  Liquidating: BUY YES ${-netExposure} @ $${price.toFixed(4)} (limit at mid)`);
      await placeOrder(client, { token: yesTokenId, side: "BUY", price, size: -netExposure });
    }
  }
  
  return true;
}
```

**Post-liquidation behavior:**
- If `resumeAfterLiquidation: false` - Bot exits after liquidation attempt
- If `resumeAfterLiquidation: true` - Bot waits `cooldownMinutes`, then resumes normal operation

**Files to modify:**
- `src/strategies/marketMaker/types.ts` - Add StopLossConfig
- `src/strategies/marketMaker/config.ts` - Add default stop-loss config (disabled)
- `src/strategies/marketMaker/lifecycle.ts` - Add `checkStopLoss()` function
- `src/strategies/marketMaker/executor.ts` - Add `placeLiquidationOrder()` function
- `src/strategies/marketMaker/modes/websocket.ts` - Check stop-loss on fills and rebalances

---
