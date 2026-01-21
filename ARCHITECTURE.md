# Polymarket Trader - Architecture

## Overview
TypeScript-based trading bot for Polymarket. This project provides utilities, scripts, and automated trading strategies for interacting with the Polymarket platform.

## Tech Stack
- **Runtime**: Node.js with ESM modules
- **Language**: TypeScript 5.7+
- **Script Runner**: tsx
- **Environment Management**: dotenv
- **Safe SDK**: @safe-global/protocol-kit for Gnosis Safe transaction execution

## Project Structure

```
polymarket-trader/
├── docs/
│   └── strategies/
│       ├── market-maker.md         # Market maker strategy documentation
│       └── market-maker-roadmap.md # Market maker future enhancements
├── src/
│   ├── config/           # Application configuration
│   │   ├── index.ts      # CLOB and Gamma API hosts, chain settings
│   │   └── contracts.ts  # Polygon contract addresses (CTF, USDC, NegRisk)
│   ├── scripts/          # Executable utility scripts (thin orchestration only)
│   │   ├── getMarkets.ts # Fetches and displays all Polymarket markets
│   │   ├── getEvent.ts   # Fetches detailed event data by slug/URL
│   │   ├── checkRewards.ts # Checks if open orders are earning rewards
│   │   ├── selectMarket.ts # Generates market maker config from event slug
│   │   └── findBestMarkets.ts # Finds highest-paying markets for liquidity rewards
│   ├── strategies/       # Automated trading strategies
│   │   └── marketMaker/  # Market maker bot for liquidity rewards
│   │       ├── index.ts      # Main entry point (thin orchestrator)
│   │       ├── config.ts     # Strategy configuration (edit this!)
│   │       ├── types.ts      # Strategy-specific types (MergeConfig, WebSocketConfig, etc.)
│   │       ├── quoter.ts     # Quote generation logic
│   │       ├── lifecycle.ts  # Startup/shutdown, validation, banner, merge check
│   │       ├── executor.ts   # Order placement, cancellation, splits
│   │       └── modes/        # Execution mode implementations
│   │           ├── index.ts      # Mode exports
│   │           ├── websocket.ts  # WebSocket real-time runner
│   │           └── polling.ts    # REST polling runner
│   ├── types/            # Shared TypeScript type definitions
│   │   ├── balance.ts    # Balance and allowance types
│   │   ├── gamma.ts      # Types for Gamma API (events, markets metadata)
│   │   ├── inventory.ts  # Inventory management types (status, requirements, deficit)
│   │   ├── polymarket.ts # Custom types for CLOB API responses
│   │   ├── positions.ts  # Position tracking types
│   │   ├── rewards.ts    # Types for reward eligibility checking
│   │   └── strategy.ts   # Shared strategy types (MarketParams, etc.)
│   └── utils/            # Shared utility modules
│       ├── authClient.ts # Authenticated ClobClient factory (for trading)
│       ├── balance.ts    # USDC and token balance utilities
│       ├── client.ts     # Read-only ClobClient factory
│       ├── ctf.ts        # Conditional Token Framework operations (split/merge/approve via Safe)
│       ├── safe.ts       # Safe (Gnosis Safe) SDK utilities for transaction execution
│       ├── env.ts        # Environment variable management
│       ├── formatters.ts # Output formatting utilities
│       ├── gamma.ts      # Gamma API utilities (fetch events, parse markets)
│       ├── helpers.ts    # Common utilities (sleep, logging)
│       ├── inventory.ts  # Inventory management (status, requirements, pre-flight)
│       ├── markets.ts    # Market data utilities (sorting, outcome helpers)
│       ├── orderbook.ts  # Order book fetching utilities
│       ├── orders.ts     # Order placement and management utilities
│       ├── positions.ts  # Position tracking utilities
│       └── rewards.ts    # Reward calculation and eligibility checking
├── .env                  # Environment variables (not committed)
├── .env.example          # Example environment template
├── package.json          # Project configuration
└── tsconfig.json         # TypeScript configuration
```

## Key Modules

### `src/config/index.ts`
Application configuration constants:
- `config.clobHost` - Production CLOB API URL (`https://clob.polymarket.com`)
- `config.gammaHost` - Production Gamma API URL (`https://gamma-api.polymarket.com`)
- `config.chain` - Polygon mainnet chain (`Chain.POLYGON`)

### `src/config/contracts.ts`
Polygon mainnet contract addresses and constants:
- `CTF_ADDRESS` - Conditional Token Framework contract
- `USDC_ADDRESS` - USDC stablecoin contract on Polygon
- `NEG_RISK_CTF_ADDRESS` - Negative risk CTF adapter contract
- `MIN_MATIC_BALANCE` - Minimum MATIC required for gas (`0.01`)
- `DEFAULT_RPC_URL` - Fallback public Polygon RPC URL

### `src/types/`
Shared TypeScript type definitions. Types are organized by source:
- **Library types**: Import directly from `@polymarket/clob-client` (e.g., `Token`, `Chain`, `TickSize`)
- **Custom types**: Defined in `src/types/` when not exported by the library

