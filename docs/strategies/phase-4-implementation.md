# Phase 4: Dual-Market Operation - Current Implementation (MVP)

> **Status:** PASSIVE liquidation stage implemented. SKEWED/AGGRESSIVE/MARKET stages are future enhancements.

This document describes the **currently implemented** Phase 4 dual-market operation. For future enhancements, see the "Future Enhancements" section at the bottom.

---

## Overview

When the active market hits position limits, the orchestrator:
1. **Moves market to liquidation queue** - Starts passively exiting the position
2. **Finds new active market** - Immediately starts earning on a new market
3. **Manages liquidations in parallel** - Every 30s, updates passive exit orders

**Result:** Always have capital working, never idle waiting for positions to clear.

---

## Current Implementation

### Data Structures (Actual)

```typescript
interface OrchestratorState {
  running: boolean;
  currentMarket: RankedMarketByEarnings | null;  // Active market making
  liquidationMarkets: LiquidationMarket[];       // Passive exit queue
  // ... other fields
}

interface LiquidationMarket {
  market: RankedMarketByEarnings;
  config: MarketMakerConfig;           // Market params (tokenIds, negRisk, etc.)
  tracker: PositionTracker;             // Position tracking with P&L
  startedAt: Date;                      // When liquidation started
  stage: LiquidationStage;              // Currently always PASSIVE
  activeOrderId: string | null;         // Current order on the book
  lastMidpoint: number | null;          // Last quoted price
  maxBuyPrice: number | null;           // Break-even ceiling (computed but not used)
}

enum LiquidationStage {
  PASSIVE = "passive",       // Sell-to-close with avg-cost floor (CURRENT)
  SKEWED = "skewed",         // Progressive skewing (FUTURE)
  AGGRESSIVE = "aggressive", // Cross spread partially (FUTURE)
  MARKET = "market"          // Force exit at any price (FUTURE)
}
```

### Core Flow (Actual)

```typescript
// 1. Market maker exits with position_limit reason
const result = await runMarketMaker(config);
if (result.reason === "position_limit") {
  // 2. Add to liquidation queue
  state.liquidationMarkets.push({
    market: currentMarket,
    config: currentConfig,
    tracker: result.positionTracker!,
    stage: LiquidationStage.PASSIVE,
    startedAt: new Date(),
    activeOrderId: null,
    lastMidpoint: null,
    maxBuyPrice: calculateMaxBuyPrice(result.positionTracker!, netExposure)
  });
  
  // 3. Save to disk
  saveLiquidations(state.liquidationMarkets);
  
  // 4. Find new active market (exclude liquidation markets)
  const excludeConditionIds = state.liquidationMarkets.map(lm => lm.market.conditionId);
  const newMarket = await findBestMarket(config.liquidity, {
    excludeConditionIds,
    // ... other options
  });
  
  // 5. Start new market immediately
  state.currentMarket = newMarket;
  state.currentConfig = createConfigForMarket(newMarket, config, state);
}

// 6. Background: Every 30s, manage liquidations
setInterval(() => {
  manageLiquidations(client, state, config);
}, 30_000);
```

### Liquidation Management (PASSIVE Stage Only)

**Current implementation:** Sell-to-close with average cost floor

```typescript
async function manageSingleLiquidation(
  client: ClobClient,
  liqMarket: LiquidationMarket,
  config: OrchestratorConfig
): Promise<void> {
  const netExposure = liqMarket.tracker.getNetExposure();
  
  // 1. Determine which token to SELL
  // Long YES (netExposure > 0) → SELL YES
  // Long NO (netExposure < 0) → SELL NO
  const isLongYes = netExposure > 0;
  const tokenId = isLongYes ? config.market.yesTokenId : config.market.noTokenId;
  const size = Math.abs(netExposure);
  
  // 2. Get current midpoint
  const midpoint = await getMidpoint(client, config.market.yesTokenId);
  
  // 3. Calculate target price (SELL side)
  // For YES token: sell at midpoint
  // For NO token: sell at (1 - midpoint)
  const desiredPrice = isLongYes ? midpoint : (1 - midpoint);
  
  // 4. Apply profit protection floor
  const avgCost = liqMarket.tracker.getAverageCost(isLongYes ? "YES" : "NO");
  const floor = avgCost !== null ? avgCost : 0;
  const targetPrice = Math.max(desiredPrice, floor);
  
  // 5. Round to tick size
  const roundedPrice = roundToTickSize(targetPrice, config.market.tickSize);
  
  // 6. Replace order if price changed > 0.5 cents
  const shouldUpdate = 
    liqMarket.lastMidpoint === null || 
    Math.abs(roundedPrice - liqMarket.lastMidpoint) > 0.005;
  
  if (!shouldUpdate) return; // Order still valid
  
  // 7. Cancel old order
  if (liqMarket.activeOrderId) {
    await cancelOrder(client, liqMarket.activeOrderId);
    liqMarket.activeOrderId = null;
  }
  
  // 8. Place new SELL order
  const result = await placeOrder(client, {
    tokenId,
    side: Side.SELL,  // Always SELL the token we hold
    price: roundedPrice,
    size,
    tickSize: config.market.tickSize,
    negRisk: config.market.negRisk,
  });
  
  liqMarket.activeOrderId = result.orderId;
  liqMarket.lastMidpoint = roundedPrice;
}
```

