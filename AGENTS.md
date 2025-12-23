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
