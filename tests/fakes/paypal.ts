import { randomUUID } from "node:crypto";
import { createPayPalFetch } from "@/server/paypal/client";
import type { PayPalConfig } from "@/server/paypal/config";
import { createOrdersApi } from "@/server/paypal/orders";
import { createTokenCache } from "@/server/paypal/token-cache";

/**
 * Fake PayPal REST API for unit tests: a small in-memory model of Orders v2 (create → buyer approval → capture)
 * behind a `fetchImpl`. Records every call with its `PayPal-Request-Id`, honours request-id idempotency like PayPal,
 * and lets a test script one-off replies per endpoint. Approval only happens through `approve()`, i.e. the test
 * plays the buyer at PayPal; the app under test can never mark an order approved or captured itself.
 */

export type Kind = "token" | "create" | "capture" | "get" | "getCapture" | "refund" | "getRefund" | "verify";

export type ScriptedReply = { status: number; json?: unknown; headers?: Record<string, string> } | { throws: Error };

export type FakeCall = { kind: Kind; method: string; url: string; requestId: string | null; body: unknown };

type FakeOrder = {
  id: string;
  status: "CREATED" | "PAYER_ACTION_REQUIRED" | "APPROVED" | "COMPLETED" | "VOIDED";
  customId: string;
  referenceId: string;
  value: string;
  currency: string;
  capture?: { id: string; status: string; value: string; currency: string };
};

export const TEST_PAYPAL_CONFIG: PayPalConfig = {
  configured: true,
  reason: null,
  missing: [],
  env: "sandbox",
  baseUrl: "https://api-m.sandbox.paypal.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  webhookId: undefined,
  currency: "USD",
};

export function paypalError(status: number, issue: string, name = "UNPROCESSABLE_ENTITY"): ScriptedReply {
  return { status, json: { name, message: issue, details: [{ issue }], debug_id: `debug-${issue.toLowerCase()}` } };
}

function classify(method: string, url: string): { kind: Kind; id?: string } {
  const path = new URL(url).pathname;
  if (path === "/v1/oauth2/token") return { kind: "token" };
  if (path === "/v1/notifications/verify-webhook-signature") return { kind: "verify" };
  if (path === "/v2/checkout/orders" && method === "POST") return { kind: "create" };
  let m = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(path);
  if (m) return { kind: "capture", id: decodeURIComponent(m[1]) };
  m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path);
  if (m) return { kind: "get", id: decodeURIComponent(m[1]) };
  m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(path);
  if (m) return { kind: "refund", id: decodeURIComponent(m[1]) };
  m = /^\/v2\/payments\/captures\/([^/]+)$/.exec(path);
  if (m) return { kind: "getCapture", id: decodeURIComponent(m[1]) };
  m = /^\/v2\/payments\/refunds\/([^/]+)$/.exec(path);
  if (m) return { kind: "getRefund", id: decodeURIComponent(m[1]) };
  throw new Error(`fake PayPal: unexpected ${method} ${url}`);
}

