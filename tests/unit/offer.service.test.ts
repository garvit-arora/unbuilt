import { describe, expect, it } from "vitest";
import type { OfferCreate } from "@/lib/schemas/marketplace";
import { OfferCreateSchema } from "@/lib/schemas/marketplace";
import { AppError } from "@/server/http/errors";
import { canSell, createOfferService, EARLY_ACCESS_DISABLED, missingForPublish } from "@/server/services/offer.service";
import { createMarketplaceStore } from "../fakes/marketplace-store";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const CLUSTER = "cluster-offline";

function setup() {
  const store = createMarketplaceStore();
  store.merchants.set("platform", { id: "platform", displayName: "UNBUILT Demo Merchant", kind: "platform_demo", onboardingStatus: "not_required", isActive: true });
  store.profiles.set("labs", { id: "labs", displayName: "UNBUILT Labs", role: "builder", isPlatformBuilder: true });
  store.profiles.set("indie", { id: "indie", displayName: "Indie Builder", role: "builder", isPlatformBuilder: false });
  store.profiles.set("admin", { id: "admin", displayName: "Demo Admin", role: "admin", isPlatformBuilder: false });
  const statusCalls: { clusterId: string; target: string }[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const notified: { userIds: readonly string[]; type: string }[] = [];
  const audits: string[] = [];
  const service = createOfferService({
    repo: store.repo,
    advanceClusterStatus: async (clusterId, target) => {
      statusCalls.push({ clusterId, target });
      return true;
    },
    events: {
      async insertEvent(event) {
        events.push({ type: event.type, payload: event.payload });
      },
    },
    memberIds: async () => ["member-1", "member-2", "labs"],
    notifications: {
      async notify(userIds, type) {
        notified.push({ userIds, type });
      },
    },
    audit: async (entry) => {
      audits.push(entry.action);
    },
    logger: silent,
    now: () => new Date("2026-11-07T12:00:00Z"),
  });
  return { store, service, statusCalls, events, notified, audits };
}

async function proposalFor(store: ReturnType<typeof createMarketplaceStore>, builderId: string) {
  return store.repo.insertProposal({ clusterId: CLUSTER, builderId, title: "LocalPilot Starter Kit", description: "A kit for running a local coding assistant." });
}

const offerBody = (proposalId: string, over: Partial<OfferCreate> = {}): OfferCreate => ({
  proposalId,
  title: "LocalPilot Starter Kit",
  description: "Downloadable guide that sets up an offline AI coding assistant.",
  offerType: "completed_product",
  priceCents: 1500,
  deliveryTerms: "Instant download after the payment is captured",
  refundTerms: "Full refund within 14 days on request",
  refundWindowDays: 14,
  productUrl: "http://localhost:3000/demo/localpilot",
  demoUrl: "http://localhost:3000/demo/localpilot",
  deliveredFeatures: ["Works fully offline"],
  ...over,
});

async function expectAppError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  expect((error as AppError).status).toBe(status);
  return error as AppError;
}

