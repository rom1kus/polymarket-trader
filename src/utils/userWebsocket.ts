/**
 * Authenticated WebSocket manager for Polymarket user channel.
 *
 * Provides real-time notifications for:
 * - Trade events (fills) - when orders are matched
 * - Order events - placements, updates, cancellations
 *
 * Requires API credentials (apiKey, secret, passphrase) for authentication.
 *
 * WebSocket endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/user
 *
 * @example
 * ```typescript
 * const ws = new UserWebSocket({
 *   apiKey: creds.apiKey,
 *   apiSecret: creds.secret,
 *   passphrase: creds.passphrase,
 *   onTrade: (trade) => {
 *     console.log(`Fill: ${trade.side} ${trade.size} @ ${trade.price}`);
 *   },
 * });
 *
 * await ws.connect();
 * ```
 */

import WebSocket from "ws";
import type {
  WebSocketState,
  UserTradeEvent,
  UserOrderEvent,
  UserEvent,
} from "@/types/websocket.js";

/** WebSocket endpoint for user channel */
const WS_USER_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user";

/** Default configuration values */
const DEFAULTS = {
  reconnectDelayMs: 1000,
  maxReconnectDelayMs: 30000,
  pingIntervalMs: 10000,
};

/**
 * Configuration options for UserWebSocket.
 */
export interface UserWebSocketOptions {
  /** API key for authentication */
  apiKey: string;
  /** API secret for authentication */
  apiSecret: string;
  /** API passphrase for authentication */
  passphrase: string;

  /** Callback when a trade (fill) occurs */
  onTrade: (trade: UserTradeEvent) => void;

  /** Callback when an order event occurs (optional) */
  onOrder?: (order: UserOrderEvent) => void;

  /** Callback when WebSocket connects */
  onConnected?: () => void;

  /** Callback when WebSocket disconnects */
  onDisconnected?: () => void;

  /** Callback on WebSocket error */
  onError?: (error: Error) => void;

  /** Callback when reconnecting (with attempt number) */
  onReconnecting?: (attempt: number) => void;

  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelayMs?: number;

  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;

  /** Ping interval in ms (default: 10000) */
  pingIntervalMs?: number;
}

/**
 * Authenticated WebSocket manager for user-specific events.
 *
 * Provides real-time fill and order notifications for the authenticated user.
 * Handles reconnection with exponential backoff and ping/pong keep-alive.
 */
export class UserWebSocket {
  private ws: WebSocket | null = null;
  private state: WebSocketState = "disconnected";
  private options: Required<UserWebSocketOptions>;

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Keep-alive
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // Track if we should attempt reconnection
  private shouldReconnect = true;

