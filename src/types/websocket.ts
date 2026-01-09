/**
 * Types for Polymarket WebSocket API.
 *
 * WebSocket endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 *
 * Documentation: https://docs.polymarket.com/#websocket-channels
 */

// =============================================================================
// Connection Types
// =============================================================================

/**
 * WebSocket connection states.
 */
export type WebSocketState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * Subscription message for the market channel.
 */
export interface MarketSubscriptionMessage {
  /** Array of token IDs to subscribe to */
  assets_ids: string[];
  /** Channel type */
  type: "market";
  /** Enable custom events like best_bid_ask, new_market, market_resolved */
  custom_feature_enabled?: boolean;
}

/**
 * Dynamic subscribe/unsubscribe message.
 */
export interface SubscriptionOperationMessage {
  /** Array of token IDs */
  assets_ids: string[];
  /** Operation type */
  operation: "subscribe" | "unsubscribe";
}

// =============================================================================
// Market Channel Events
// =============================================================================

/**
 * Base interface for all market channel events.
 */
export interface BaseMarketEvent {
  /** The type of event */
  event_type: string;
  /** Token ID (asset) this event relates to */
  asset_id: string;
  /** Condition ID (market) this event relates to */
  market: string;
  /** Unix timestamp in milliseconds as string */
  timestamp: string;
}

/**
 * Best bid/ask update event.
 * Requires `custom_feature_enabled: true` in subscription.
 */
export interface BestBidAskEvent extends BaseMarketEvent {
  event_type: "best_bid_ask";
  /** Best bid price as string (e.g., "0.73") */
  best_bid: string;
  /** Best ask price as string (e.g., "0.77") */
  best_ask: string;
  /** Spread as string (e.g., "0.04") */
  spread: string;
}

/**
 * Last trade price event.
 * Fired when a trade executes.
 */
export interface LastTradePriceEvent extends BaseMarketEvent {
  event_type: "last_trade_price";
  /** Trade price as string (e.g., "0.456") */
  price: string;
  /** Trade side */
  side: "BUY" | "SELL";
  /** Trade size as string (e.g., "219.217767") */
  size: string;
}

/**
 * Price level change in the order book.
 */
export interface PriceLevel {
  /** Token ID */
  asset_id: string;
  /** Price level */
  price: string;
  /** New size at this level (0 = removed) */
  size: string;
  /** Side of the book */
  side: "BUY" | "SELL";
  /** Best bid price */
  best_bid: string;
  /** Best ask price */
  best_ask: string;
}

/**
 * Price change event (Level 2 book update).
 * Fired when orders are placed or cancelled.
 */
export interface PriceChangeEvent extends Omit<BaseMarketEvent, "asset_id"> {
  event_type: "price_change";
  /** Array of price level changes */
  price_changes: PriceLevel[];
}

/**
 * Full order book snapshot.
 * Sent on initial subscription.
 *
 * Note: Bids are sorted ascending by price, asks are sorted descending.
 * Best bid is the highest price in bids, best ask is the lowest in asks.
 */
export interface BookEvent extends BaseMarketEvent {
  event_type: "book";
  /** Bid levels (sorted ascending by price - best bid is highest) */
  bids: Array<{ price: string; size: string }>;
  /** Ask levels (sorted descending by price - best ask is lowest) */
  asks: Array<{ price: string; size: string }>;
  /** Hash for book verification */
  hash?: string;
  /** Last trade price (included in book snapshots) */
  last_trade_price?: string;
}

/**
 * Tick size change notification.
 * Fired when price crosses 0.04 or 0.96 boundaries.
 */
export interface TickSizeChangeEvent extends BaseMarketEvent {
  event_type: "tick_size_change";
  /** Old tick size */
  old_tick_size: string;
  /** New tick size */
  new_tick_size: string;
}

/**
 * Market resolved event.
 * Requires `custom_feature_enabled: true` in subscription.
 */
export interface MarketResolvedEvent extends BaseMarketEvent {
  event_type: "market_resolved";
  /** Winning outcome (0 = No, 1 = Yes) */
  outcome: number;
}

/**
 * New market created event.
 * Requires `custom_feature_enabled: true` in subscription.
 */
export interface NewMarketEvent extends BaseMarketEvent {
  event_type: "new_market";
}

/**
 * Union type for all market channel events.
 */
