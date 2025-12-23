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
│   │   └── index.ts      # CLOB API host and chain settings
│   ├── scripts/          # Executable trading scripts
│   │   └── getMarkets.ts # Fetches and displays all Polymarket markets
│   ├── types/            # Shared TypeScript type definitions
│   │   └── polymarket.ts # Custom types not exported by @polymarket/clob-client
│   └── utils/            # Shared utility modules
│       ├── client.ts     # ClobClient factory
│       ├── env.ts        # Environment variable management
│       └── formatters.ts # Output formatting utilities
├── .env                  # Environment variables (not committed)
├── .env.example          # Example environment template
├── package.json          # Project configuration
└── tsconfig.json         # TypeScript configuration
```

## Key Modules

### `src/config/index.ts`
Application configuration constants:
- `config.clobHost` - Production CLOB API URL (`https://clob.polymarket.com`)
- `config.chain` - Polygon mainnet chain (`Chain.POLYGON`)

### `src/types/`
Shared TypeScript type definitions. Types are organized by source:
- **Library types**: Import directly from `@polymarket/clob-client` (e.g., `Token`, `Chain`, `PaginationPayload`)
- **Custom types**: Defined in `src/types/` when not exported by the library

#### `src/types/polymarket.ts`
Custom types for Polymarket API responses not exported by `@polymarket/clob-client`:
- `Market` - Market data structure from CLOB API
- `MarketsResponse` - Paginated markets response (extends `PaginationPayload`)

### `src/utils/env.ts`
Environment variable management module providing:
- `getEnvRequired(key)` - Get required env var or throw
- `getEnvOptional(key, default)` - Get optional env var with fallback
- `env` object - Typed environment configuration

### `src/utils/client.ts`
ClobClient factory module:
- `createClobClient()` - Creates a configured ClobClient instance using settings from `src/config`

### `src/utils/formatters.ts`
Output formatting utilities:
- `formatMarket(market, index)` - Formats a Market object for human-readable console output

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
npm run getMarkets  # Fetch and display all Polymarket markets
```

## Dependencies

### Production
- `dotenv` - Environment variable loading
- `@polymarket/clob-client` - Official Polymarket CLOB API client

### Development
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution
- `@types/node` - Node.js type definitions

---
*Last updated: Abstracted config, client factory, and formatters*