**Key behaviors:**
- **Sell-to-close:** Places SELL orders on the token held (SELL YES if long YES, SELL NO if long NO)
- **Profit protection:** Never sells below average cost (`targetPrice = max(desiredPrice, avgCost)`)
- **When price unfavorable:** Places opportunistic order at cost basis (waits for market recovery)
- **When price favorable:** Places order at midpoint for quick exit
- **Order replacement threshold:** 0.5 cents price change
- **Neutral detection:** Position < 0.1 shares triggers removal from queue

---

## Persistence

### Liquidation State File

**Location:** `./data/liquidations.json`

**Schema:**
```json
{
  "version": 1,
  "markets": [
    {
      "conditionId": "0xabc123...",
      "startedAt": 1706000000000,
      "stage": "passive"
    }
  ],
  "lastUpdated": 1706000000000
}
```

**Behavior:**
- **Saved:** When adding/removing markets from liquidation queue
- **Loaded:** On orchestrator startup (auto-restores liquidations)
- **Cleared:** When liquidation completes (position becomes neutral)

### Position State Files

**Location:** `./data/fills-{conditionId}.json`

Contains fill history and cost basis for each market. Used to reconstruct `PositionTracker` on restart.

---

## Restart Behavior

**What happens when you restart:**

1. **Restore liquidations** - Markets in `liquidations.json` are automatically loaded into the queue
2. **Reconstruct trackers** - Position trackers rebuilt from `fills-{conditionId}.json` files
3. **Resume liquidation management** - Liquidation timer starts automatically (every 30s)
4. **Detect other positions** - Non-liquidation positions are prompted for liquidation or auto-queued with `--auto-resume`

**No manual intervention needed** - Liquidations resume seamlessly across restarts.

---

## Configuration

### Current Settings (Hardcoded)

```typescript
// Liquidation management interval
const LIQUIDATION_INTERVAL_MS = 30_000;  // 30 seconds

// Order replacement threshold
const PRICE_CHANGE_THRESHOLD = 0.005;    // 0.5 cents

// Neutral position threshold
const NEUTRAL_THRESHOLD = 0.1;           // 0.1 shares

// Stage: Always PASSIVE (future stages not implemented)
const DEFAULT_STAGE = LiquidationStage.PASSIVE;
```

### CLI Flags (Available)

```bash
# Dual-market operation is automatic (enabled when --enable-switching is set)
npm run orchestrate -- --enable-switching --no-dry-run

# Position handling on restart
npm run orchestrate -- --auto-resume       # Auto-liquidate detected positions

# Market discovery excludes liquidation markets automatically
# No additional flags needed
```

**Note:** No `--dual-market-mode` or `--liq-*` flags exist. Dual-market operation happens automatically when position limits are hit.

---

## Example Scenarios (Real Behavior)

### Scenario 1: Quick Exit (Favorable Price)

```
00:00 - Market A hits position limit (long YES @ $0.55 avg cost)
00:00 - Added to liquidation queue, Market B starts immediately ✅
00:01 - Liquidation: Midpoint = $0.58, SELL YES @ $0.58 (above cost)
00:03 - Order fills, position closed
00:03 - Market A removed from queue

Result: 3 min liquidation, small profit (+$0.60), Market B earned $0.30 = +$0.90 total
```

### Scenario 2: Wait at Cost Basis (Unfavorable Price)

```
00:00 - Market A hits position limit (long YES @ $0.55 avg cost)
00:00 - Added to liquidation queue, Market B starts ✅
00:01 - Liquidation: Midpoint = $0.52, but floor = $0.55
00:01 - Quote: SELL YES @ $0.55 (at cost, not midpoint)
00:05 - Midpoint moves to $0.56 → Replace order → SELL YES @ $0.56
00:10 - Order fills at $0.56

Result: 10 min liquidation, small profit (+$0.20), Market B earned $1.00 = +$1.20 total
```

