# Polymarket Trader

TypeScript scripts for interacting with the Polymarket platform.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your wallet credentials:
   - `FUNDER_PUBLIC_KEY` - Your wallet public key
   - `FUNDER_PRIVATE_KEY` - Your wallet private key

## Usage

### Fetch All Markets
```bash
npm run getMarkets
```

### Fetch Event Details
```bash
# By slug
npm run getEvent -- uefa-champions-league-winner

# By URL
npm run getEvent -- https://polymarket.com/event/slug/uefa-champions-league-winner
```

## Project Structure

```
src/
├── config/       # API hosts and chain configuration
├── scripts/      # Executable scripts
├── types/        # TypeScript type definitions
└── utils/        # Shared utilities (client, formatters, etc.)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation.

## License

MIT