#### `src/types/polymarket.ts`
Custom types for Polymarket CLOB API responses not exported by `@polymarket/clob-client`:
- `Market` - Market data structure from CLOB API
- `MarketsResponse` - Paginated markets response (extends `PaginationPayload`)
- `OrderBookData` - Order book pricing data combining CLOB and Gamma prices

#### `src/types/gamma.ts`
Types for Polymarket Gamma API responses (event and market metadata):
- `GammaEvent` - Event data with title, volume, liquidity, associated markets
- `GammaMarket` - Market within an event (outcome, prices, condition IDs)
- `GammaToken` - Token data within a market
- `ParsedGammaMarket` - Market with parsed outcome data ready for display
- `ParsedGammaEvent` - Event with parsed market data
- `ParsedOutcome` - Parsed outcome with price and token ID for trading
- `MarketRewardParams` - Reward parameters from Gamma API

#### `src/types/rewards.ts`
Types for reward eligibility checking and market ranking:
- `OpenOrder` - Open order from CLOB API
- `MarketRewardParamsWithMidpoint` - Reward params with current midpoint
- `OrderRewardStatus` - Reward status for a single order
- `RewardCheckResult` - Complete reward check result for a market
- `RewardCheckResultWithEarnings` - Result with earning % comparison to API
- `MarketWithRewards` - Market with reward parameters for ranking
- `MarketAttractivenessScore` - Score breakdown for market attractiveness (deprecated)
- `EarningPotentialScore` - Score breakdown based on estimated daily earnings
- `RankedMarket` - Market with calculated attractiveness score (deprecated)
- `RankedMarketByEarnings` - Market with calculated earning potential score
- `ActualEarningsResult` - Result of calculating actual earnings from placed orders

#### `src/types/strategy.ts`
Shared types for trading strategies:
- `StrategyConfig` - Base configuration for any strategy
- `MarketParams` - Market parameters required for trading (yesTokenId, noTokenId, conditionId, tickSize, negRisk, rewardsDaily, etc.)

#### `src/types/inventory.ts`
Types for inventory management and pre-flight checks:
- `InventoryStatus` - Current balances (USDC, YES tokens, NO tokens, MATIC)
- `InventoryRequirements` - Required balances for two-sided market making
- `InventoryDeficit` - Calculated deficit for auto-split
- `PreFlightResult` - Result of pre-flight checks (ready, warnings, errors)
- `InventoryConfig` - Configuration for inventory management
- `CtfOperationResult` - Result of CTF operations (split/merge)

#### `src/types/balance.ts`
Types for wallet balance tracking:
- `BalanceInfo` - Extended balance with parsed numeric values
- `WalletBalances` - Complete wallet balances (USDC + conditional tokens)
- `TokenBalanceSummary` - Summary of token balance for display

#### `src/types/positions.ts`
Types for position tracking:
- `Position` - Position in a single token (size, hasPosition)
- `MarketPosition` - Complete position for a binary market (YES + NO + net exposure)
- `PositionsSummary` - Summary of all positions across multiple markets

#### `src/types/fills.ts`
Types for fill tracking, position limits, and P&L economics:
- `Fill` - Trade fill event (id, tokenId, side, price, size, timestamp, outcome)
- `FillEconomics` - Cumulative P&L tracking (totalBought/Sold, totalCost/Proceeds, realizedPnL)
- `InitialCostBasis` - User-provided cost basis for pre-existing positions
- `PositionState` - Current position state (yesTokens, noTokens, netExposure)
- `PositionLimitsConfig` - Position limit settings (maxNetExposure, warnThreshold)
- `QuoteSideCheck` - Result of checking if a side can be quoted
- `PositionLimitStatus` - Current status relative to limits
- `ReconciliationResult` - Result of reconciling persisted vs actual position
- `PersistedMarketState` - Schema v2 for JSON file storage (fills, economics, initialCostBasis)
- `createEmptyEconomics()` - Factory function for new FillEconomics
- `PERSISTED_STATE_VERSION` - Current schema version (2)

#### `src/types/websocket.ts`
Types for Polymarket WebSocket API (`wss://ws-subscriptions-clob.polymarket.com`):
- `WebSocketState` - Connection states (disconnected, connecting, connected, reconnecting)
- `MarketSubscriptionMessage` - Subscription message for market channel
- `BestBidAskEvent` - Best bid/ask update event (requires `custom_feature_enabled`)
- `LastTradePriceEvent` - Trade execution notification
- `PriceChangeEvent` - Level 2 order book updates
- `BookEvent` - Full order book snapshot (sent on initial subscription)
- `TickSizeChangeEvent` - Tick size change notification
- `MarketEvent` - Union type for all market channel events
- `WebSocketManagerOptions` - Configuration options for `PolymarketWebSocket`
- `TokenPriceState` - Internal state for tracking best bid/ask per token
- `UserTradeEvent` - Trade fill notification from user channel
- `UserOrderEvent` - Order placement/cancellation from user channel
- `UserEvent` - Union type for user channel events
- `UserSubscriptionMessage` - Authentication message for user channel

### `src/utils/`

#### `src/utils/env.ts`
Environment variable management module providing:
- `getEnvRequired(key)` - Get required env var or throw
- `getEnvOptional(key, default)` - Get optional env var with fallback
- `env` object - Typed environment configuration

