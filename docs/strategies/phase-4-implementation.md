# Phase 4: Dual-Market Operation - Implementation Guide

> Detailed architecture, code examples, and implementation plan for Phase 4.

---

## Data Structures

```typescript
interface OrchestratorState {
  running: boolean;
  activeMarket: MarketState | null;        // Full market making
  liquidationMarkets: LiquidationMarket[]; // Passive exit orders
}

interface LiquidationMarket {
  market: RankedMarketByEarnings;
  tracker: PositionTracker;
  config: LiquidationConfig;
  stage: LiquidationStage;
  orderId: string | null;
  startedAt: number;
}

enum LiquidationStage {
  PASSIVE = "passive",       // Wait at midpoint
  SKEWED = "skewed",         // Tighten gradually
  AGGRESSIVE = "aggressive", // Timeout: Cross partially
  MARKET = "market"          // Force exit (stop-loss)
}

interface LiquidationConfig {
  // Profit-aware quoting
  minProfitMargin: number;           // e.g., 0.01 = $0.01 profit per token
  blockLosingQuotes: boolean;        // Don't quote if would lock in loss
  
  // Inventory skewing
  skewing: {
    startAfterMinutes: number;       // e.g., 5 = start after 5 min
    maxSkewAmount: number;           // e.g., 0.02 = max 2 cents past mid
    increasePerMinute: number;       // e.g., 0.002 = 0.2 cents/min
  };
  
  // Stop-loss
  stopLoss: {
    enabled: boolean;
    maxUnrealizedLoss: number;       // e.g., -10 = exit if loss > $10
    triggerStage: LiquidationStage;  // Force MARKET on trigger
  };
  
  // Timeout
  maxWaitMinutes: number;            // e.g., 60 = timeout after 1 hour
  timeoutStage: LiquidationStage;    // Switch to AGGRESSIVE on timeout
  priceCheckInterval: number;        // e.g., 30000 = check every 30s
}
```

---

## Core Logic

### Orchestrator Loop

```typescript
async function orchestratorLoop(config: OrchestratorConfig) {
  // 1. Start active market
  const bestMarket = await findBestMarket(config.liquidity);
  state.activeMarket = await createMarketState(bestMarket);
  
  // 2. Start market maker with callback
  const mmPromise = runMarketMaker(state.activeMarket, config, {
    onPositionLimit: async (tracker: PositionTracker) => {
      // Move to liquidation
      state.liquidationMarkets.push({
        market: state.activeMarket.market,
        tracker,
        stage: LiquidationStage.PASSIVE,
        startedAt: Date.now()
      });
      
      // Find new best market (exclude liquidation markets)
      const excludeConditionIds = state.liquidationMarkets.map(lm => lm.market.conditionId);
      const newMarket = await findBestMarket(config, { excludeConditionIds });
      state.activeMarket = await createMarketState(newMarket);
      
      return { action: "switch", newMarket };
    }
  });
  
  // 3. Background: Manage liquidations
  setInterval(async () => {
    for (const liqMarket of state.liquidationMarkets) {
      const status = await manageLiquidation(liqMarket, client, config);
      if (status === "completed") {
        // Remove from list
        state.liquidationMarkets = state.liquidationMarkets.filter(lm => lm !== liqMarket);
      }
    }
  }, config.liquidation.priceCheckInterval);
}
```

### Liquidation Management

