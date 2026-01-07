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
│   │       ├── index.ts  # Main entry point and runner loop
│   │       ├── config.ts # Strategy configuration (edit this!)
│   │       ├── types.ts  # Strategy-specific types
│   │       └── quoter.ts # Quote generation logic
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
- `MarketWithRewards` - Market with reward parameters for ranking
- `MarketAttractivenessScore` - Score breakdown for market attractiveness
- `RankedMarket` - Market with calculated attractiveness score

#### `src/types/strategy.ts`
Shared types for trading strategies:
- `StrategyConfig` - Base configuration for any strategy
- `MarketParams` - Market parameters required for trading (yesTokenId, noTokenId, conditionId, tickSize, negRisk, etc.)

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

#### `src/utils/rewards.ts`
Reward calculation and eligibility checking:
- `calculateRewardScore(spread, maxSpread, size)` - Calculates quadratic reward score
- `calculateSpreadCents(price, midpoint)` - Calculates spread in cents
- `isTwoSidedRequired(midpoint)` - Checks if two-sided liquidity is required
- `calculateEffectiveScore(buyScore, sellScore, midpoint)` - Calculates effective score
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

#### `src/utils/helpers.ts`
Common helper utilities:
- `sleep(ms)` - Async sleep function
- `formatTimestamp(date?)` - Formats timestamp for logging
- `createLogger(prefix?)` - Creates a prefixed logger function
- `log(message)` - Simple timestamped logger

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
Finds the highest-paying markets for liquidity rewards:
- Fetches active markets with reward programs from Gamma API
- Calculates attractiveness score based on:
  - `rewardsMaxSpread` - Higher = more forgiving spread requirements
  - `rewardsMinSize` - Lower = easier to participate
  - `liquidityNum` - Higher = more stable market
  - `competitive` - Lower = less competition
- Ranks and displays top markets in a table
- Supports `--json`, `--details`, `--limit`, `--min-liquidity` options
- Usage: `npm run findBestMarkets` or `npm run findBestMarkets -- --details 1`

### `src/strategies/`
Directory for automated trading strategies. Each strategy should:
- Have its own subdirectory with `index.ts`, `config.ts`, `types.ts`
- Use shared utilities from `@/utils/*`
- Have configurable parameters in `config.ts`

#### `src/strategies/marketMaker/`
Market maker bot for earning Polymarket liquidity rewards.

> **Full documentation:** [docs/strategies/market-maker.md](docs/strategies/market-maker.md)

**Files:**
- `index.ts` - Main entry point and runner loop
- `config.ts` - Strategy configuration (edit this to set your market!)
- `types.ts` - Strategy-specific types (MarketMakerConfig, ActiveQuotes, etc.)
- `quoter.ts` - Quote generation logic using shared reward utilities

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
```

## APIs Used

### CLOB API (`https://clob.polymarket.com`)
Central Limit Order Book API for trading operations:
- Market prices, order book data
- Order placement and management
- Trade execution

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
*Last updated: Migrated CTF operations to Safe SDK for proper Gnosis Safe transaction execution*
