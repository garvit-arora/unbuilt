import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabaseClustersRepo } from "@/server/db/repositories/clusters.repo";
import { supabaseMarketplaceRepo } from "@/server/db/repositories/marketplace.repo";
import { supabasePaymentsRepo } from "@/server/db/repositories/payments.repo";
import { createPaymentService } from "@/server/services/payment.service";
import { createFakePayPal, fakeOrdersApi, paypalError, silentLogger, TEST_PAYPAL_CONFIG } from "../fakes/paypal";
import { Fixtures, type TestUser } from "./helpers";

/**
 * The payment service against the real payments repository and `advance_payment` RPC (PayPal is the in-memory fake:
 * no credentials exist, and an approval only happens through the fake's `approve`).
 */

const fx = new Fixtures();
let buyer: TestUser;
let offerId: string;
const offerIds: string[] = [];

function service(paypal = createFakePayPal()) {
  return {
    paypal,
    service: createPaymentService({
      config: TEST_PAYPAL_CONFIG,
      appUrl: "http://localhost:3000",
      payments: supabasePaymentsRepo,
      offers: {
        findOffer: (id) => supabaseMarketplaceRepo.findOffer(id),
        // The fixture merchant row stands in for the platform merchant so the real seeded one stays untouched.
        findMerchant: async (id) => ({ id, displayName: "IT platform merchant", kind: "platform_demo", onboardingStatus: "not_required", isActive: true }),
      },
      orders: fakeOrdersApi(paypal),
      flags: supabaseClustersRepo,
      afterCapture: async () => {},
      logger: silentLogger,
      now: () => new Date(),
    }),
  };
}

async function newOffer() {
  const { offer } = await fx.offer({ priceCents: 1500 });
  offerIds.push(offer.id);
  return offer.id;
}

beforeAll(async () => {
  buyer = await fx.user();
  offerId = await newOffer();
});

afterAll(async () => {
  if (offerIds.length) {
    const { data } = await fx.db.from("payments").select("id").in("offer_id", offerIds);
    const ids = (data ?? []).map((p) => p.id);
    if (ids.length) {
      await fx.db.from("moderation_flags").delete().in("entity_id", ids);
      await fx.db.from("payments").delete().in("id", ids);
    }
  }
  await fx.cleanup();
});

describe("payments (integration)", () => {
  it("create → approve → capture walks CREATED → APPROVAL_PENDING → CAPTURE_PENDING → COMPLETED with one history row per step", async () => {
    const { service: payments, paypal } = service();
    const created = await payments.createOrder({ id: buyer.id, role: "buyer" }, offerId);
    const again = await payments.createOrder({ id: buyer.id, role: "buyer" }, offerId);
    expect(again).toEqual(created);
    expect(paypal.callsOf("create")).toHaveLength(1);

    paypal.approve(created.orderId);
    const result = await payments.capture({ id: buyer.id, role: "buyer" }, created.orderId);
    expect(result.httpStatus).toBe(200);

    const row = (await fx.db.from("payments").select("*").eq("id", created.paymentId).single()).data!;
    expect(row).toMatchObject({ status: "COMPLETED", paypal_order_id: created.orderId, amount_cents: 1500, capture_attempt: 1, paypal_payer_id: "TESTPAYER1" });
    expect(row.paypal_capture_id).toMatch(/^CAPTURE/);
    expect(row.completed_at).not.toBeNull();
    const history = (await fx.db.from("payment_status_history").select("from_status, to_status, source").eq("payment_id", created.paymentId)).data!;
    expect(history).toHaveLength(3);
    expect(history).toEqual(
      expect.arrayContaining([
        { from_status: "CREATED", to_status: "APPROVAL_PENDING", source: "api" },
        { from_status: "APPROVAL_PENDING", to_status: "CAPTURE_PENDING", source: "api" },
        { from_status: "CAPTURE_PENDING", to_status: "COMPLETED", source: "api" },
      ]),
    );

    expect(await payments.createOrder({ id: buyer.id, role: "buyer" }, offerId).catch((e: { code: string }) => e.code)).toBe("ALREADY_PURCHASED");
  });

  it("the partial unique index allows one open payment per buyer and offer", async () => {
    const id = await newOffer();
    const offer = (await supabaseMarketplaceRepo.findOffer(id))!;
    const base = {
      buyerId: buyer.id,
      offerId: id,
      proposalId: offer.proposalId,
      clusterId: offer.clusterId,
      merchantId: offer.merchantId,
      paypalEnv: "sandbox" as const,
      amountCents: 1500,
      currency: "USD",
      metadata: {},
    };
    const first = await supabasePaymentsRepo.insert(base);
    expect(first).toMatchObject({ status: "CREATED", captureAttempt: 1 });
    expect(await supabasePaymentsRepo.insert(base)).toBeNull();
  });

  it("INSTRUMENT_DECLINED bumps capture_attempt in the same RPC and the retry uses -capture-2", async () => {
    const id = await newOffer();
    const { service: payments, paypal } = service();
    const created = await payments.createOrder({ id: buyer.id, role: "buyer" }, id);
    paypal.approve(created.orderId);
    paypal.script("capture", paypalError(422, "INSTRUMENT_DECLINED"));
    expect(await payments.capture({ id: buyer.id, role: "buyer" }, created.orderId).catch((e: { code: string }) => e.code)).toBe("PAYPAL_INSTRUMENT_DECLINED");
    expect((await fx.db.from("payments").select("status, capture_attempt").eq("id", created.paymentId).single()).data).toEqual({
      status: "APPROVAL_PENDING",
      capture_attempt: 2,
    });
    await payments.capture({ id: buyer.id, role: "buyer" }, created.orderId);
    expect(paypal.callsOf("capture").map((c) => c.requestId)).toEqual([`${created.paymentId}-capture-1`, `${created.paymentId}-capture-2`]);
  });

  it("reconcile advances APPROVAL_PENDING to COMPLETED through advance_payment in one call (two reconcile history rows)", async () => {
    const id = await newOffer();
    const { service: payments, paypal } = service();
    const created = await payments.createOrder({ id: buyer.id, role: "buyer" }, id);
    paypal.approve(created.orderId);
    paypal.completeAtPayPal(created.orderId);
    const status = await payments.status({ id: buyer.id, role: "buyer" }, created.orderId, true);
    expect(status.body.status).toBe("COMPLETED");
    const history = (await fx.db.from("payment_status_history").select("from_status, to_status, source").eq("payment_id", created.paymentId).eq("source", "reconcile")).data!;
    expect(history).toEqual(
      expect.arrayContaining([
        { from_status: "APPROVAL_PENDING", to_status: "CAPTURE_PENDING", source: "reconcile" },
        { from_status: "CAPTURE_PENDING", to_status: "COMPLETED", source: "reconcile" },
      ]),
    );
  });
});
