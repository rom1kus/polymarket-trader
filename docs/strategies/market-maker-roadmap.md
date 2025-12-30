# Market Maker Strategy - Roadmap

> **Note:** This roadmap is specific to the **Market Maker strategy** (`src/strategies/marketMaker/`).
> For strategy documentation, see [market-maker.md](./market-maker.md).

Organized by **Impact** and **Effort**. Priority items directly prevent losses or enable profitability.

---

## Critical (High Impact, Low-Medium Effort)

Fix before next production run.

### Pre-Flight Checks
- [ ] Balance check before placing orders (query USDC + token balances)
- [ ] Skip orders when insufficient balance (don't attempt orders that will fail)
- [ ] Halt bot if both sides fail repeatedly
- [ ] Log warnings when operating one-sided

### Two-Sided Liquidity
- [ ] Seed inventory before starting (require both USDC + tokens)
- [ ] Token minting via CTF `splitPosition()` (split USDC into YES+NO tokens)
- [ ] Alternative: Buy tokens first via limit order before starting MM

### Inventory Management
- [ ] Track current position on each cycle
- [ ] Position limits (max tokens before stopping BUY side)
- [ ] Inventory-skewed quoting (widen bid when long, tighten ask)

### Testing
- [ ] **Dry-run mode** - Simulate without placing real orders

---

## High Priority (High Impact, Medium Effort)

### Risk Management
- [ ] Stop-loss threshold (halt if P&L drops below limit)
- [ ] Max daily loss limit with automatic shutdown
- [ ] Fill tracking (poll trade history)
- [ ] Real-time P&L calculation

### Market Volatility Protection
- [ ] Volatility filter (pause when price swings exceed threshold)
- [ ] Trend detection (don't quote into trending markets)
- [ ] Dynamic spread widening during high volatility

### Real-Time Data
- [ ] WebSocket for midpoint updates
- [ ] WebSocket for fill notifications
- [ ] Order book depth monitoring

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

## Lessons Learned (2024-12-29 Production Run)

**What happened:** Bot started with USDC only. Could only BUY (SELL failed). Market rose $0.44 -> $0.55 (buys filled around $0.53). Market then crashed to $0.32. Bot now had tokens but no USDC, so it could only SELL - liquidating the position around $0.35. Lost ~$0.18/share.

**Key takeaways:**
- Market making requires two-sided inventory
- One-sided quoting = directional bet
- Need fill tracking, volatility filter, position limits, stop-loss

---

*Last updated: 2024-12-30*
