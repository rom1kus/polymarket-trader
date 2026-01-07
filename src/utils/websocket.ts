/**
 * Polymarket WebSocket Manager.
 *
 * Provides real-time market data via WebSocket connection to Polymarket's
 * CLOB WebSocket API. Handles connection management, reconnection with
 * exponential backoff, ping/pong keep-alive, and midpoint calculation.
 *
 * WebSocket endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 *
 * @example
 * ```typescript
 * const ws = new PolymarketWebSocket({
 *   tokenIds: ["12345..."],
 *   onMidpointUpdate: (tokenId, midpoint, timestamp) => {
 *     console.log(`Midpoint for ${tokenId}: ${midpoint}`);
 *   },
 *   onConnected: () => console.log("Connected!"),
 *   onDisconnected: () => console.log("Disconnected!"),
 * });
 *
 * await ws.connect();
 * // ... later
 * ws.disconnect();
 * ```
 */

import WebSocket from "ws";
import type {
  WebSocketState,
  WebSocketManagerOptions,
  TokenPriceState,
  MarketSubscriptionMessage,
  MarketEvent,
  BestBidAskEvent,
  LastTradePriceEvent,
  PriceChangeEvent,
  BookEvent,
} from "@/types/websocket.js";

/** WebSocket endpoint for market channel */
const WS_MARKET_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

/** Default configuration values */
const DEFAULTS = {
  reconnectDelayMs: 1000,
  maxReconnectDelayMs: 30000,
  pingIntervalMs: 10000,
  maxSpreadForMidpoint: 0.10,
};

/**
 * Polymarket WebSocket manager for real-time market data.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Ping/pong keep-alive every 10 seconds
 * - Midpoint calculation from best_bid_ask or book events
 * - Fallback to last_trade_price when spread > 10 cents
 * - Event callbacks for connection state changes
 */