#### `src/utils/safe.ts`
Safe (Gnosis Safe) SDK utilities for executing transactions from the Safe account:
- `getSafeInstance(config)` - Initializes and caches Safe Protocol Kit instance
- `clearSafeCache()` - Clears the cached Safe instance
- `executeSafeTransaction(safe, transaction)` - Executes a single transaction through Safe
- `executeSafeBatchTransaction(safe, transactions)` - Executes multiple transactions atomically
- `createSafeTransactionData(to, data, value?)` - Creates transaction data for Safe SDK

**Why Safe?** Polymarket uses Gnosis Safe (proxy wallets) for trading. All CTF operations
(split, merge, approve) must be executed from the Safe account, not directly from the
private key. The Safe SDK enables proper transaction execution through the proxy wallet.

#### `src/utils/ctf.ts`
Conditional Token Framework (CTF) operations executed through Safe:
- `getPolygonProvider()` - Gets provider from `POLYGON_RPC_URL` env var or fallback
- `getMaticBalance(address)` - Gets MATIC balance for gas
- `getUsdcAllowance(owner, spender)` - Gets current USDC allowance
- `encodeUsdcApproval(spender, amount?)` - Encodes USDC approval calldata
- `encodeSplitPosition(conditionId, amount)` - Encodes split position calldata
- `encodeMergePositions(conditionId, amount)` - Encodes merge positions calldata
- `approveUsdcForCtfFromSafe(safe)` - Approves USDC for CTF via Safe
- `ensureUsdcApprovalFromSafe(safe, address, amount)` - Ensures approval if needed
- `splitPositionFromSafe(safe, conditionId, amount)` - Splits USDC into YES+NO tokens via Safe
- `mergePositionsFromSafe(safe, conditionId, amount)` - Merges tokens back to USDC via Safe
- `approveAndSplitFromSafe(safe, address, conditionId, amount)` - Batched approve + split for efficiency
- `createSafeForCtf(config)` - Creates Safe instance for CTF operations

#### `src/utils/inventory.ts`
Inventory management utilities (uses Safe for CTF operations):
- `getInventoryStatus(client, market, address)` - Gets current USDC, YES, NO, MATIC balances
- `calculateRequirements(config, market)` - Calculates required token balances
- `analyzeDeficit(status, requirements)` - Determines if split is needed and how much
- `runPreFlightChecks(status, requirements, config)` - Validates inventory before starting
- `ensureSufficientInventory(client, safe, address, ...)` - Splits USDC via Safe if needed
- `mergeNeutralPosition(safe, conditionId, amount, dryRun)` - Merges YES+NO tokens back to USDC
- `formatInventoryStatus(status)` - Formats inventory for display

#### `src/utils/client.ts`
Read-only ClobClient factory:
- `ClobClientOptions` - Configuration interface (host, chain)
- `createClobClient(options?)` - Creates unauthenticated client for reading market data
- Supports optional parameters for testing/different environments

#### `src/utils/authClient.ts`
Authenticated ClobClient factory for trading:
- `SIGNATURE_TYPE` - Enum for Polymarket signature types (EOA, POLY_PROXY, POLY_GNOSIS_SAFE)
- `AuthClientConfig` - Configuration interface for authentication
- `createAuthenticatedClobClient(config?)` - Creates fully authenticated client
- Automatically derives API credentials on first use
- Supports optional parameters for testing/different environments

#### `src/utils/balance.ts`
USDC and conditional token balance utilities:
- `getUsdcBalance(client)` - Gets USDC (collateral) balance
- `getTokenBalance(client, tokenId)` - Gets balance for a specific token
- `getBalances(client, tokenIds)` - Gets USDC and multiple token balances
- `summarizeTokenBalances(balances)` - Creates summary for display
- `hasSufficientUsdc(client, amount)` - Checks if USDC balance is sufficient
- `hasSufficientTokens(client, tokenId, amount)` - Checks if token balance is sufficient

#### `src/utils/positions.ts`
Position tracking utilities:
- `getPosition(client, tokenId)` - Gets position for a single token
- `getPositions(client, tokenIds)` - Gets positions for multiple tokens
- `getMarketPosition(client, yesTokenId, noTokenId)` - Gets complete binary market position
- `getPositionsSummary(client, tokenIds)` - Gets summary with active position count
- `hasAnyPosition(client, tokenIds)` - Checks if any position exists
- `hasMinimumPosition(client, tokenId, minSize)` - Checks if position meets minimum

#### `src/utils/orders.ts`
Order placement and management utilities:
- `getMidpoint(client, tokenId)` - Fetches current midpoint with response parsing
- `parseMidpointResponse(response)` - Normalizes midpoint API response
- `placeOrder(client, params)` - Places a GTC limit order
- `cancelAllOrders(client)` - Cancels all open orders
- `cancelOrdersForToken(client, tokenId)` - Cancels orders for a specific token
- `cancelOrder(client, orderId)` - Cancels a specific order
- `getOpenOrders(client, tokenId?)` - Gets open orders