```typescript
async function decideLiquidationQuote(
  liqMarket: LiquidationMarket,
  midpoint: number,
  config: LiquidationConfig
): Promise<{ price: number; size: number } | null> {
  
  const { tracker, stage } = liqMarket;
  const elapsed = (Date.now() - liqMarket.startedAt) / 60000;
  const unrealizedPnL = tracker.getUnrealizedPnL(midpoint);
  
  // STOP-LOSS (HIGHEST PRIORITY)
  if (config.stopLoss.enabled && unrealizedPnL < config.stopLoss.maxUnrealizedLoss) {
    log(`⚠️ STOP-LOSS TRIGGERED: P&L=$${unrealizedPnL}`);
    liqMarket.stage = config.stopLoss.triggerStage;
    return generateQuoteForStage(config.stopLoss.triggerStage, liqMarket, midpoint, config);
  }
  
  // TIMEOUT CHECK
  if (elapsed > config.maxWaitMinutes) {
    liqMarket.stage = config.timeoutStage;
    return generateQuoteForStage(config.timeoutStage, liqMarket, midpoint, config);
  }
  
  // DETERMINE STAGE (PASSIVE → SKEWED)
  if (stage === PASSIVE && elapsed >= config.skewing.startAfterMinutes) {
    liqMarket.stage = SKEWED;
  }
  
  // Generate quote for current stage
  const quote = generateQuoteForStage(liqMarket.stage, liqMarket, midpoint, config);
  
  // PROFIT-AWARE CHECK
  const minProfitable = calculateMinProfitablePrice(tracker, quote, config);
  if (config.blockLosingQuotes && quote.price > minProfitable) {
    return null; // Wait for better price
  }
  
  return quote;
}

function generateQuoteForStage(
  stage: LiquidationStage,
  liqMarket: LiquidationMarket,
  midpoint: number,
  config: LiquidationConfig
): { price: number; size: number } {
  
  const netExposure = liqMarket.tracker.getNetExposure();
  const skewMinutes = (Date.now() - liqMarket.startedAt) / 60000 - config.skewing.startAfterMinutes;
  
  let price: number;
  
  switch (stage) {
    case PASSIVE:
      // Wait at midpoint
      price = netExposure > 0 ? (1 - midpoint) : midpoint;
      break;
      
    case SKEWED:
      // Progressive skewing
      const skewAmount = Math.min(
        Math.max(0, skewMinutes) * config.skewing.increasePerMinute,
        config.skewing.maxSkewAmount
      );
      price = netExposure > 0 
        ? (1 - midpoint) + skewAmount
        : midpoint + skewAmount;
      break;
      
    case AGGRESSIVE:
      // Cross spread partially (timeout)
      price = (netExposure > 0 ? (1 - midpoint) : midpoint) + 0.02;
      break;
      
    case MARKET:
      // Force exit (stop-loss)
      price = (netExposure > 0 ? (1 - midpoint) : midpoint) + 0.05;
      break;
  }
  
  return { price, size: Math.abs(netExposure) };
}

function calculateMinProfitablePrice(
  tracker: PositionTracker,
  quote: { price: number; size: number },
  config: LiquidationConfig
): number {
  const avgCost = tracker.getAverageCost();
  const netExposure = tracker.getNetExposure();
  
  // Calculate minimum price needed for profit margin
  if (netExposure > 0) {
    // Selling NO tokens (have YES exposure)
    return avgCost - config.minProfitMargin;
  } else {
    // Selling YES tokens (have NO exposure)
    return avgCost + config.minProfitMargin;
  }
}
```

---

## Configuration

### Default Configuration

```typescript
const defaultLiquidationConfig: LiquidationConfig = {
  minProfitMargin: 0.01,           // $0.01 profit per token
  blockLosingQuotes: true,
  
  skewing: {
    startAfterMinutes: 5,
    maxSkewAmount: 0.02,           // 2 cents max
    increasePerMinute: 0.002,      // 0.2 cents/min
  },
  
  stopLoss: {
    enabled: true,
    maxUnrealizedLoss: -10,        // Force exit at -$10
    triggerStage: LiquidationStage.MARKET,
  },
  
  maxWaitMinutes: 60,              // Timeout after 1 hour
  timeoutStage: LiquidationStage.AGGRESSIVE,
  priceCheckInterval: 30000,       // Check every 30s
};
```

### CLI Flags

```bash
npm run orchestrate -- --dual-market-mode              # Enable parallel operation
npm run orchestrate -- --liq-profit-margin 0.02        # Require $0.02 profit
npm run orchestrate -- --liq-skew-start 10             # Start skewing after 10 min
npm run orchestrate -- --liq-stop-loss-threshold -15   # Stop-loss at -$15
npm run orchestrate -- --liq-timeout 90                # Timeout after 90 min
npm run orchestrate -- --liq-check-interval 60000      # Check every 60s
```

---

## Example Scenarios

### Example 1: Quick Profitable Liquidation
```
00:00 - Fill on Market A → Position limit → LIQUIDATION mode (PASSIVE)
00:00 - Start Market B (earning immediately) ✅
00:03 - Market A: Price favorable (above avg cost + margin) → Fill → Close position
Result: 3 min in liquidation, earned $0.50 profit + Market B rewards ($0.30) = $0.80 total
```

### Example 2: Skewed Liquidation (Trending Market)
```
00:00 - Fill @ $0.55 → Liquidation (PASSIVE), start Market B ✅
00:05 - SKEWED stage starts (5 min elapsed)
00:05-00:40 - Quote progressively more aggressive (0.002/min)
00:40 - Finally filled @ $0.58
Result: Small loss (-$0.60) but earned ~$0.90 on Market B = Net +$0.30
```

