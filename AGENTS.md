# OpenCode Rules for Polymarket Trader

## Architecture Documentation Rule

**CRITICAL**: At the start of EVERY session, you MUST read the `ARCHITECTURE.md` file to understand the current application architecture and context.

### On Session Start
1. Always read `ARCHITECTURE.md` first to understand:
   - Current project structure
   - Key modules and their responsibilities
   - Data flow and dependencies
   - Any architectural decisions or constraints

### On Making Changes
Whenever you make changes that affect the application architecture, you MUST update `ARCHITECTURE.md` to reflect:

1. **New files or modules** - Add them to the appropriate section with a brief description
2. **New dependencies** - Document any new packages added and their purpose
3. **Structural changes** - Update the project structure if directories are added/removed
4. **New patterns or conventions** - Document any new coding patterns introduced
5. **API changes** - Update endpoint documentation if applicable
6. **Configuration changes** - Note any new environment variables or config options

### What Constitutes an Architectural Change
- Adding new source files or directories
- Creating new modules or services
- Adding external dependencies
- Changing the data flow between components
- Adding new API endpoints or routes
- Modifying the build or deployment configuration
- Adding new environment variables

### Format Guidelines
Keep the `ARCHITECTURE.md` file:
- Concise but comprehensive
- Up-to-date with every architectural change
- Organized by logical sections
- Including file paths for easy reference

## TypeScript Type Usage Rule

**PRIORITY**: Always prefer library-exported types over custom type definitions.

### When Adding Types
1. **Check library types first** - Before defining a custom interface or type, check if the library (e.g., `@polymarket/clob-client`) already exports it
2. **Use library types when available** - Import and use types directly from the library (e.g., `Token`, `Chain`, `PaginationPayload`)
3. **Extend library types when partial** - If the library type is incomplete, extend it rather than redefining (e.g., `interface MarketsResponse extends Omit<PaginationPayload, "data">`)
4. **Create custom types only when necessary** - Only define custom types when the library doesn't export them at all
5. **Abstract custom types for reuse** - Place custom types in `src/types/` for reusability across scripts

### Where to Define Custom Types
- **Reusable types**: `src/types/*.ts` - Types used across multiple files
- **Script-specific types**: Only if truly single-use and simple

### Documentation
- Add a comment explaining why a custom type was needed (e.g., "Not exported by @polymarket/clob-client")

## Code Abstraction and DRY Rule