export class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private state: WebSocketState = "disconnected";
  private options: Required<WebSocketManagerOptions>;

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Keep-alive
  private pingTimer: NodeJS.Timeout | null = null;

  // Price state per token
  private tokenState: Map<string, TokenPriceState> = new Map();

  // Track if we should attempt reconnection
  private shouldReconnect = true;

  constructor(options: WebSocketManagerOptions) {
    // Merge with defaults
    this.options = {
      tokenIds: options.tokenIds,
      onMidpointUpdate: options.onMidpointUpdate,
      onConnected: options.onConnected ?? (() => {}),
      onDisconnected: options.onDisconnected ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onReconnecting: options.onReconnecting ?? (() => {}),
      reconnectDelayMs: options.reconnectDelayMs ?? DEFAULTS.reconnectDelayMs,
      maxReconnectDelayMs: options.maxReconnectDelayMs ?? DEFAULTS.maxReconnectDelayMs,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULTS.pingIntervalMs,
      maxSpreadForMidpoint: options.maxSpreadForMidpoint ?? DEFAULTS.maxSpreadForMidpoint,
    };

    // Initialize token state
    for (const tokenId of this.options.tokenIds) {
      this.tokenState.set(tokenId, {
        bestBid: 0,
        bestAsk: 0,
        spread: 0,
        lastTradePrice: 0,
        midpoint: 0,
        lastUpdated: 0,
      });
    }
  }

  /**
   * Returns the current connection state.
   */
  getState(): WebSocketState {
    return this.state;
  }

  /**
   * Returns true if the WebSocket is connected.
   */
  isConnected(): boolean {
    return this.state === "connected";
  }

  /**
   * Returns the current price state for a token.
   */
  getTokenState(tokenId: string): TokenPriceState | undefined {
    return this.tokenState.get(tokenId);
  }

  /**
   * Returns the current midpoint for a token.
   */
  getMidpoint(tokenId: string): number {
    return this.tokenState.get(tokenId)?.midpoint ?? 0;
  }

  /**
   * Connects to the WebSocket server.
   * Returns a promise that resolves when connected.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === "connected" || this.state === "connecting") {
        resolve();
        return;
      }

      this.shouldReconnect = true;
      this.state = "connecting";

      try {
        this.ws = new WebSocket(WS_MARKET_URL);

        this.ws.on("open", () => {
          this.state = "connected";
          this.reconnectAttempt = 0;

          // Subscribe to tokens
          this.sendSubscription();

          // Start ping interval
          this.startPing();

          this.options.onConnected();
          resolve();
        });

        this.ws.on("message", (data) => {
          this.handleMessage(data);
        });

        this.ws.on("error", (error) => {
          this.options.onError(error);
          // Don't reject here - let close handler deal with reconnection
        });

        this.ws.on("close", () => {
          this.handleClose();
          // If this was the initial connection attempt, reject
          if (this.state === "connecting") {
            reject(new Error("WebSocket connection closed during connect"));
          }
        });
      } catch (error) {
        this.state = "disconnected";
        reject(error);
      }
    });
  }

  /**
   * Disconnects from the WebSocket server.
   * Cleans up all timers and prevents reconnection.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    this.state = "disconnected";
  }

  /**
   * Subscribes to additional token IDs.
   */
  subscribe(tokenIds: string[]): void {
    // Add to tracked tokens
    for (const tokenId of tokenIds) {
      if (!this.tokenState.has(tokenId)) {
        this.tokenState.set(tokenId, {
          bestBid: 0,
          bestAsk: 0,
          spread: 0,
          lastTradePrice: 0,
          midpoint: 0,
          lastUpdated: 0,
        });
        this.options.tokenIds.push(tokenId);
      }
    }

    // Send subscribe operation if connected
    if (this.isConnected() && this.ws) {
      this.ws.send(JSON.stringify({
        assets_ids: tokenIds,
        operation: "subscribe",
      }));
    }
  }

  /**
   * Unsubscribes from token IDs.
   */
  unsubscribe(tokenIds: string[]): void {
    // Remove from tracked tokens
    for (const tokenId of tokenIds) {
      this.tokenState.delete(tokenId);
      const idx = this.options.tokenIds.indexOf(tokenId);
      if (idx !== -1) {
        this.options.tokenIds.splice(idx, 1);
      }
    }

    // Send unsubscribe operation if connected
    if (this.isConnected() && this.ws) {
      this.ws.send(JSON.stringify({
        assets_ids: tokenIds,
        operation: "unsubscribe",
      }));
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Sends the initial subscription message.
   */
  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: MarketSubscriptionMessage = {
      assets_ids: this.options.tokenIds,
      type: "market",
      custom_feature_enabled: true, // Enable best_bid_ask events
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Starts the ping interval to keep connection alive.
   */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("PING");
      }
    }, this.options.pingIntervalMs);
  }

  /**
   * Stops the ping interval.
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Handles WebSocket close event.
   */
  private handleClose(): void {
    this.cleanup();

    if (this.shouldReconnect) {
      this.state = "reconnecting";
      this.options.onDisconnected();
      this.scheduleReconnect();
    } else {
      this.state = "disconnected";
      this.options.onDisconnected();
    }
  }

  /**
   * Schedules a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempt++;
    this.options.onReconnecting(this.reconnectAttempt);

    // Exponential backoff with jitter
    const delay = Math.min(
      this.options.reconnectDelayMs * Math.pow(2, this.reconnectAttempt - 1),
      this.options.maxReconnectDelayMs
    );
    const jitter = delay * 0.1 * Math.random();

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() will handle retry via handleClose
      }
    }, delay + jitter);
  }

  /**
   * Cleans up WebSocket and timers.
   */
  private cleanup(): void {
    this.stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  /**
   * Handles incoming WebSocket messages.
   */
  private handleMessage(data: WebSocket.RawData): void {
    const raw = data.toString();

    // Handle PONG response (just a string "PONG")
    if (raw === "PONG") {
      return;
    }

    try {
      // Try to parse as JSON
      const events: MarketEvent[] = JSON.parse(raw);

      // Handle array of events
      if (Array.isArray(events)) {
        for (const event of events) {
          this.processEvent(event);
        }
      } else {
        // Single event (shouldn't happen but handle it)
        this.processEvent(events as unknown as MarketEvent);
      }
    } catch {
      // Not JSON - might be a system message, ignore
    }
  }

  /**
   * Processes a single market event.
   */
  private processEvent(event: MarketEvent): void {
    switch (event.event_type) {
      case "best_bid_ask":
        this.handleBestBidAsk(event as BestBidAskEvent);
        break;
      case "last_trade_price":
        this.handleLastTradePrice(event as LastTradePriceEvent);
        break;
      case "price_change":
        this.handlePriceChange(event as PriceChangeEvent);
        break;
      case "book":
        this.handleBook(event as BookEvent);
        break;
      // Ignore other event types for now
    }
  }

  /**
   * Handles best_bid_ask events.
   * This is the primary source for midpoint calculation.
   */
  private handleBestBidAsk(event: BestBidAskEvent): void {
    const tokenId = event.asset_id;
    const state = this.tokenState.get(tokenId);
    if (!state) return;

    const bestBid = parseFloat(event.best_bid);
    const bestAsk = parseFloat(event.best_ask);
    const spread = parseFloat(event.spread);
    const timestamp = parseInt(event.timestamp, 10);

    // Update state
    state.bestBid = bestBid;
    state.bestAsk = bestAsk;
    state.spread = spread;
    state.lastUpdated = timestamp;

    // Calculate midpoint
    const midpoint = this.calculateMidpoint(state);
    if (midpoint !== state.midpoint) {
      state.midpoint = midpoint;
      this.options.onMidpointUpdate(tokenId, midpoint, timestamp);
    }
  }

  /**
   * Handles last_trade_price events.
   * Used as fallback when spread > maxSpreadForMidpoint.
   */
  private handleLastTradePrice(event: LastTradePriceEvent): void {
    const tokenId = event.asset_id;
    const state = this.tokenState.get(tokenId);
    if (!state) return;

    const price = parseFloat(event.price);
    const timestamp = parseInt(event.timestamp, 10);

    state.lastTradePrice = price;

    // Recalculate midpoint if we're using last trade price due to wide spread
    if (state.spread > this.options.maxSpreadForMidpoint) {
      const midpoint = price;
      if (midpoint !== state.midpoint) {
        state.midpoint = midpoint;
        state.lastUpdated = timestamp;
        this.options.onMidpointUpdate(tokenId, midpoint, timestamp);
      }
    }
  }

  /**
   * Handles price_change events (Level 2 book updates).
   * Extracts best_bid/best_ask from the event.
   */
  private handlePriceChange(event: PriceChangeEvent): void {
    // price_change events include best_bid and best_ask in each price level
    for (const change of event.price_changes) {
      const tokenId = change.asset_id;
      const state = this.tokenState.get(tokenId);
      if (!state) continue;

      const bestBid = parseFloat(change.best_bid);
      const bestAsk = parseFloat(change.best_ask);
      const spread = bestAsk - bestBid;
      const timestamp = parseInt(event.timestamp, 10);

      // Update state
      state.bestBid = bestBid;
      state.bestAsk = bestAsk;
      state.spread = spread;
      state.lastUpdated = timestamp;

      // Calculate midpoint
      const midpoint = this.calculateMidpoint(state);
      if (midpoint !== state.midpoint) {
        state.midpoint = midpoint;
        this.options.onMidpointUpdate(tokenId, midpoint, timestamp);
      }
    }
  }

  /**
   * Handles book events (full order book snapshot).
   * Extracts best bid and ask from the book.
   *
   * Note: The WebSocket returns bids sorted ascending by price and asks sorted
   * descending by price, so we need to find the max bid and min ask.
   */
  private handleBook(event: BookEvent): void {
    const tokenId = event.asset_id;
    const state = this.tokenState.get(tokenId);
    if (!state) return;

    const timestamp = parseInt(event.timestamp, 10);

    // Find best bid (highest price in bids array)
    let bestBid = 0;
    for (const bid of event.bids) {
      const price = parseFloat(bid.price);
      if (price > bestBid) {
        bestBid = price;
      }
    }

    // Find best ask (lowest price in asks array)
    let bestAsk = 1;
    for (const ask of event.asks) {
      const price = parseFloat(ask.price);
      if (price < bestAsk) {
        bestAsk = price;
      }
    }

    const spread = bestAsk - bestBid;

    // Extract last trade price if present in the event
    if (event.last_trade_price) {
      state.lastTradePrice = parseFloat(event.last_trade_price);
    }

    // Update state
    state.bestBid = bestBid;
    state.bestAsk = bestAsk;
    state.spread = spread;
    state.lastUpdated = timestamp;

    // Calculate midpoint
    const midpoint = this.calculateMidpoint(state);
    if (midpoint !== state.midpoint) {
      state.midpoint = midpoint;
      this.options.onMidpointUpdate(tokenId, midpoint, timestamp);
    }
  }

  /**
   * Calculates the midpoint from token state.
   *
   * Uses (best_bid + best_ask) / 2 unless spread > maxSpreadForMidpoint,
   * in which case uses last_trade_price.
   */
  private calculateMidpoint(state: TokenPriceState): number {
    // If spread is too wide, use last trade price
    if (state.spread > this.options.maxSpreadForMidpoint) {
      return state.lastTradePrice || (state.bestBid + state.bestAsk) / 2;
    }

    // Normal case: midpoint of bid/ask
    if (state.bestBid > 0 && state.bestAsk > 0) {
      return (state.bestBid + state.bestAsk) / 2;
    }

    // Edge case: no valid bid/ask, use last trade price
    if (state.lastTradePrice > 0) {
      return state.lastTradePrice;
    }

    // Fallback: return 0
    return 0;
  }
}