export function createFakePayPal() {
  const calls: FakeCall[] = [];
  const orders = new Map<string, FakeOrder>();
  const createdByRequestId = new Map<string, string>();
  const capturedByRequestId = new Map<string, { status: number; json: unknown }>();
  const scripted = new Map<Kind, ScriptedReply[]>();
  const gates = new Map<Kind, Promise<void>>();
  let seq = 0;
  // Random per instance: order and capture ids are unique columns in the integration database.
  const prefix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

  function orderJson(order: FakeOrder) {
    return {
      id: order.id,
      status: order.status,
      payer: order.status === "COMPLETED" ? { payer_id: "TESTPAYER1" } : undefined,
      purchase_units: [
        {
          reference_id: order.referenceId,
          custom_id: order.customId,
          amount: { currency_code: order.currency, value: order.value },
          ...(order.capture
            ? {
                payments: {
                  captures: [{ id: order.capture.id, status: order.capture.status, amount: { currency_code: order.capture.currency, value: order.capture.value } }],
                },
              }
            : {}),
        },
      ],
    };
  }

  function defaultReply(kind: Kind, id: string | undefined, body: unknown, requestId: string | null): { status: number; json: unknown } {
    switch (kind) {
      case "token":
        return { status: 200, json: { access_token: "fake-access-token", token_type: "Bearer", expires_in: 32400 } };
      case "create": {
        if (requestId && createdByRequestId.has(requestId)) return { status: 200, json: orderJson(orders.get(createdByRequestId.get(requestId)!)!) };
        const unit = (body as { purchase_units: { custom_id: string; reference_id: string; amount: { value: string; currency_code: string } }[] }).purchase_units[0];
        seq += 1;
        const order: FakeOrder = {
          id: `ORDER${prefix}${String(seq).padStart(4, "0")}`,
          status: "PAYER_ACTION_REQUIRED",
          customId: unit.custom_id,
          referenceId: unit.reference_id,
          value: unit.amount.value,
          currency: unit.amount.currency_code,
        };
        orders.set(order.id, order);
        if (requestId) createdByRequestId.set(requestId, order.id);
        return { status: 201, json: orderJson(order) };
      }
      case "capture": {
        if (requestId && capturedByRequestId.has(requestId)) return capturedByRequestId.get(requestId)!;
        const order = orders.get(id!);
        let reply: { status: number; json: unknown };
        if (!order) reply = { status: 404, json: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
        else if (order.status === "COMPLETED") reply = paypalError(422, "ORDER_ALREADY_CAPTURED") as { status: number; json: unknown };
        else if (order.status !== "APPROVED") reply = paypalError(422, "ORDER_NOT_APPROVED") as { status: number; json: unknown };
        else {
          seq += 1;
          order.status = "COMPLETED";
          order.capture = { id: `CAPTURE${prefix}${String(seq).padStart(4, "0")}`, status: "COMPLETED", value: order.value, currency: order.currency };
          reply = { status: 201, json: orderJson(order) };
        }
        if (requestId) capturedByRequestId.set(requestId, reply);
        return reply;
      }
      case "get": {
        const order = orders.get(id!);
        return order ? { status: 200, json: orderJson(order) } : { status: 404, json: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
      }
      default:
        throw new Error(`fake PayPal: no default reply for ${kind}; script one`);
    }
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    const headers = new Headers(init?.headers);
    const requestId = headers.get("paypal-request-id");
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // form-encoded token request
      }
    }
    const { kind, id } = classify(method, url);
    calls.push({ kind, method, url, requestId, body });
    const gate = gates.get(kind);
    if (gate) await gate;
    const queue = scripted.get(kind);
    const next = queue?.shift();
    if (next && "throws" in next) throw next.throws;
    const reply = next ?? defaultReply(kind, id, body, requestId);
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status,
      headers: { "Content-Type": "application/json", ...("headers" in reply ? reply.headers : {}) },
    });
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    orders,
    /** Calls of one kind (token calls are usually not interesting). */
    callsOf: (kind: Kind) => calls.filter((c) => c.kind === kind),
    /** Queue one-off replies for an endpoint; they take precedence over the simulated behaviour. */
    script: (kind: Kind, ...replies: ScriptedReply[]) => scripted.set(kind, [...(scripted.get(kind) ?? []), ...replies]),
    /** The buyer approves the order at PayPal. */
    approve: (orderId: string) => {
      const order = orders.get(orderId);
      if (!order) throw new Error(`fake PayPal: unknown order ${orderId}`);
      order.status = "APPROVED";
    },
    /** A capture that landed at PayPal outside this request (e.g. a lost response). */
    completeAtPayPal: (orderId: string, captureStatus = "COMPLETED") => {
      const order = orders.get(orderId);
      if (!order) throw new Error(`fake PayPal: unknown order ${orderId}`);
      seq += 1;
      order.status = "COMPLETED";
      order.capture = { id: `CAPTURE${prefix}${String(seq).padStart(4, "0")}`, status: captureStatus, value: order.value, currency: order.currency };
      return order.capture.id;
    },
    /** Puts an order in a given PayPal-side state (reconciliation tests). */
    putOrder: (order: Pick<FakeOrder, "id" | "status" | "customId"> & Partial<FakeOrder>) => {
      const full: FakeOrder = { referenceId: "offer", value: "15.00", currency: "USD", ...order };
      orders.set(full.id, full);
      return full;
    },
    /** Holds every call of `kind` until the returned function is called. */
    hold: (kind: Kind) => {
      let release!: () => void;
      gates.set(kind, new Promise<void>((resolve) => (release = resolve)));
      return () => {
        gates.delete(kind);
        release();
      };
    },
  };
}

export type FakePayPal = ReturnType<typeof createFakePayPal>;

/** Real token cache + client + orders API wired to the fake transport. */
export function fakeOrdersApi(fake: FakePayPal, config: PayPalConfig = TEST_PAYPAL_CONFIG) {
  const tokens = createTokenCache({ config, fetchImpl: fake.fetchImpl, logger: silentLogger });
  return createOrdersApi(createPayPalFetch({ config, tokens, fetchImpl: fake.fetchImpl, logger: silentLogger }));
}

export const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
