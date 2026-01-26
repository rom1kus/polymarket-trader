# Market Maker Strategy - Roadmap

> **Note:** This roadmap is specific to the **Market Maker strategy** (`src/strategies/marketMaker/`).
> For strategy documentation, see [market-maker.md](./market-maker.md).

Organized by **Impact** and **Effort**. Priority items directly prevent losses or enable profitability.

---

## High Priority (High Impact, Medium-High Effort)

### Phase 4: Dual-Market Operation ⭐ **PRIMARY FOCUS**
- [ ] Inventory-skewed quoting for liquidation markets
- [ ] Stop-loss with position liquidation
- [ ] Orchestrator for parallel active + liquidation markets
- [ ] Profit-aware quoting (only exit if profitable)

### Market Volatility Protection
- [ ] Runtime volatility monitoring (detect during active trading)
- [ ] Trend detection (don't quote into trending markets)
- [ ] Dynamic spread widening during high volatility

### UI / Visualization
- [ ] Separate web UI for monitoring and debugging
- [ ] Real-time charts (price, inventory, P&L)
- [ ] Order visualization
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
- [ ] Verbose logging levels

### Additional Strategies
- [ ] Grid trading
- [ ] Cross-market arbitrage
- [ ] Mean reversion
- [ ] Momentum/trend following

---

## Key Learnings

**Market making requirements (validated):**
1. Two-sided inventory required (can't be one-sided bet)
2. Volatility filter prevents toxic markets (31% moves = -$22.70 loss)
3. Position limits prevent catastrophic losses (but don't help recovery)
4. Stop-loss + dual-market operation needed for recovery

**Strategic validation needed:** 24-hour test with Phase 4 to validate:
```
Liquidity Rewards > (Adverse Selection Costs + Gas + Opportunity Cost)
```

---

*Last updated: 2026-01-26*

---

## Phase 4: Dual-Market Operation ⭐ **PRIMARY FOCUS**

**Priority: HIGH | Effort: Medium-High | Impact: Critical**

### Problem
When position-limited on one market, bot stops earning entirely while waiting for position to return to neutral. In trending markets, this could take hours/days.

### Solution
Run two markets in parallel:
- **Active Market**: Full market making with neutral position (reward-optimal)
- **Liquidation Market(s)**: Passive-to-aggressive exit with profit protection

**Result:** NEVER stop earning, always have capital working

### Benefits
1. Never stop earning - Always have an active market
2. Better capital efficiency - Don't wait idle
3. Natural exits - Passive orders first, no forced crossing unless necessary
4. Integrated risk management - Inventory skewing + profit-aware quoting + stop-loss
5. Scalable - Handle multiple liquidation markets

---

### Architecture

**Two distinct modes:**

```
┌─────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐   │
│  │  ACTIVE MARKET      │    │ LIQUIDATION MARKET  │   │
│  │  (Mode 1)           │    │ (Mode 2)            │   │
│  ├─────────────────────┤    ├─────────────────────┤   │
│  │ • Neutral position  │    │ • Positioned        │   │
│  │ • Reward-optimal    │    │ • Profit-aware      │   │
│  │ • Two-sided         │    │ • One-sided         │   │
│  │ • No skewing        │    │ • Inventory skewing │   │
│  │ • No stop-loss      │    │ • Stop-loss enabled │   │
│  └─────────────────────┘    └─────────────────────┘   │
│                                                         │
│  Always have 1 active + 0-N liquidation markets        │
└─────────────────────────────────────────────────────────┘
```

**Mode 1: Active Market Making**
- Neutral position (YES = NO = 0, or merged)
- Quote for reward optimization (tight spreads)
- Two-sided liquidity
- No skewing/stop-loss needed

**Mode 2: Liquidation**
- Non-neutral position (holding YES or NO)
- Quote for profitable exit only
- One-sided quoting (only closing side)
- Apply inventory skewing over time
- Apply stop-loss if P&L deteriorates
- Background process, doesn't block active market

### Liquidation Stages

| Stage | When | Behavior | Speed | Cost |
|-------|------|----------|-------|------|
| `PASSIVE` | Initial | Wait at midpoint | Slow | Profit margin |
| `SKEWED` | After N min | Tighten spread gradually | Medium | Reduced profit |
| `AGGRESSIVE` | Timeout | Cross spread partially | Fast | Small loss |
| `MARKET` | Stop-loss | Cross spread fully | Immediate | Accept loss |

---

### Implementation Details

See [Phase 4 Implementation Guide](./phase-4-implementation.md) for detailed architecture, code examples, configuration, and testing strategy.

**Key components:**
- Orchestrator with `onPositionLimit` callback
- Liquidation stages: PASSIVE → SKEWED → AGGRESSIVE → MARKET
- Profit-aware quoting, inventory skewing, stop-loss
- Default: Start skewing after 5 min, stop-loss at -$10, timeout at 60 min

**Files to modify:**
- New: `src/strategies/orchestrator/liquidation.ts`
- Modify: `orchestrator/types.ts`, `orchestrator/config.ts`, `orchestrator/index.ts`
- Modify: `marketMaker/index.ts`, `marketMaker/types.ts`

**Success metrics:**
- Earning uptime: >95% (vs ~60-70% single-market)
- Liquidation efficiency: <30 min for profitable exits
- Net P&L: Liquidation losses < 20% of active market earnings

---
