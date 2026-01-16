/**
 * Order Tracker - Maps order IDs to token information.
 *
 * When placing orders, we track which token (YES/NO) each order was placed for.
 * This allows us to correctly attribute fills even when the WebSocket reports
 * fills with ambiguous or counterparty-perspective data (e.g., MINT matching).
 *
 * @example
 * ```typescript
 * const tracker = new OrderTracker();
 *
 * // When placing orders
 * tracker.trackOrder(orderId, {
 *   tokenId: yesTokenId,
 *   tokenType: "YES",
 *   side: "BUY",
 *   price: 0.52,
 *   size: 20,
 * });
 *
 * // When a fill comes in
 * const orderInfo = tracker.getOrder(orderId);
 * if (orderInfo) {
 *   // Use orderInfo.tokenType to know if this was YES or NO
 * }
 * ```
 */

import { log } from "@/utils/helpers.js";

/**
 * Information tracked for each order.
 */
export interface TrackedOrder {
  /** Order ID from CLOB */
  orderId: string;
  /** Token ID the order was placed for */
  tokenId: string;
  /** Token type (YES or NO) */
  tokenType: "YES" | "NO";
  /** Order side */
  side: "BUY" | "SELL";
  /** Order price */
  price: number;
  /** Order size */
  size: number;
  /** Timestamp when order was placed */
  placedAt: number;
}

/**
 * Order tracker for mapping order IDs to token information.
 *
 * Maintains a map of active orders that we've placed, allowing us to
 * look up which token an order was for when we receive fill events.
 */
export class OrderTracker {
  /** Map of order ID → order info */
  private orders: Map<string, TrackedOrder> = new Map();

  /** Maximum number of orders to track (prevents memory leaks) */
  private maxOrders: number;

  /** How long to keep orders before pruning (ms) */
  private maxAge: number;

  constructor(options?: { maxOrders?: number; maxAgeMs?: number }) {
    this.maxOrders = options?.maxOrders ?? 1000;
    this.maxAge = options?.maxAgeMs ?? 24 * 60 * 60 * 1000; // 24 hours default
  }

  /**
   * Tracks a new order.
   *
   * @param orderId - Order ID from CLOB
   * @param info - Order information (without orderId and placedAt)
   */
  trackOrder(
    orderId: string,
    info: Omit<TrackedOrder, "orderId" | "placedAt">
  ): void {
    // Prune old orders if we're at capacity
    if (this.orders.size >= this.maxOrders) {
      this.pruneOldOrders();
    }

    const trackedOrder: TrackedOrder = {
      orderId,
      ...info,
      placedAt: Date.now(),
    };

    this.orders.set(orderId, trackedOrder);
    log(`[OrderTracker] Tracking ${info.tokenType} order: ${orderId.substring(0, 16)}... @ $${info.price.toFixed(4)}`);
  }

  /**
   * Gets order information by order ID.
   *
   * @param orderId - Order ID to look up
   * @returns Order info if found, undefined otherwise
   */
  getOrder(orderId: string): TrackedOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Checks if an order is being tracked.
   *
   * @param orderId - Order ID to check
   * @returns True if order is tracked
   */
  hasOrder(orderId: string): boolean {
    return this.orders.has(orderId);
  }

  /**
   * Removes an order from tracking (e.g., after it's fully filled or cancelled).
   *
   * @param orderId - Order ID to remove
   * @returns True if order was removed
   */
  removeOrder(orderId: string): boolean {
    const removed = this.orders.delete(orderId);
    if (removed) {
      log(`[OrderTracker] Removed order: ${orderId.substring(0, 16)}...`);
    }
    return removed;
  }

  /**
   * Removes all orders for a specific token.
   *
   * @param tokenId - Token ID to remove orders for
   * @returns Number of orders removed
   */
  removeOrdersForToken(tokenId: string): number {
    let removed = 0;
    for (const [orderId, info] of this.orders) {
      if (info.tokenId === tokenId) {
        this.orders.delete(orderId);
        removed++;
      }
    }
    if (removed > 0) {
      log(`[OrderTracker] Removed ${removed} orders for token`);
    }
    return removed;
  }

  /**
   * Clears all tracked orders.
   */
  clear(): void {
    const count = this.orders.size;
    this.orders.clear();
    if (count > 0) {
      log(`[OrderTracker] Cleared ${count} orders`);
    }
  }

  /**
   * Gets the number of tracked orders.
   */
  get size(): number {
    return this.orders.size;
  }

  /**
   * Gets all tracked orders (for debugging).
   */
  getAllOrders(): TrackedOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Prunes orders older than maxAge.
   */
  private pruneOldOrders(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [orderId, info] of this.orders) {
      if (now - info.placedAt > this.maxAge) {
        this.orders.delete(orderId);
        pruned++;
      }
    }

    if (pruned > 0) {
      log(`[OrderTracker] Pruned ${pruned} old orders`);
    }
  }
}

/**
 * Global order tracker instance.
 *
 * Shared across the market maker to track all placed orders.
 */
let globalOrderTracker: OrderTracker | null = null;

/**
 * Gets or creates the global order tracker.
 */
export function getOrderTracker(): OrderTracker {
  if (!globalOrderTracker) {
    globalOrderTracker = new OrderTracker();
  }
  return globalOrderTracker;
}

/**
 * Resets the global order tracker (for testing).
 */
export function resetOrderTracker(): void {
  if (globalOrderTracker) {
    globalOrderTracker.clear();
  }
  globalOrderTracker = null;
}