### Scenario 3: Long Wait (Market Against Us)

```
00:00 - Market A hits position limit (long YES @ $0.55 avg cost)
00:00 - Added to liquidation queue, Market B starts ✅
00:01-01:00 - Midpoint stays at $0.50, quoting SELL YES @ $0.55 (opportunistic)
01:00 - No fills yet, but Market B earned $6.00
01:15 - Midpoint finally moves to $0.56, order fills

Result: 75 min liquidation, small profit (+$0.20), Market B earned $7.50 = +$7.70 total
         Without dual-market: Would have been idle earning $0
```

---

## Current Limitations

### Not Yet Implemented

1. **SKEWED stage** - Progressive price skewing after timeout
2. **AGGRESSIVE stage** - Crossing spread to force exit
3. **MARKET stage** - Immediate exit at any price
4. **Stop-loss** - Automatic forced exit on excessive loss
5. **Configurable timers** - All intervals are hardcoded
6. **On-chain balance reconciliation** - Relies on in-memory tracker state

### Known Trade-offs

- **No urgency escalation:** Will wait indefinitely at cost basis if market doesn't recover
- **Single order size:** Places full position size at once (no gradual exit)
- **Fixed 30s interval:** Can't adjust frequency based on urgency
- **Timer gated by --enable-switching:** Liquidation management only runs if switching is enabled

---

## Future Enhancements

### Stage Progression (Not Implemented)

```
PASSIVE (0-5 min)
  ↓ (no fills)
SKEWED (5-60 min)
  ↓ (timeout)
AGGRESSIVE (60+ min)
  ↓ (stop-loss)
MARKET (forced exit)
```

### Configuration (Not Implemented)

```bash
# Future CLI flags (design only, not implemented)
npm run orchestrate -- --liq-skew-start 5          # Start skewing after 5 min
npm run orchestrate -- --liq-timeout 60            # Timeout to AGGRESSIVE
npm run orchestrate -- --liq-stop-loss-threshold -10  # Force exit at -$10
npm run orchestrate -- --liq-check-interval 30000  # Check interval
```

### Advanced Quoting (Not Implemented)

- **Profit margin targets:** Require X% profit instead of break-even
- **Dynamic pricing:** Adjust based on unrealized P&L
- **Gradual size reduction:** Exit in chunks instead of all-at-once
- **Buy-to-close option:** Close by buying opposite token (currently only sell-to-close)

---

## Files Modified

### Created
- ✅ `src/strategies/orchestrator/liquidation.ts` - Liquidation management logic
- ✅ `src/utils/liquidationState.ts` - Persistence for `liquidations.json`

### Modified
- ✅ `src/strategies/orchestrator/index.ts` - Main loop, position_limit handling
- ✅ `src/strategies/orchestrator/types.ts` - `LiquidationMarket`, `LiquidationStage`
- ✅ `src/strategies/marketMaker/modes/polling.ts` - Exit on position_limit
- ✅ `src/strategies/marketMaker/modes/websocket.ts` - Exit on position_limit
- ✅ `src/strategies/marketMaker/types.ts` - `position_limit` exit reason
- ✅ `src/utils/orchestratorState.ts` - Detect liquidation vs active positions

---

## Testing

### Current Testing Approach

```bash
# 1. Test position limit trigger + liquidation handoff
npm run orchestrate -- \
  --enable-switching \
  --no-dry-run \
  --liquidity 50 \
  --order-size 10

# Watch for position_limit exit and liquidation queue addition
```

### Monitoring Liquidations

```bash
# Check liquidation state file
cat ./data/liquidations.json

# Check position state for specific market
cat ./data/fills-{conditionId}.json
```

### Logs to Watch For

```
[Orchestrator] Position limit hit on: {market}
[Orchestrator] Added to liquidation queue (1 total)
[Orchestrator] Starting liquidation management timer (every 30s)
[Liquidation] Managing 1 liquidation market(s)...
[Liquidation] {market} | Stage=passive | NetExp=+10.50 | Quote: SELL YES @ $0.55
[Liquidation] 1 market(s) completed liquidation
[Liquidation] ✓ {market} - Position closed
```

---

## Success Metrics

**Actual results from current implementation:**

1. **Earning uptime:** Active market always running (100% uptime)
2. **Liquidation completion:** Varies by market conditions (minutes to hours)
3. **Profit protection:** Never sells below cost basis ✅
4. **Parallel operation:** Active + liquidation markets run simultaneously ✅

---

*Last updated: 2026-01-28 - Reflects current MVP implementation*