  constructor(options: UserWebSocketOptions) {
    // Merge with defaults
    this.options = {
      apiKey: options.apiKey,
      apiSecret: options.apiSecret,
      passphrase: options.passphrase,
      onTrade: options.onTrade,
      onOrder: options.onOrder ?? (() => {}),
      onConnected: options.onConnected ?? (() => {}),
      onDisconnected: options.onDisconnected ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onReconnecting: options.onReconnecting ?? (() => {}),
      reconnectDelayMs: options.reconnectDelayMs ?? DEFAULTS.reconnectDelayMs,
      maxReconnectDelayMs: options.maxReconnectDelayMs ?? DEFAULTS.maxReconnectDelayMs,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULTS.pingIntervalMs,
    };
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
   * Connects to the WebSocket server.
   * Returns a promise that resolves when connected and authenticated.
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
        this.ws = new WebSocket(WS_USER_URL);

        this.ws.on("open", () => {
          this.state = "connected";
          this.reconnectAttempt = 0;

          // Send authentication message
          this.sendAuth();

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
            reject(new Error("User WebSocket connection closed during connect"));
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

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Sends the authentication message to subscribe to user channel.
   */
  private sendAuth(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // User channel authentication message format
    const authMessage = {
      auth: {
        apiKey: this.options.apiKey,
        secret: this.options.apiSecret,
        passphrase: this.options.passphrase,
      },
      type: "user",
    };

    this.ws.send(JSON.stringify(authMessage));
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
      const events: UserEvent[] = JSON.parse(raw);

      // Handle array of events
      if (Array.isArray(events)) {
        for (const event of events) {
          this.processEvent(event);
        }
      } else {
        // Single event
        this.processEvent(events as unknown as UserEvent);
      }
    } catch {
      // Not JSON - might be a system message, ignore
    }
  }

  /**
   * Processes a single user event.
   */
  private processEvent(event: UserEvent): void {
    if (event.event_type === "trade") {
      this.options.onTrade(event as UserTradeEvent);
    } else if (event.event_type === "order") {
      this.options.onOrder(event as UserOrderEvent);
    }
    // Ignore unknown event types
  }
}

/**
 * Token ID mapping for converting outcome to actual token.
 */
export interface TokenIdMapping {
  yesTokenId: string;
  noTokenId: string;
}

/**
 * Interface for looking up tracked order information.
 * Allows passing the OrderTracker without creating a direct dependency.
 */
export interface OrderLookup {
  getOrder(orderId: string): { side: "BUY" | "SELL"; tokenType: "YES" | "NO" } | undefined;
}

/**
 * Converts a UserTradeEvent from WebSocket to our Fill type.
 *
 * CRITICAL: The Polymarket CLOB only has order books for YES tokens.
 * - BUY YES orders sit on the YES bid
 * - BUY NO orders are internally converted to SELL YES orders on the YES ask
 *
 * When a trade event arrives, we need to determine:
 * 1. Were we the maker or taker?
 * 2. What outcome/token did WE actually trade?
 * 
 * The `maker_orders` array contains details for each maker order in the trade.
 * If we're the maker, our API key will match one of the `owner` fields in `maker_orders`.
 * 
 * IMPORTANT: We use the OrderTracker to get the ORIGINAL side of our order.
 * The taker's side is irrelevant to what WE placed. If we placed a BUY YES order,
 * when it's filled we BOUGHT YES tokens, regardless of the taker's perspective.
 *
 * If we're the taker, we use the trade-level fields (side, price, outcome).
 *
 * @param trade - Trade event from WebSocket
 * @param tokenMapping - Mapping of outcome names to token IDs
 * @param ourApiKey - Our API key to identify if we're a maker
 * @param orderLookup - Optional order tracker to look up original order side
 * @returns Fill object for storage/tracking
 */
export function tradeEventToFill(
  trade: UserTradeEvent,
  tokenMapping: TokenIdMapping,
  ourApiKey: string,
  orderLookup?: OrderLookup
): import("@/types/fills.js").Fill {
  // First, check if we're a maker in this trade by finding our order in maker_orders
  const ourMakerOrder = trade.maker_orders.find(mo => mo.owner === ourApiKey);
  
  if (ourMakerOrder) {
    // We're the MAKER - use maker order details for correct attribution
    const isYesOutcome = ourMakerOrder.outcome.toLowerCase() === "yes";
    const tokenId = isYesOutcome ? tokenMapping.yesTokenId : tokenMapping.noTokenId;
    
    // Use the maker order's price and matched amount
    const price = parseFloat(ourMakerOrder.price);
    const size = parseFloat(ourMakerOrder.matched_amount);
    
    // CRITICAL: Look up the original order side from OrderTracker
    // This is the side WE placed, not inferred from the taker's side
    const trackedOrder = orderLookup?.getOrder(ourMakerOrder.order_id);
    
    let ourSide: "BUY" | "SELL";
    if (trackedOrder) {
      // Use the tracked order's side - this is what WE placed
      ourSide = trackedOrder.side;
    } else {
      // Fallback: infer from taker's side (legacy behavior, may be incorrect)
      // This happens if the order wasn't tracked (e.g., placed before bot started)
      ourSide = trade.side === "BUY" ? "SELL" : "BUY";
      // Log warning since this fallback may be incorrect
      console.warn(
        `[tradeEventToFill] Order ${ourMakerOrder.order_id.substring(0, 16)}... not found in tracker, ` +
        `using fallback side inference (may be incorrect)`
      );
    }
    
    return {
      id: trade.id,
      tokenId,
      conditionId: trade.market,
      side: ourSide,
      price,
      size,
      timestamp: parseInt(trade.timestamp, 10) * 1000, // Convert seconds to ms
      orderId: ourMakerOrder.order_id,
      status: trade.status === "RETRYING" ? "MATCHED" : trade.status,
      outcome: ourMakerOrder.outcome, // Include for debugging
    };
  }
  
  // We're the TAKER - use trade-level fields
  // The trade-level outcome and side represent the taker's perspective (which is us)
  const isYesOutcome = trade.outcome.toLowerCase() === "yes";
  const tokenId = isYesOutcome ? tokenMapping.yesTokenId : tokenMapping.noTokenId;
  
  return {
    id: trade.id,
    tokenId,
    conditionId: trade.market,
    side: trade.side, // Taker's side is directly reported
    price: parseFloat(trade.price),
    size: parseFloat(trade.size),
    timestamp: parseInt(trade.timestamp, 10) * 1000, // Convert seconds to ms
    orderId: trade.taker_order_id,
    status: trade.status === "RETRYING" ? "MATCHED" : trade.status,
    outcome: trade.outcome, // Include for debugging
  };
}