#### `src/utils/gamma.ts`
Gamma API utilities for fetching event and market metadata:
- `extractSlug(input)` - Extracts slug from URL or returns raw slug
- `parseMarketOutcomes(market)` - Parses outcome prices and token IDs
- `parseGammaMarket(market)` - Enhances market with parsed outcomes
- `fetchEventBySlug(slug, fetcher?)` - Fetches event data from Gamma API
- `fetchEventWithParsedMarkets(slugOrUrl)` - Fetches and parses event with all markets
- `fetchMarketRewardParams(tokenId, fetcher?)` - Fetches reward params for a token
- `fetchMarketsWithRewards(options?, fetcher?)` - Fetches markets with reward programs for ranking
  - Uses cursor-based pagination (`nextCursor`) to fetch all markets from API
  - Applies early filtering (liquidity compatibility, minSize) during fetch to reduce memory usage
  - Supports `onProgress` callback for progress reporting
  - **NegRisk handling:** Reads `neg_risk` field from rewards API response (defaults to `false` if not present)
- `fetchMarketRewardsInfo(conditionIds, fetcher?)` - Fetches market competitiveness and rate_per_day

#### `src/utils/markets.ts`
Market data utilities:
- `getYesOutcome(market)` - Gets the "Yes" outcome from a parsed market
- `getNoOutcome(market)` - Gets the "No" outcome from a parsed market
- `getYesProbability(market)` - Gets Yes probability (0-1)
- `sortMarketsByProbability(markets)` - Sorts markets by Yes probability
- `getMarketTitle(market)` - Gets market title (groupItemTitle or question)

#### `src/utils/orderbook.ts`
Order book fetching utilities:
- `FetchOrderBookOptions` - Options for batch fetching (batchSize, onProgress)
- `fetchOrderBookForMarket(client, market)` - Fetches order book for single market
- `fetchOrderBookData(client, markets, options?)` - Batch fetches order book data
- `sortOrderBookByProbability(data, markets)` - Sorts order book by probability
- `fetchRawOrderBook(tokenId, fetcher?)` - Fetches raw orderbook from CLOB API (no auth required)
- `fetchOrderBookWithCompetition(tokenId, midpoint, maxSpread, minSize)` - Fetches orderbook and calculates real Q score
- `fetchBatchCompetition(markets, options?)` - Batch fetches real competition for multiple markets

#### `src/utils/rewards.ts`
Reward calculation and eligibility checking:
- `calculateRewardScore(spread, maxSpread, size)` - Calculates quadratic reward score
- `calculateSpreadCents(price, midpoint)` - Calculates spread in cents
- `isTwoSidedRequired(midpoint)` - Checks if two-sided liquidity is required
- `calculateEffectiveScore(buyScore, sellScore, midpoint)` - Calculates effective score
- `calculateTotalQScore(bids, asks, midpoint, maxSpread)` - Calculates total Q_min from order book
- `calculateEarningPercentage(yourQMin, totalQMin)` - Calculates earning percentage
- `estimateDailyEarnings(rewardsDaily, competition, liquidity, spread, maxSpread)` - Estimates daily earnings for a given liquidity
- `calculateEarningPotential(rewardsDaily, competition, maxSpread, minSize, liquidity)` - Calculates earning potential score for ranking
- `calculateActualEarnings(client, params)` - Calculates actual earnings from placed orders
- `getMarketRewardParamsWithMidpoint(client, tokenId)` - Fetches params with midpoint
- `evaluateOrderReward(order, params)` - Evaluates single order reward status
- `checkOrdersRewardEligibility(orders, params)` - Checks orders for a token
- `checkAllOrdersRewardEligibility(client, orders)` - Checks all open orders

#### `src/utils/formatters.ts`
Output formatting utilities:
- `formatCurrency(value)` - Formats number as USD currency
- `formatPercent(price)` - Formats price as percentage
- `formatMarket(market, index)` - Formats a CLOB Market for console output
- `formatEventHeader(event)` - Formats Gamma event overview
- `formatGammaMarket(market, index)` - Formats a Gamma market with parsed data
- `formatMarketsSummaryTable(markets)` - Summary table sorted by probability
- `formatMarketsDetailed(markets)` - Detailed market data with token IDs
- `formatOrderBookTable(data)` - Formats order book pricing table
- `formatRewardResults(results)` - Formats reward check results
- `formatRewardResultsWithEarnings(results)` - Formats results with earning % comparison

#### `src/utils/helpers.ts`
Common helper utilities:
- `sleep(ms)` - Async sleep function
- `formatTimestamp(date?)` - Formats timestamp for logging
- `createLogger(prefix?)` - Creates a prefixed logger function
- `log(message)` - Simple timestamped logger
- `promptForInput(question)` - Prompts user for text input from stdin
- `promptForNumber(question, min, max)` - Prompts for validated numeric input

- `formatDuration(ms)` - Formats duration in milliseconds to human-readable (e.g., "2h 30m 15s")

#### `src/utils/marketDiscovery.ts`
Market discovery utilities for finding and ranking markets by earning potential:
- `discoverMarkets(options?)` - Main discovery function, fetches and ranks markets
- `findBestMarket(liquidity, options?)` - Convenience function to get single best market
- `rankMarketsByEarnings(markets, liquidity)` - Ranks markets by estimated daily earnings
- `fetchRealCompetition(markets, options?)` - Fetches real Q scores from orderbooks
- `getFirstTokenId(market)` - Extracts first token ID from clobTokenIds field

