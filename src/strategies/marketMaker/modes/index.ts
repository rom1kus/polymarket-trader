/**
 * Market Maker Modes - Runner implementations for different execution modes.
 */

export { runWithWebSocket, type WebSocketRunnerContext } from "./websocket.js";
export { runWithPolling, type PollingRunnerContext } from "./polling.js";

// Re-export result type for orchestrator
export type { MarketMakerResult, OrchestratableMarketMakerConfig } from "../types.js";