### Example 3: Stop-Loss Triggered
```
00:00 - Fill @ $0.55 → Liquidation (PASSIVE), start Market B ✅
01:30 - Market crashes, unrealized P&L: -$10.00
01:31 - ⚠️ STOP-LOSS TRIGGERED → Force MARKET stage
01:31 - Filled @ $1.00 (market cross) → Final loss: -$11
Result: Stop-loss limited damage, Market B earned ~$2.70 (90 min) = Net -$8.30
        Without dual-market: -$11 and NO earnings = -$11.00 (23% worse)
```

### Example 4: Timeout → Aggressive
```
00:00 - Fill @ $0.55 → Liquidation (PASSIVE), start Market B ✅
01:00 - AGGRESSIVE stage (60 min timeout)
01:05 - Filled @ $0.58 (crossed spread)
Result: Small loss (-$0.60) but earned ~$1.80 on Market B = Net +$1.20
```

---

## Files to Modify

### New Files
- `src/strategies/orchestrator/liquidation.ts` - All liquidation logic
  - `manageLiquidation()`
  - `decideLiquidationQuote()`
  - `generateQuoteForStage()`
  - `calculateMinProfitablePrice()`

### Modify Existing
- `src/strategies/orchestrator/types.ts`
  - Add `LiquidationMarket` interface
  - Add `LiquidationStage` enum
  - Add `LiquidationConfig` interface
  - Add `onPositionLimit` callback to `MarketMakerCallbacks`

- `src/strategies/orchestrator/config.ts`
  - Add `liquidation` field to `OrchestratorConfig`
  - Add CLI argument parsing for liquidation flags

- `src/strategies/orchestrator/index.ts`
  - Add `liquidationMarkets` to state
  - Add `onPositionLimit` callback implementation
  - Add background interval for liquidation management

- `src/strategies/marketMaker/index.ts`
  - Accept `callbacks` parameter
  - Call `onPositionLimit` when position limits hit

- `src/strategies/marketMaker/types.ts`
  - Add `callbacks?: MarketMakerCallbacks` to config

### No Changes Needed
- `src/strategies/marketMaker/quoter.ts` - No skewing in active mode
- `src/strategies/marketMaker/lifecycle.ts` - No stop-loss in active mode
- `src/utils/positionTracker.ts` - Already has needed methods

---

## Testing Strategy

### 1. Dry-Run Testing
```bash
npm run orchestrate -- \
  --dual-market-mode \
  --dry-run \
  --liq-stop-loss-threshold -5 \
  --liq-skew-start 2
```
**Goal:** Verify orchestrator logic, stage transitions, quote calculations without real orders.

### 2. Single Liquidation Test (Small Capital)
```bash
npm run orchestrate -- \
  --dual-market-mode \
  --position-limit 5 \
  --liq-stop-loss-threshold -2 \
  --liq-timeout 10
```
**Goal:** Test real liquidation behavior with aggressive parameters on small position.

### 3. Dual-Market Test (Production-Like)
```bash
npm run orchestrate -- \
  --dual-market-mode \
  --position-limit 10 \
  --liq-stop-loss-threshold -10 \
  --liq-timeout 60
```
**Goal:** Observe parallel market operation for 2-3 hours, verify earning uptime.

### 4. Stop-Loss Test
```bash
npm run orchestrate -- \
  --dual-market-mode \
  --position-limit 10 \
  --liq-stop-loss-threshold -3 \
  --no-liq-block-losing
```
**Goal:** Force stop-loss trigger with low threshold, verify forced exit.

---

## Success Metrics

**Compared to single-market operation:**

1. **Earning uptime**
   - Current: ~60-70% (idle during position-limited periods)
   - Target: >95% (always have active market)

2. **Liquidation efficiency**
   - Target: <30 min for profitable exits
   - Target: <60 min for break-even exits

3. **Net P&L**
   - Target: Liquidation losses < 20% of active market earnings
   - Example: If Market B earns $10, liquidation losses should be < $2

4. **Capital efficiency**
   - Target: >20% improvement in earnings per dollar vs single-market
   - Measure: Total earnings / capital deployed / time

---

## Rollout Plan

### Phase 4a: Core Infrastructure (Week 1)
- [ ] Create data structures and types
- [ ] Implement orchestrator with `onPositionLimit` callback
- [ ] Implement liquidation state management (PASSIVE only)
- [ ] Dry-run testing

### Phase 4b: Liquidation Logic (Week 2)
- [ ] Implement SKEWED stage with inventory skewing
- [ ] Implement profit-aware quoting
- [ ] Implement stop-loss logic
- [ ] Single liquidation test with real orders

### Phase 4c: Production (Week 3)
- [ ] Full dual-market testing
- [ ] Monitor and tune parameters
- [ ] 24-hour validation run
- [ ] Document lessons learned

---

*This implementation guide is living documentation. Update as the architecture evolves.*
