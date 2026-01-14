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
 * Converts a UserTradeEvent from WebSocket to our Fill type.
 *
 * IMPORTANT: The WebSocket trade event's `side` field represents the TAKER's side.
 * When you're the maker (your resting order gets filled), you need to invert the side
 * to get YOUR perspective on the trade.
 *
 * - If trade_owner === owner: You're the taker, use side as-is
 * - If trade_owner !== owner: You're the maker, invert the side
 *
 * @param trade - Trade event from WebSocket
 * @returns Fill object for storage/tracking
 */
export function tradeEventToFill(trade: UserTradeEvent): import("@/types/fills.js").Fill {
  // Determine if we're the maker or taker
  // trade_owner is the taker's API key, owner is the event recipient (us)
  const isMaker = trade.trade_owner !== trade.owner;

  // The side in the event is the TAKER's side
  // If we're the maker, our side is the opposite
  const ourSide: "BUY" | "SELL" = isMaker
    ? (trade.side === "BUY" ? "SELL" : "BUY")
    : trade.side;

  return {
    id: trade.id,
    tokenId: trade.asset_id,
    conditionId: trade.market,
    side: ourSide,
    price: parseFloat(trade.price),
    size: parseFloat(trade.size),
    timestamp: parseInt(trade.timestamp, 10) * 1000, // Convert seconds to ms
    orderId: trade.taker_order_id,
    status: trade.status === "RETRYING" ? "MATCHED" : trade.status, // Map RETRYING to MATCHED
  };
}