**NegRisk Market Filtering:** NegRisk markets (multi-outcome markets) are automatically filtered out during ranking due to signature compatibility issues with the current implementation. This requires testing and fixing to support NegRisk markets.

**Used by:** `findBestMarkets.ts` script and orchestrator

#### `src/utils/marketConfigGenerator.ts`
Utility to generate MarketParams from discovered markets:
- `generateMarketConfig(market, options?)` - Creates MarketParams from RankedMarketByEarnings
- `parseClobTokenIds(clobTokenIds)` - Parses token IDs from JSON array or comma-separated string
- `validateMarketParams(params)` - Validates all required fields
- `formatMarketConfig(params, question?)` - Human-readable config summary

**Used by:** Orchestrator to create market maker configs programmatically

#### `src/utils/websocket.ts`
Polymarket WebSocket manager for real-time market data:
- `PolymarketWebSocket` - WebSocket client class for real-time price updates
  - `connect()` - Connects to WebSocket server
  - `disconnect()` - Disconnects and cleans up
  - `subscribe(tokenIds)` - Subscribes to additional tokens
  - `unsubscribe(tokenIds)` - Unsubscribes from tokens
  - `getMidpoint(tokenId)` - Gets current midpoint for a token
  - `getState()` - Returns connection state
  - `isConnected()` - Returns true if connected
- `TrailingDebounce` - Utility for rate-limiting midpoint updates
  - `update(value, timestamp)` - Updates value, resets timer
  - `cancel()` - Cancels pending callback
  - `flush()` - Forces immediate callback execution
  - `getLatestValue()` - Returns latest value

**WebSocket Endpoint:** `wss://ws-subscriptions-clob.polymarket.com/ws/market`

**Features:**
- Auto-reconnect with exponential backoff (1s initial, 30s max)
- Ping/pong keep-alive every 10 seconds
- Midpoint calculation: `(best_bid + best_ask) / 2`
- Falls back to `last_trade_price` when spread > 10 cents
- Supports `best_bid_ask`, `price_change`, `book`, `last_trade_price` events
- **Token filtering:** Polymarket sends updates for both YES and NO tokens even when subscribing to only YES token; the WebSocket manager automatically filters out NO token updates to prevent confusion

#### `src/utils/userWebsocket.ts`
Authenticated WebSocket manager for user-specific events:
- `UserWebSocket` - WebSocket client for fill and order notifications
  - `connect()` - Connects and authenticates
  - `disconnect()` - Disconnects and cleans up
  - `isConnected()` - Returns connection status
- `TokenIdMapping` - Interface for YES/NO token ID mapping
- `tradeEventToFill(trade, tokenMapping, ourApiKey, orderLookup?)` - Converts WebSocket trade event to Fill type
- `OrderLookup` - Interface for looking up tracked order info (decouples from OrderTracker)

**WebSocket Endpoint:** `wss://ws-subscriptions-clob.polymarket.com/ws/user`

**Features:**
- Requires API credentials (apiKey, secret, passphrase)
- Real-time fill notifications for position tracking
- Auto-reconnect with exponential backoff
- Ping/pong keep-alive

**CRITICAL: Fill Attribution Logic:**
The Polymarket CLOB only maintains order books for YES tokens. NO token orders are internally converted:
- `BUY NO @ $0.58` → internally becomes `SELL YES @ $0.42` on the orderbook

When WebSocket trade events arrive, we use the `maker_orders` array AND the `OrderTracker` to correctly attribute fills:

1. **Check `maker_orders` first**: Each maker order has `owner` (API key), `outcome`, `price`, `matched_amount`
2. **If we're the maker** (our API key matches an entry in `maker_orders`):
   - Use that maker order's `outcome` to determine YES/NO token
   - **Use `OrderTracker` to get the original order side** - this is what WE placed (BUY or SELL)
   - Use the maker order's `price` and `matched_amount` for accurate fill details
   - Fallback: If order not found in tracker, infer side from taker (may be incorrect for old orders)