describe("offer.service", () => {
  it("a complete completed_product by the platform builder publishes as available through the platform merchant", async () => {
    const { store, service, statusCalls, events, notified, audits } = setup();
    const proposal = await proposalFor(store, "labs");
    const { offer: draft } = await service.createDraft({ id: "labs", role: "builder" }, offerBody(proposal.id));
    expect(draft).toMatchObject({ availabilityStatus: "draft", merchantId: "platform", productExists: true, currency: "USD" });

    const { offer } = await service.publish({ id: "labs", role: "builder" }, draft.id);
    expect(offer.availabilityStatus).toBe("available");
    expect(offer.publishedAt).toBe("2026-11-07T12:00:00.000Z");
    expect(store.proposals.get(proposal.id)?.status).toBe("launched");
    expect(statusCalls).toEqual([{ clusterId: CLUSTER, target: "launched" }]);
    expect(events.map((e) => e.type)).toEqual(["offer_published"]);
    expect(notified).toEqual([{ userIds: ["member-1", "member-2"], type: "product_launched" }]);
    expect(audits).toEqual(["offer.create", "offer.publish"]);
  });

  it("a complete offer by any other builder publishes as listing_only with a pending seller merchant", async () => {
    const { store, service } = setup();
    const proposal = await proposalFor(store, "indie");
    const { offer: draft } = await service.createDraft({ id: "indie", role: "builder" }, offerBody(proposal.id));
    const seller = store.merchants.get(draft.merchantId);
    expect(seller).toMatchObject({ kind: "seller", onboardingStatus: "pending" });

    const { offer } = await service.publish({ id: "indie", role: "builder" }, draft.id);
    expect(offer.availabilityStatus).toBe("listing_only");
    expect(offer.merchantId).toBe(draft.merchantId);
  });

  it("an offer that points at the platform merchant but belongs to a non-platform builder is never available", async () => {
    const { store, service } = setup();
    const proposal = await proposalFor(store, "indie");
    const draft = await store.repo.insertOffer({
      ...offerBody(proposal.id),
      clusterId: CLUSTER,
      builderId: "indie",
      merchantId: "platform",
      currency: "USD",
      productExists: true,
      accessExpectedAt: null,
      productUrl: "https://example.com",
      demoUrl: null,
      deliveredFeatures: [],
    });
    const { offer } = await service.publish({ id: "indie", role: "builder" }, draft.id);
    expect(offer.availabilityStatus).toBe("listing_only");
    expect(store.merchants.get(offer.merchantId)?.kind).toBe("seller");
  });

  it("an admin's own offer through the platform merchant is available", async () => {
    const { store, service } = setup();
    const proposal = await proposalFor(store, "admin");
    const { offer: draft } = await service.createDraft({ id: "admin", role: "admin" }, offerBody(proposal.id));
    expect((await service.publish({ id: "admin", role: "admin" }, draft.id)).offer.availabilityStatus).toBe("available");
  });

  it("a completed_product without product or demo URL → 400 listing the field; the offer stays draft", async () => {
    const { store, service } = setup();
    const proposal = await proposalFor(store, "labs");
    const { offer: draft } = await service.createDraft({ id: "labs", role: "builder" }, offerBody(proposal.id, { productUrl: undefined, demoUrl: undefined }));
    const error = await expectAppError(service.publish({ id: "labs", role: "builder" }, draft.id), "VALIDATION_ERROR", 400);
    expect(error.message).toContain("productUrl or demoUrl");
    expect(error.details).toEqual({ missing: ["productUrl or demoUrl"] });
    expect(store.offers.get(draft.id)?.availabilityStatus).toBe("draft");
  });

  it("early_access → 400 VALIDATION_ERROR 'Early-access offers are not enabled in this MVP'; the offer stays draft", async () => {
    const { store, service, statusCalls, events } = setup();
    const proposal = await proposalFor(store, "labs");
    const { offer: draft } = await service.createDraft(
      { id: "labs", role: "builder" },
      offerBody(proposal.id, { offerType: "early_access", accessExpectedAt: "2027-01-01T00:00:00Z" }),
    );
    expect(draft).toMatchObject({ offerType: "early_access", productExists: false, accessExpectedAt: "2027-01-01T00:00:00Z" });
    const error = await expectAppError(service.publish({ id: "labs", role: "builder" }, draft.id), "VALIDATION_ERROR", 400);
    expect(error.message).toBe(EARLY_ACCESS_DISABLED);
    expect(store.offers.get(draft.id)?.availabilityStatus).toBe("draft");
    expect(statusCalls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("only the owner can create, edit or publish; published offers cannot be edited or re-published", async () => {
    const { store, service } = setup();
    const proposal = await proposalFor(store, "labs");
    await expectAppError(service.createDraft({ id: "indie", role: "builder" }, offerBody(proposal.id)), "FORBIDDEN", 403);
    const { offer: draft } = await service.createDraft({ id: "labs", role: "builder" }, offerBody(proposal.id));
    await expectAppError(service.publish({ id: "indie", role: "builder" }, draft.id), "FORBIDDEN", 403);
    const edited = await service.patchDraft({ id: "labs", role: "builder" }, draft.id, { priceCents: 1900 });
    expect(edited.offer.priceCents).toBe(1900);
    await service.publish({ id: "labs", role: "builder" }, draft.id);
    await expectAppError(service.patchDraft({ id: "labs", role: "builder" }, draft.id, { priceCents: 100 }), "INVALID_STATE", 409);
    await expectAppError(service.publish({ id: "labs", role: "builder" }, draft.id), "INVALID_STATE", 409);
    await expectAppError(service.publish({ id: "labs", role: "builder" }, "missing"), "NOT_FOUND", 404);
  });

  it("the create schema has no merchant or status field and requires an access date for early access", () => {
    const base = offerBody("6f1d2c7e-8b54-4c39-9a1e-3d5f0b7a2c41");
    expect(OfferCreateSchema.safeParse(base).success).toBe(true);
    expect(OfferCreateSchema.safeParse({ ...base, merchantId: "x" }).success).toBe(false);
    expect(OfferCreateSchema.safeParse({ ...base, availabilityStatus: "available" }).success).toBe(false);
    expect(OfferCreateSchema.safeParse({ ...base, offerType: "early_access" }).success).toBe(false);
  });

  it("missingForPublish and canSell", () => {
    expect(canSell({ id: "m", displayName: "x", kind: "platform_demo", onboardingStatus: "not_required", isActive: false }, { role: "builder", isPlatformBuilder: true })).toBe(false);
    expect(canSell({ id: "m", displayName: "x", kind: "seller", onboardingStatus: "pending", isActive: true }, { role: "admin", isPlatformBuilder: false })).toBe(false);
    expect(
      missingForPublish({
        id: "o",
        proposalId: "p",
        clusterId: "c",
        builderId: "b",
        merchantId: "m",
        title: "Offer",
        description: "short",
        offerType: "completed_product",
        priceCents: 50,
        currency: "USD",
        availabilityStatus: "draft",
        productExists: true,
        accessExpectedAt: null,
        deliveryTerms: "",
        refundTerms: "Refunds within 14 days",
        refundWindowDays: 14,
        productUrl: "ftp://example.com",
        demoUrl: null,
        deliveredFeatures: [],
        isDemo: false,
        publishedAt: null,
        createdAt: "",
        updatedAt: "",
      }),
    ).toEqual(["description", "priceCents", "deliveryTerms", "productUrl or demoUrl"]);
  });
});
