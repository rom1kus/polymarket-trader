/**
 * Order management utilities for placing, cancelling, and managing orders.
 *
 * Provides a simplified interface over the ClobClient for common order operations.
 */

import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import type { TickSize } from "@polymarket/clob-client";

/**
 * Parameters for placing a limit order
 */
export interface OrderParams {
  /** Token ID to trade */
  tokenId: string;
  /** Limit price (0.01 to 0.99) */
  price: number;
  /** Number of shares */
  size: number;
  /** Buy or Sell */
  side: Side;
  /** Minimum price increment for the market */
  tickSize: TickSize;
  /** Whether this is a negative risk market */
  negRisk: boolean;
}

/**
 * Response from order placement
 */
export interface OrderResult {
  success: boolean;
  orderId: string | null;
  errorMsg?: string;
}

/**
 * Places a GTC (Good-Til-Cancelled) limit order.
 *
 * @param client - Authenticated ClobClient
 * @param params - Order parameters
 * @returns Order result with order ID if successful
 */
export async function placeOrder(
  client: ClobClient,
  params: OrderParams
): Promise<OrderResult> {
  try {
    const response = await client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side,
      },
      {
        tickSize: params.tickSize,
        negRisk: params.negRisk,
      },
      OrderType.GTC
    );

    // The API may return success=false or have an errorMsg field
    const errorMsg = response.errorMsg || (response as { error?: string }).error;
    const success = !!response.orderID && !errorMsg;

    return {
      success,
      orderId: response.orderID || null,
      errorMsg: errorMsg || undefined,
    };
  } catch (error) {
    // Extract error message from Axios-style errors
    const axiosError = error as { response?: { data?: { error?: string } }; message?: string };
    const errorMsg = 
      axiosError.response?.data?.error || 
      axiosError.message || 
      (error instanceof Error ? error.message : "Unknown error");

    return {
      success: false,
      orderId: null,
      errorMsg,
    };
  }
}

/**
 * Cancels all open orders for the authenticated user.
 *
 * @param client - Authenticated ClobClient
 */
export async function cancelAllOrders(client: ClobClient): Promise<void> {
  await client.cancelAll();
}

/**
 * Cancels all orders for a specific token.
 *
 * @param client - Authenticated ClobClient
 * @param tokenId - Token ID to cancel orders for
 */
export async function cancelOrdersForToken(
  client: ClobClient,
  tokenId: string
): Promise<void> {
  await client.cancelMarketOrders({ asset_id: tokenId });
}

/**
 * Cancels a specific order by ID.
 *
 * @param client - Authenticated ClobClient
 * @param orderId - Order ID to cancel
 */
export async function cancelOrder(
  client: ClobClient,
  orderId: string
): Promise<void> {
  await client.cancelOrder({ orderID: orderId });
}

/**
 * Gets all open orders for the authenticated user.
 *
 * @param client - Authenticated ClobClient
 * @param tokenId - Optional token ID to filter by
 */
export async function getOpenOrders(
  client: ClobClient,
  tokenId?: string
): Promise<unknown[]> {
  const params = tokenId ? { asset_id: tokenId } : undefined;
  return client.getOpenOrders(params);
}
