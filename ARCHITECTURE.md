# Polymarket Trader - Architecture

## Overview
TypeScript-based trading scripts for Polymarket. This project provides utilities and scripts for interacting with the Polymarket platform.

## Tech Stack
- **Runtime**: Node.js with ESM modules
- **Language**: TypeScript 5.7+
- **Script Runner**: tsx
- **Environment Management**: dotenv

## Project Structure

```
polymarket-trader/
├── src/
│   ├── config/           # Application configuration
│   │   └── index.ts      # CLOB and Gamma API hosts, chain settings
│   ├── scripts/          # Executable trading scripts
│   │   ├── getMarkets.ts # Fetches and displays all Polymarket markets
│   │   └── getEvent.ts   # Fetches detailed event data by slug/URL
│   ├── types/            # Shared TypeScript type definitions
│   │   ├── polymarket.ts # Custom types for CLOB API responses
│   │   └── gamma.ts      # Types for Gamma API (events, markets metadata)
│   └── utils/            # Shared utility modules
│       ├── client.ts     # ClobClient factory
│       ├── env.ts        # Environment variable management
│       ├── formatters.ts # Output formatting utilities
│       └── gamma.ts      # Gamma API utilities (fetch events, parse markets)
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

### `src/types/`
Shared TypeScript type definitions. Types are organized by source:
- **Library types**: Import directly from `@polymarket/clob-client` (e.g., `Token`, `Chain`, `PaginationPayload`)
- **Custom types**: Defined in `src/types/` when not exported by the library

#### `src/types/polymarket.ts`
Custom types for Polymarket CLOB API responses not exported by `@polymarket/clob-client`:
- `Market` - Market data structure from CLOB API
- `MarketsResponse` - Paginated markets response (extends `PaginationPayload`)

#### `src/types/gamma.ts`
Types for Polymarket Gamma API responses (event and market metadata):
- `GammaEvent` - Event data with title, volume, liquidity, associated markets
- `GammaMarket` - Market within an event (outcome, prices, condition IDs)
- `GammaToken` - Token data within a market
- `ParsedGammaMarket` - Market with parsed outcome data ready for display
- `ParsedGammaEvent` - Event with parsed market data
- `ParsedOutcome` - Parsed outcome with price and token ID for trading

### `src/utils/env.ts`
Environment variable management module providing:
- `getEnvRequired(key)` - Get required env var or throw
- `getEnvOptional(key, default)` - Get optional env var with fallback
- `env` object - Typed environment configuration

### `src/utils/client.ts`
ClobClient factory module:
- `createClobClient()` - Creates a configured ClobClient instance using settings from `src/config`

### `src/utils/gamma.ts`
Gamma API utilities for fetching event and market metadata:
- `extractSlug(input)` - Extracts slug from URL or returns raw slug
- `parseMarketOutcomes(market)` - Parses outcome prices and token IDs
- `parseGammaMarket(market)` - Enhances market with parsed outcomes
- `fetchEventBySlug(slug)` - Fetches event data from Gamma API
- `fetchEventWithParsedMarkets(slugOrUrl)` - Fetches and parses event with all markets

### `src/utils/formatters.ts`
Output formatting utilities:
- `formatMarket(market, index)` - Formats a CLOB Market for console output
- `formatEventHeader(event)` - Formats Gamma event overview
- `formatGammaMarket(market, index)` - Formats a Gamma market with parsed data
- `formatMarketsSummaryTable(markets)` - Summary table sorted by probability
- `formatMarketsDetailed(markets)` - Detailed market data with token IDs

### `src/scripts/`
Directory for executable trading scripts. Each script should:
- Import utilities from `@/utils/*` using path aliases
- Handle errors gracefully with proper exit codes
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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FUNDER_PUBLIC_KEY` | Yes | Public key for the funder wallet |
| `FUNDER_PRIVATE_KEY` | Yes | Private key for the funder wallet |

## Path Aliases
The project uses TypeScript path aliases:
- `@/*` maps to `src/*`

## Running Scripts
```bash
npm run getMarkets                                    # Fetch and display all markets
npm run getEvent -- uefa-champions-league-winner      # Fetch event by slug
npm run getEvent -- https://polymarket.com/event/...  # Fetch event by URL
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
- Categories and tags

## Dependencies

### Production
- `dotenv` - Environment variable loading
- `@polymarket/clob-client` - Official Polymarket CLOB API client

### Development
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution
- `@types/node` - Node.js type definitions

---
*Last updated: Added Gamma API integration, getEvent script, and event/market types*
