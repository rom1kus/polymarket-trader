## Today:
- [ ] Fix `findBestMarket` script with latest changes from `checkRewards` so it will simulate our position on the markets out there and tell us where we will have the highest `earning_percentage`, or just rank markets by it
- [ ] Auto market switcher: Find most profitable market and switch to it
- [ ] Test new functionality with inventory, make sure it doesn't loose money anymore
- [ ] Skew prices, etc..
- [ ] Visualization
- [ ] Implement the rest of the roadmap as you see fit

## Ideas for strategy improvements:
- Inventory management (positions, balance, websocket?)
- Orders and trades traction?
- Stop losses

## Later:
- [ ] Test coverage
- [ ] Use Effect, refactor
- [ ] Get private key out of .env

## Ideas:
- Market maker that earns liquidity rewards
- Dive Deep: Abstract wallets

## Done:
- [x] Finish reviewing Development Docs
- [x] Install Open Code
- [x] Start `polymarket-trader` repo with SDK calls examples
- [x] Plan the market maker and start it's implementation
- [x] Strategy: Fail analysis + plan for fixes (consider switching from polling to ws for faster reactions)
- [x] Refactoring: Separate everything into functions, docs
- [x] Visualization of the bot's architecture
- [ ] Strategy: Fixes implementation + Visualization of the bot's state
    - [x] Implement "Two-Sided Liquidity": `splitPosition()` and it's placement in the strategy's lifecycle
    - [x] Implement "Pre-Flight Checks"
    - [x] Implement "Inventory Management"
    - [x] Implement **Dry-run mode**
    - [x] Implement "Real-Time Data": WebSocket for midpoint updates
    - [x] Research and implement "Two-Sided Quoting"
    - [x] Research and implement "Inventory Management"
