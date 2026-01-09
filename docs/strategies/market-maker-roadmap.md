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
- [ ] Inventory-skewed quoting (widen bid when long, tighten ask)

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
- [ ] Stop-loss threshold (halt if P&L drops below limit)
- [ ] Max daily loss limit with automatic shutdown
- [x] Fill tracking (real-time via user WebSocket)
- [ ] Real-time P&L calculation

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

## Lessons Learned (2024-12-29 Production Run)

**What happened:** Bot started with USDC only. Could only BUY (SELL failed). Market rose $0.44 -> $0.55 (buys filled around $0.53). Market then crashed to $0.32. Bot now had tokens but no USDC, so it could only SELL - liquidating the position around $0.35. Lost ~$0.18/share.

**Key takeaways:**
- Market making requires two-sided inventory
- One-sided quoting = directional bet
- Need fill tracking, volatility filter, position limits, stop-loss

---

*Last updated: 2025-01-09 - Added fill tracking via user WebSocket, position limits with hard stops*