3. **If we're the taker** (our API key is NOT in `maker_orders`):
   - Use trade-level fields (`outcome`, `side`, `price`, `size`) directly (taker's perspective)

**Why OrderTracker is needed:** The taker's side has no relation to what we placed. If we placed
a `BUY YES` order, when it's filled we bought YES tokens, regardless of whether the taker was
buying or selling. The `OrderTracker` stores the original side when we place orders, ensuring
correct attribution.

#### `src/utils/orderTracker.ts`
Order ID tracking for correct fill attribution:
- `OrderTracker` - Class to track placed orders
  - `trackOrder(orderId, info)` - Records order details when placed
  - `getOrder(orderId)` - Retrieves order info by ID
  - `removeOrder(orderId)` - Removes order from tracking
  - `removeOrdersForToken(tokenId)` - Clears orders for a token
  - `clear()` - Clears all tracked orders
- `TrackedOrder` - Interface for tracked order info (tokenId, tokenType, side, price, size, placedAt)
- `getOrderTracker()` - Gets global tracker instance
- `resetOrderTracker()` - Resets global tracker (for testing)

**Purpose:** When placing orders, we track which token (YES/NO) and side (BUY/SELL) each order was placed for.
This is **essential** for correct fill attribution - we use the tracked `side` to know what we actually
did (bought or sold), rather than incorrectly inferring from the taker's perspective.

#### `src/utils/storage.ts`
JSON file persistence for position tracking data:
- `loadMarketState(conditionId)` - Loads persisted state from disk (handles v1→v2 migration)
- `saveMarketState(state)` - Saves state to disk
- `createEmptyState(conditionId, yesTokenId, noTokenId)` - Creates new state with initialized economics
- `appendFill(conditionId, yesTokenId, noTokenId, fill)` - Appends a fill
- `setInitialPosition(conditionId, yesTokenId, noTokenId, yes, no)` - Sets initial position
- `rebuildEconomicsFromFills(fills, yesTokenId)` - Rebuilds FillEconomics from fill history
- `saveEconomics(conditionId, yesTokenId, noTokenId, economics)` - Updates economics in state

**Storage Location:** `./data/fills-{conditionId}.json`

**Schema Version:** 2 (auto-migrates from v1 by rebuilding economics)

**Schema Migration Requirements:**
When modifying `PersistedMarketState`:
1. Increment `PERSISTED_STATE_VERSION` in `src/types/fills.ts`
2. Add migration logic in `loadMarketState()` in `src/utils/storage.ts`
3. Test with existing data files before deploying
4. Document version changes in storage.ts header comment

#### `src/utils/positionTracker.ts`
Position tracking for market making strategies with P&L economics:
- `PositionTracker` - Class for tracking YES/NO positions, limits, and P&L
  - `initialize(yesBalance, noBalance)` - Initialize from current balances, returns `needsCostBasis` flag
  - `processFill(fill)` - Process a fill, update position and economics
  - `processMerge(mergedAmount)` - Process a merge, adjust position and economics proportionally
  - `canQuoteBuy()` - Check if BUY side is allowed
  - `canQuoteSell()` - Check if SELL side is allowed
  - `getPositionState()` - Get current position state (includes `neutralPosition`)
  - `getNetExposure()` - Get net exposure (yesTokens - noTokens)
  - `getLimitStatus()` - Get limit utilization status
  - `formatStatus()` - Format position for display
  - **P&L Methods:**
  - `getAverageCost(tokenType)` - Get weighted average cost per token type
  - `getUnrealizedPnL(midpoint)` - Mark-to-market P&L
  - `getRealizedPnL()` - Accumulated realized P&L from sells
  - `getTotalPnL(midpoint)` - Unrealized + realized P&L
  - `getEconomics()` - Get raw FillEconomics data
  - `formatPnLStatus(midpoint)` - Detailed P&L display (on fills)
  - `formatPnLCompact(midpoint)` - Compact P&L display (on rebalance)
  - `setInitialCostBasis(yesCost, noCost)` - Set cost basis for pre-existing tokens
  - `needsInitialCostBasis()` - Check if cost basis input is needed
- `createPositionTracker(conditionId, yesTokenId, noTokenId, maxNetExposure)` - Factory function

**Dust Balance Threshold:** The tracker uses a 0.1 token threshold to determine if cost basis is needed. Balances below 0.1 tokens are considered "dust" and ignored to prevent prompting for cost basis on negligible pre-existing positions.

**Position Limits:**
- Net exposure = yesTokens - noTokens
- Positive = long YES, Negative = long NO
- Blocks BUY when exposure >= maxNetExposure
- Blocks SELL when exposure <= -maxNetExposure

**Neutral Position (Mergeable):**
- Neutral position = min(yesTokens, noTokens)
- Represents market-neutral tokens that can be merged back to USDC
- Auto-merge frees locked capital for continued trading

**P&L Calculation:**
- Uses weighted average cost basis
- Unrealized P&L: `position × (currentPrice - avgCost)`
- Realized P&L: Accumulated when selling at `(salePrice - avgCost) × size`
- **On merge:** Economics adjusted proportionally (cost basis reduced by merged ratio)

### `src/scripts/`
Directory for executable utility scripts. Each script should:
- Import utilities from `@/utils/*` using path aliases
- Handle errors gracefully with proper exit codes
- Be thin orchestration only (no business logic)
- Log meaningful output for debugging

#### `src/scripts/getMarkets.ts`
Fetches and displays all markets from the Polymarket CLOB API:
- Uses `@polymarket/clob-client` to connect to production CLOB
- Displays markets in human-readable format with labels
- Shows question, condition ID, status, outcomes, and descriptions

#### `src/scripts/getEvent.ts`
Fetches detailed event data by slug or URL:
- Accepts event slug (e.g., `uefa-champions-league-winner`) or full URL
- Fetches event metadata from Gamma API
- Displays event overview (title, volume, liquidity, description)
- Shows all markets (outcomes) sorted by probability
- Fetches order book data (bid/ask/spread) from CLOB API
- Displays condition IDs and token IDs needed for trading

#### `src/scripts/checkRewards.ts`
Checks if open orders are eligible for liquidity rewards:
- Fetches all open orders for the authenticated wallet
- Uses shared reward utilities for eligibility checking
- Displays formatted results with scores and eligibility status

#### `src/scripts/selectMarket.ts`
Generates market maker configuration from an event slug:
- Accepts event slug or full URL
- Fetches event data from Gamma API
- Lists all valid binary markets with Yes/No outcomes
- Outputs TypeScript configuration for `config.ts`
- Usage: `npm run selectMarket -- <event-slug> [market-index]`

#### `src/scripts/findBestMarkets.ts`
Finds the highest-earning markets for liquidity rewards:
- Fetches active markets with reward programs from Polymarket rewards API
- **Fetches real orderbook data** to calculate actual competition (Q scores)
  - Note: The API's `market_competitiveness` field is often stale/inaccurate
  - Real competition is calculated from live orderbook using `fetchBatchCompetition`
- Calculates estimated daily earnings based on:
  - `rewardsDaily` - Total daily reward pool for the market
  - `competitive` - Market competitiveness (real Q score from orderbook)
  - Polymarket's quadratic reward formula: `Q = ((maxSpread - spread) / maxSpread)² × size`
- Ranks markets by earning potential per $100 liquidity (configurable)
- Shows APY equivalent and ease of participation metrics
- Supports `--json`, `--details`, `--limit`, `--max-size`, `--liquidity` options
- Usage: `npm run findBestMarkets` or `npm run findBestMarkets -- --liquidity 500`

#### `src/scripts/orchestrate.ts`
Entry point for the market maker orchestrator:
- Thin wrapper that calls `main()` from `@/strategies/orchestrator/index.ts`
- Parses CLI arguments for configuration
- Usage: `npm run orchestrate` (see orchestrator section for full options)

### `src/strategies/`
Directory for automated trading strategies. Each strategy should:
- Have its own subdirectory with `index.ts`, `config.ts`, `types.ts`
- Use shared utilities from `@/utils/*`
- Have configurable parameters in `config.ts`

#### `src/strategies/orchestrator/`
Automatic market selection and switching orchestrator.

**Purpose:** Automatically maximizes liquidity rewards by:
1. Finding the best market based on earning potential
2. Running the market maker continuously
3. Periodically re-evaluating markets (every N minutes)
4. When a better market is found, setting a "pending switch"
5. When position becomes neutral AND pending switch exists, executing the switch

**Files:**
- `index.ts` - Main orchestrator loop and CLI entry point
- `config.ts` - Orchestrator configuration (`OrchestratorConfig`, defaults, CLI parsing)
- `types.ts` - Orchestrator types (`OrchestratorState`, `PendingSwitch`, `SwitchDecision`, events)

**Key Features:**
- Uses `findBestMarket()` from `@/utils/marketDiscovery.ts`
- Uses `generateMarketConfig()` from `@/utils/marketConfigGenerator.ts`
- **Actual earnings comparison**: Uses `calculateActualEarnings()` to compare real performance vs estimated potential
- **Periodic re-evaluation** with configurable interval (default 5 minutes)
- **Pending switch pattern**: Better market sets flag, switch executes when neutral
- Configurable switching threshold (default 20% improvement required)
- Log-only mode for safe testing (default: no real switching)
- Session summary with cumulative stats on shutdown

**Switching Logic:**
- Uses **actual earnings** from placed orders when available (not just estimates)
- Falls back to estimated earnings if no orders are placed
- Compares actual current vs estimated candidate (conservative approach)
- Neutral position ENABLES switching but doesn't TRIGGER it
- Finding a better market TRIGGERS the pending switch flag
- Switch executes only when BOTH: pending switch exists AND position is neutral

**Usage:**
```bash
npm run orchestrate                          # Dry run, log switching decisions
npm run orchestrate -- --liquidity 200       # Custom liquidity amount
npm run orchestrate -- --threshold 0.15      # 15% improvement threshold
npm run orchestrate -- --re-evaluate-interval 10  # Check every 10 minutes
npm run orchestrate -- --enable-switching    # Enable market switching (still dry run)
npm run orchestrate -- --enable-switching --no-dry-run  # Full live mode
```

**Flow Diagram:**
```
STARTUP → find best market → MARKET_MAKING
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
        [periodic timer]                           [fills occur]
              │                                         │
        re-evaluate markets                    check onCheckPendingSwitch
              │                                         │
        if better market:                     if pendingSwitch && neutral:
        set pendingSwitch                            SWITCH
              │                                         │
              └────────────────────┬────────────────────┘
                                   │
                              MARKET_MAKING (or new market)
```

#### `src/strategies/marketMaker/`
Market maker bot for earning Polymarket liquidity rewards.

> **Full documentation:** [docs/strategies/market-maker.md](docs/strategies/market-maker.md)

**Files:**
- `index.ts` - Main entry point (thin orchestrator)
- `config.ts` - Strategy configuration (edit this to set your market!)
- `types.ts` - Strategy-specific types (`MergeConfig`, `WebSocketConfig`, `PositionLimitsConfig`, `SessionStats`)
- `quoter.ts` - Quote generation logic
- `lifecycle.ts` - Startup/shutdown handlers, config validation, banner printing, merge check, session summary
- `executor.ts` - Order placement and cancellation
- `modes/` - Execution mode implementations (WebSocket and polling)

**Auto-Merge Feature:**
When the bot accumulates both YES and NO tokens (neutral position), it automatically
merges them back to USDC before placing new orders. This frees up locked capital
for continued trading.

Configuration in `config.ts`:
```typescript
merge: {
  enabled: true,        // Enable automatic merging
  minMergeAmount: 0,    // Merge any neutral position (0 = any amount)
}
```

Merge lifecycle:
1. At start of each rebalance cycle, check if `neutralPosition > minMergeAmount`
2. If yes, execute merge via Safe (CTF `mergePositions`)
3. Update PositionTracker economics (proportional cost reduction)
4. Continue with normal quote placement

**Session Statistics:**
The bot tracks session statistics and displays a summary on shutdown:
- Duration, cycle count, fills, volume traded
- Orders placed and cancelled
- Merge operations performed and USDC freed

Example shutdown summary:
```
============================================================
  SESSION SUMMARY
============================================================
  Duration: 2h 15m 30s
  Cycles: 450
------------------------------------------------------------
  TRADING:
    Fills: 24
    Volume: $1,234.56
    Orders Placed: 892
    Orders Cancelled: 888
------------------------------------------------------------
  MERGE OPERATIONS:
    Merges: 8
    USDC Freed: $456.78
============================================================
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FUNDER_PUBLIC_KEY` | Yes | Public key for the funder wallet |
| `FUNDER_PRIVATE_KEY` | Yes | Private key for the funder wallet (signer) |
| `POLYMARKET_PROXY_ADDRESS` | Yes | Polymarket proxy wallet address (Gnosis Safe) |
| `POLYGON_RPC_URL` | No | Custom Polygon RPC URL (defaults to public RPC) |

## Path Aliases
The project uses TypeScript path aliases:
- `@/*` maps to `src/*`

## Running Scripts
```bash
# Utility scripts
npm run getMarkets                                    # Fetch and display all markets
npm run getEvent -- uefa-champions-league-winner      # Fetch event by slug
npm run getEvent -- https://polymarket.com/event/...  # Fetch event by URL
npm run checkRewards                                  # Check if orders are earning rewards
npm run selectMarket -- <event-slug>                  # List markets in an event
npm run selectMarket -- <event-slug> 0                # Generate config for market index 0
npm run findBestMarkets                               # Find top reward markets
npm run findBestMarkets -- --details 1                # Show details for top market

# Trading strategies
npm run marketMaker                                   # Run market maker bot (configure first!)
npm run orchestrate                                   # Run orchestrator (auto market selection)
npm run orchestrate -- --help                         # Show orchestrator options
```

## APIs Used

### CLOB API (`https://clob.polymarket.com`)
Central Limit Order Book API for trading operations:
- Market prices, order book data
- Order placement and management
- Trade execution

### CLOB WebSocket (`wss://ws-subscriptions-clob.polymarket.com`)
Real-time market data via WebSocket:
- Order book snapshots and updates
- Best bid/ask updates
- Last trade price notifications
- Market channel (public): `/ws/market`
- User channel (authenticated): `/ws/user`

### Gamma API (`https://gamma-api.polymarket.com`)
Metadata API for events and markets:
- Event data (title, description, volume, liquidity)
- Associated markets (outcomes)
- Reward parameters (minSize, maxSpread)
- Categories and tags

## Dependencies

### Production
- `dotenv` - Environment variable loading
- `@polymarket/clob-client` - Official Polymarket CLOB API client
- `@safe-global/protocol-kit` - Safe (Gnosis Safe) SDK for transaction execution
- `@safe-global/types-kit` - TypeScript types for Safe SDK
- `ws` - WebSocket client for real-time market data
- `ethers` (via @ethersproject/*) - Ethereum library for contract encoding
  - `@ethersproject/abi` - ABI encoding for contract calls
  - `@ethersproject/contracts` - Contract interaction for read operations
  - `@ethersproject/providers` - Polygon RPC provider
  - `@ethersproject/units` - Unit conversion (parseUnits, formatUnits)

### Development
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution
- `@types/node` - Node.js type definitions

## Design Principles

### Safe (Gnosis Safe) Transaction Execution
Polymarket uses Gnosis Safe wallets (proxy wallets) for trading. The `POLYMARKET_PROXY_ADDRESS`
environment variable is the Safe account address, and `FUNDER_PRIVATE_KEY` is the owner/signer.

**Critical:** All on-chain CTF operations (split, merge, approve) MUST be executed through the
Safe account, not directly from the private key. This ensures:
- Transactions come from the correct wallet (the proxy address shown in Polymarket UI)
- Token balances are correctly attributed to the trading account
- Orders placed via CLOB API match the wallet holding the tokens

The Safe SDK (`@safe-global/protocol-kit`) handles:
1. Creating Safe transactions with proper encoding
2. Signing with the owner's private key
3. Executing transactions on-chain from the Safe account

### Testability
- All utility functions accept optional parameters with production defaults
- API fetch functions accept optional `fetcher` parameter for mocking
- Client factories accept optional configuration for testing

### DRY (Don't Repeat Yourself)
- Common calculations extracted to shared utilities (e.g., reward scoring)
- Market data helpers prevent duplicate outcome finding logic
- Formatters centralized for consistent output

### Thin Scripts
- Scripts only orchestrate utilities, no business logic
- All types defined in `src/types/`
- All utilities in `src/utils/`

---
*Last updated: 2026-01-21 - Documented WebSocket token filtering, 0.1 dust threshold, and NegRisk market exclusion*