/**
 * Trailing debounce utility for rate-limiting midpoint updates.
 *
 * Waits until no new updates for `delayMs` before firing the callback.
 * This prevents rapid order churn during volatile periods while maintaining
 * quick reaction times when the price settles.
 *
 * @example
 * ```typescript
 * const debounce = new TrailingDebounce((midpoint) => {
 *   console.log("Settled midpoint:", midpoint);
 * }, 50);
 *
 * // Rapid updates will reset the timer
 * debounce.update(0.50);
 * debounce.update(0.51);
 * debounce.update(0.52);
 * // Callback fires 50ms after the last update with value 0.52
 * ```
 */
export class TrailingDebounce {
  private timer: NodeJS.Timeout | null = null;
  private latestValue: number = 0;
  private latestTimestamp: number = 0;

  constructor(
    private callback: (value: number, timestamp: number) => void,
    private delayMs: number = 50
  ) {}

  /**
   * Updates the debounced value.
   * Resets the timer on each call.
   */
  update(value: number, timestamp: number = Date.now()): void {
    this.latestValue = value;
    this.latestTimestamp = timestamp;

    // Clear existing timer
    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Set new timer
    this.timer = setTimeout(() => {
      this.callback(this.latestValue, this.latestTimestamp);
      this.timer = null;
    }, this.delayMs);
  }

  /**
   * Cancels any pending callback.
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Forces immediate callback execution with current value.
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.callback(this.latestValue, this.latestTimestamp);
    }
  }

  /**
   * Returns the latest value without triggering callback.
   */
  getLatestValue(): number {
    return this.latestValue;
  }
}