export type MarketEvent =
  | BestBidAskEvent
  | LastTradePriceEvent
  | PriceChangeEvent
  | BookEvent
  | TickSizeChangeEvent
  | MarketResolvedEvent
  | NewMarketEvent;

// =============================================================================
// User Channel Events (Authenticated)
// =============================================================================

/**
 * Subscription message for the user channel.
 * Requires authentication via apikey, secret, passphrase.
 */
export interface UserSubscriptionMessage {
  /** Authentication API key */
  auth: {
    apiKey: string;
    secret: string;
    passphrase: string;
  };
  /** Channel type */
  type: "user";
}

/**
 * Maker order details within a trade event.
 */
export interface MakerOrderDetail {
  /** Token ID of the maker order */
  asset_id: string;
  /** Amount matched from this maker order */
  matched_amount: string;
  /** Maker order ID */
  order_id: string;
  /** Outcome (YES/NO) */
  outcome: string;
  /** Owner API key */
  owner: string;
  /** Price of maker order */
  price: string;
}

/**
 * Trade event from user channel.
 *
 * Emitted when:
 * - A market order is matched ("MATCHED")
 * - A limit order is included in a trade ("MATCHED")
 * - Subsequent status changes ("MINED", "CONFIRMED", "RETRYING", "FAILED")
 */
export interface UserTradeEvent {
  /** Event type identifier */
  event_type: "trade";
  /** Message type */
  type: "TRADE";
  /** Unique trade ID */
  id: string;
  /** Token ID (asset) traded */
  asset_id: string;
  /** Market condition ID */
  market: string;
  /** Trade side */
  side: "BUY" | "SELL";
  /** Trade price as string */
  price: string;
  /** Trade size as string */
  size: string;
  /** Trade status */
  status: "MATCHED" | "MINED" | "CONFIRMED" | "RETRYING" | "FAILED";
  /** Taker order ID */
  taker_order_id: string;
  /** Array of maker orders in this trade */
  maker_orders: MakerOrderDetail[];
  /** Trade timestamp as string (Unix seconds) */
  timestamp: string;
  /** Match time as string (Unix seconds) */
  matchtime: string;
  /** Last update timestamp as string */
  last_update: string;
  /** Owner API key */
  owner: string;
  /** Trade owner API key */
  trade_owner: string;
  /** Outcome (YES/NO) */
  outcome: string;
}

/**
 * Order event from user channel.
 *
 * Emitted when:
 * - An order is placed (PLACEMENT)
 * - An order is partially matched (UPDATE)
 * - An order is cancelled (CANCELLATION)
 */
export interface UserOrderEvent {
  /** Event type identifier */
  event_type: "order";
  /** Order event type */
  type: "PLACEMENT" | "UPDATE" | "CANCELLATION";
  /** Order ID */
  id: string;
  /** Token ID (asset) */
  asset_id: string;
  /** Market condition ID */
  market: string;
  /** Order side */
  side: "BUY" | "SELL";
  /** Order price as string */
  price: string;
  /** Original order size as string */
  original_size: string;
  /** Amount matched so far as string */
  size_matched: string;
  /** Event timestamp as string */
  timestamp: string;
  /** Associated trade IDs (null if none) */
  associate_trades: string[] | null;
  /** Order owner API key */
  order_owner: string;
  /** Owner API key */
  owner: string;
  /** Outcome (YES/NO) */
  outcome: string;
}

/**
 * Union type for all user channel events.
 */
export type UserEvent = UserTradeEvent | UserOrderEvent;

// =============================================================================
// WebSocket Manager Types
// =============================================================================

/**
 * Callback for midpoint updates.
 */
export type MidpointUpdateCallback = (
  tokenId: string,
  midpoint: number,
  timestamp: number
) => void;

/**
 * Configuration options for PolymarketWebSocket.
 */
export interface WebSocketManagerOptions {
  /** Token IDs to subscribe to */
  tokenIds: string[];

  /** Callback when midpoint is updated */
  onMidpointUpdate: MidpointUpdateCallback;

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

  /** Maximum spread before using last trade price (default: 0.10) */
  maxSpreadForMidpoint?: number;
}

/**
 * Internal state for tracking best bid/ask per token.
 */
export interface TokenPriceState {
  bestBid: number;
  bestAsk: number;
  spread: number;
  lastTradePrice: number;
  midpoint: number;
  lastUpdated: number;
}
