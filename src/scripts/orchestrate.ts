/**
 * Orchestrator entry point script.
 *
 * Run with: npm run orchestrate
 */

import { main } from "@/strategies/orchestrator/index.js";

main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