**PRIORITY**: Always abstract reusable code and follow the DRY (Don't Repeat Yourself) principle.

### Before Writing New Code
1. **Search existing utilities first** - Before writing new functionality, check if similar utilities already exist in:
   - `src/utils/` - Shared utility functions
   - `src/config/` - Configuration constants
   - `src/types/` - Type definitions
2. **Check library exports** - The library may already provide the functionality you need
3. **Reuse existing code** - Import and use existing utilities rather than duplicating logic

### When Writing New Code
1. **Abstract configuration** - Move hardcoded values (URLs, chains, constants) to `src/config/`
2. **Abstract utilities** - Extract reusable functions to `src/utils/`:
   - Client factories (e.g., `createClobClient()`)
   - Formatters (e.g., `formatMarket()`)
   - Helpers and common operations
3. **Abstract types** - Place reusable types in `src/types/`
4. **Keep scripts thin** - Scripts in `src/scripts/` should primarily orchestrate utilities, not contain business logic

### Abstraction Guidelines
- **Single Responsibility**: Each utility should do one thing well
- **Meaningful Names**: Function and file names should clearly describe their purpose
- **Documentation**: Add JSDoc comments for exported functions
- **Testability**: Abstracted code is easier to test in isolation

## Keep Scripts Thin Rule

**PRIORITY**: Scripts in `src/scripts/` should be thin orchestration layers only.

### What Belongs in Scripts
- Import statements for utilities
- Configuration/setup (creating clients, parsing args)
- Orchestrating utility calls
- Console output for user feedback
- Error handling at the top level

### What Does NOT Belong in Scripts
- Business logic (move to `src/utils/`)
- Type definitions (move to `src/types/`)
- Data transformation functions (move to `src/utils/formatters.ts`)
- API fetching logic (move to `src/utils/gamma.ts` or dedicated util)
- Helper functions like `sleep()`, `log()` (use `src/utils/helpers.ts`)

### Script Size Guideline
- Ideal: < 100 lines
- Maximum: ~150 lines
- If a script exceeds 150 lines, refactor logic into utilities

## No Direct fetch() in Scripts Rule

**PRIORITY**: Never use `fetch()` directly in script files.

### Why
- Direct fetch calls are hard to test (can't mock)
- Duplicates error handling logic
- Makes scripts harder to maintain

### What to Do Instead
1. Create a utility function in `src/utils/` (e.g., `gamma.ts`, `orderbook.ts`)
2. Accept an optional `fetcher` parameter for testability
3. Import and use the utility in your script

### Example Pattern
```typescript
// In src/utils/gamma.ts
export async function fetchMarketData(
  slug: string,
  fetcher: typeof fetch = fetch  // Allows mocking in tests
): Promise<MarketData> {
  const response = await fetcher(`${GAMMA_API_URL}/markets/${slug}`);
  return response.json();
}

// In src/scripts/getMarket.ts
import { fetchMarketData } from "../utils/gamma";
const data = await fetchMarketData(slug);
```

## Dependency Injection for Testability Rule

**PRIORITY**: Core utilities should accept dependencies as optional parameters.

### When to Apply
- Functions that make HTTP requests
- Functions that use environment variables
- Functions that create clients with external dependencies

### Pattern
```typescript
// Good: Accepts optional config with defaults
export function createClobClient(options?: ClobClientOptions): ClobClient {
  return new ClobClient(
    options?.host ?? CLOB_API_URL,
    options?.chain ?? Chain.POLYGON,
    // ...
  );
}

// Good: Accepts optional fetcher for testing
export async function fetchEventBySlug(
  slug: string,
  fetcher: typeof fetch = fetch
): Promise<GammaEvent | null> {
  // ...
}
```

### Default Behavior
- Always provide sensible defaults (from `src/config/` or `src/utils/env.ts`)
- Maintain backward compatibility - existing code shouldn't break

## Common Utilities Extraction Triggers

When you see any of these patterns, extract to a utility:

| Pattern | Extract To |
|---------|-----------|
| `await sleep(ms)` or `setTimeout` wrapper | `src/utils/helpers.ts` |
| Timestamp formatting | `src/utils/helpers.ts` |
| Console logging with prefixes | `src/utils/helpers.ts` |
| `fetch()` calls to external APIs | `src/utils/gamma.ts` or dedicated util |
| Market data access (`.outcomes`, `.outcomePrices`) | `src/utils/markets.ts` |
| Order book fetching/formatting | `src/utils/orderbook.ts` |
| Reward calculations | `src/utils/rewards.ts` |
| Price/currency/percent formatting | `src/utils/formatters.ts` |
| Client creation | `src/utils/client.ts` or `authClient.ts` |

## Testing Patterns

### Structure for Testable Code
1. **Pure functions** - Functions that don't depend on external state are easiest to test
2. **Dependency injection** - Pass dependencies as parameters with defaults
3. **Small, focused functions** - Each function should do one thing
4. **Separate I/O from logic** - Keep data fetching separate from data processing

### Mocking External Dependencies
```typescript
// Test file example
import { fetchEventBySlug } from "../utils/gamma";

const mockFetcher = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ /* mock data */ })
});

const result = await fetchEventBySlug("test-event", mockFetcher);
expect(mockFetcher).toHaveBeenCalledWith(expect.stringContaining("test-event"));
```

### What Should Be Testable
- All functions in `src/utils/`
- Strategy logic in `src/strategies/`
- Type guards and validators
