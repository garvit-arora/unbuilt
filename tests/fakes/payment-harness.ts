import type { NewClusterEvent } from "@/server/db/repositories/clusters.repo";
import type { OfferRecord } from "@/server/db/repositories/marketplace.repo";
import type { PaymentRecord } from "@/server/db/repositories/payments.repo";
import type { PayPalConfig } from "@/server/paypal/config";
import { verifyWebhookSignature } from "@/server/paypal/webhook-verify";
import type { AuditEntry } from "@/server/services/audit.service";
import { createPaymentService } from "@/server/services/payment.service";
import { createRefundService } from "@/server/services/refund.service";
import { createWebhookService } from "@/server/services/webhook.service";
import { createMarketplaceStore } from "./marketplace-store";
import { createFakePayPal, fakeOrdersApi, fakePayPalFetch, fakeRefundsApi, silentLogger, TEST_PAYPAL_CONFIG } from "./paypal";
import { createFlagStore, createPaymentStore, createRefundStore, createWebhookEventStore } from "./payment-store";

/**
 * Payment, refund and webhook services wired to in-memory repos, a controllable clock and the fake PayPal API.
 * PayPal is always the fake: an order is approved only through `paypal.approve` (the test plays the buyer).
 */

export const OFFER_ID = "6c1a2d3e-4f50-4b0c-8f4e-2a714d5b9f0e";
export const BUYER = { id: "buyer-1", role: "buyer" as const };
export const OTHER_BUYER = { id: "buyer-2", role: "buyer" as const };
export const ADMIN = { id: "admin-1", role: "admin" as const };
export const BUILDER_ID = "builder-1";
export const APP_URL = "http://localhost:3000";
export const WEBHOOK_ID = "WH-TEST-0001";

export function makeOffer(over: Partial<OfferRecord> = {}): OfferRecord {
  return {
    id: OFFER_ID,
    proposalId: "proposal-1",
    clusterId: "cluster-1",
    builderId: BUILDER_ID,
    merchantId: "platform",
    title: "LocalPilot Starter Kit",
    description: "A downloadable guide for a fully local AI coding assistant.",
    offerType: "completed_product",
    priceCents: 1500,
    currency: "USD",
    availabilityStatus: "available",
    productExists: true,
    accessExpectedAt: null,
    deliveryTerms: "Instant download after capture",
    refundTerms: "Full refund within 14 days",
    refundWindowDays: 14,
    productUrl: `${APP_URL}/demo/localpilot`,
    demoUrl: `${APP_URL}/demo/localpilot`,
    deliveredFeatures: [],
    isDemo: false,
    publishedAt: "2026-11-07T10:00:00.000Z",
    createdAt: "2026-11-07T09:00:00.000Z",
    updatedAt: "2026-11-07T10:00:00.000Z",
    ...over,
  };
}

export function paymentHarness(options: { config?: PayPalConfig; offer?: Partial<OfferRecord> } = {}) {
  let t = new Date("2026-11-07T12:00:00.000Z").getTime();
  const clock = { now: () => new Date(t), advance: (ms: number) => (t += ms) };
  const config = options.config ?? TEST_PAYPAL_CONFIG;
  const store = createPaymentStore(clock);
  const market = createMarketplaceStore();
  market.merchants.set("platform", { id: "platform", displayName: "UNBUILT Demo Merchant", kind: "platform_demo", onboardingStatus: "not_required", isActive: true });
  market.merchants.set("seller", { id: "seller", displayName: "Indie (pending)", kind: "seller", onboardingStatus: "pending", isActive: true });
  market.offers.set(OFFER_ID, makeOffer(options.offer));
  const paypal = createFakePayPal();
  const flags = createFlagStore();
  const refundStore = createRefundStore(store, flags, clock);
  const webhookStore = createWebhookEventStore();
  const completed: PaymentRecord[] = [];
  const notifications: { userIds: readonly string[]; type: string; payload: Record<string, unknown> }[] = [];
  const events: NewClusterEvent[] = [];
  const audits: AuditEntry[] = [];
  const orders = fakeOrdersApi(paypal, config);

  const refunds = createRefundService({
    config,
    payments: store.repo,
    refunds: refundStore.repo,
    paypal: fakeRefundsApi(paypal, config),
    offers: market.repo,
    adminIds: async () => [ADMIN.id],
    notifications: {
      notify: async (userIds, type, payload) => {
        notifications.push({ userIds, type, payload });
      },
    },
    events: {
      insertEvent: async (event) => {
        events.push(event);
      },
    },
    refreshMetrics: async () => {},
    audit: async (entry) => {
      audits.push(entry);
    },
    logger: silentLogger,
    now: clock.now,
  });

  const service = createPaymentService({
    config,
    appUrl: APP_URL,
    payments: store.repo,
    offers: market.repo,
    orders,
    flags,
    afterCapture: async (payment) => {
      completed.push(payment);
    },
    refundSide: (payment, source) => refunds.reconcilePayment(payment, source),
    audit: async (entry) => {
      audits.push(entry);
    },
    logger: silentLogger,
    now: clock.now,
  });

  const verifyFetch = fakePayPalFetch(paypal, config);
  const webhooks = createWebhookService({
    config: { configured: config.configured, webhookId: WEBHOOK_ID },
    verify: (headers, rawBody, webhookId) => verifyWebhookSignature(headers, rawBody, webhookId, verifyFetch),
    events: webhookStore.repo,
    payments: store.repo,
    refunds: refundStore.repo,
    orders,
    paypalRefunds: fakeRefundsApi(paypal, config),
    reconcileOrder: (payment, source) => service.reconcileOrder(payment, source),
    refundOutcome: refunds,
    flags,
    logger: silentLogger,
    now: clock.now,
  });

  /** Buyer creates an order and approves it at PayPal (the only way an order gets approved). */
  async function approvedCheckout(buyer = BUYER) {
    const created = await service.createOrder(buyer, OFFER_ID);
    paypal.approve(created.orderId);
    return created;
  }

  /** A real checkout through the fake PayPal: create, approve, capture → COMPLETED. */
  async function capturedPayment(buyer = BUYER) {
    const { orderId, paymentId } = await approvedCheckout(buyer);
    await service.capture(buyer, orderId);
    return (await store.repo.findById(paymentId))!;
  }

  const payment = async (id: string) => (await store.repo.findById(id))!;

  return {
    clock,
    store,
    market,
    paypal,
    flags,
    completed,
    service,
    refunds,
    refundStore,
    webhooks,
    webhookStore,
    notifications,
    events,
    audits,
    approvedCheckout,
    capturedPayment,
    payment,
  };
}

export async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (e: unknown) => e as { code: string; status: number; message: string; details?: unknown },
  );
}
