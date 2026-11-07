import "server-only";
import { paypalFetch as defaultFetch, type PayPalFetch, type PayPalResult } from "./client";

/** Orders v2 calls (design 9.2, spec 8C). Every call returns the raw `{status, body, debugId}`. */

export type PayPalMoney = { currency_code: string; value: string };

export type PayPalCapture = {
  id: string;
  status: string;
  amount?: PayPalMoney;
  custom_id?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
};

export type PayPalOrder = {
  id: string;
  status: string;
  payer?: { payer_id?: string };
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    amount?: PayPalMoney;
    payments?: { captures?: PayPalCapture[] };
  }[];
};

export type OrdersApi = {
  createOrder(body: unknown, requestId: string): Promise<PayPalResult<PayPalOrder>>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalResult<PayPalOrder>>;
  getOrder(orderId: string): Promise<PayPalResult<PayPalOrder>>;
  getCapture(captureId: string): Promise<PayPalResult<PayPalCapture>>;
};

export function createOrdersApi(paypalFetch: PayPalFetch): OrdersApi {
  return {
    createOrder: (body, requestId) => paypalFetch<PayPalOrder>("/v2/checkout/orders", { method: "POST", body, requestId }),
    captureOrder: (orderId, requestId) =>
      paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", body: {}, requestId }),
    getOrder: (orderId) => paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`),
    getCapture: (captureId) => paypalFetch<PayPalCapture>(`/v2/payments/captures/${encodeURIComponent(captureId)}`),
  };
}

export const paypalOrders: OrdersApi = createOrdersApi(defaultFetch);
