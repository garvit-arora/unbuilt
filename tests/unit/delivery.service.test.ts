import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PaymentStatus } from "@/server/payments/state-machine";
import { createDeliveryService, resolveDeliverableFile, type Deliverable } from "@/server/services/delivery.service";
import { errorOf, OFFER_ID } from "../fakes/payment-harness";
import { createPaymentStore } from "../fakes/payment-store";
import { silentLogger } from "../fakes/paypal";

const BUYER = { id: "buyer-1" };

function setup(statuses: PaymentStatus[], deliverable: Deliverable | null = { deliveryType: "download", deliverableKey: "localpilot-starter-kit.md", accessUrl: null }) {
  const store = createPaymentStore({ now: () => new Date("2026-11-07T12:00:00Z") });
  for (const status of statuses) store.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status });
  const reads: string[] = [];
  const service = createDeliveryService({
    payments: store.repo,
    findDeliverable: async () => deliverable,
    readFile: async (filePath) => {
      reads.push(filePath);
      if (!filePath.endsWith("localpilot-starter-kit.md")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return "# LocalPilot Starter Kit";
    },
    root: "/app",
    logger: silentLogger,
  });
  return { service, reads };
}

describe("delivery.service (design 9.10)", () => {
  it.each(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] as const)("a %s buyer gets the download from the allow-listed file", async (status) => {
    const { service, reads } = setup([status]);
    const access = await service.access(BUYER, OFFER_ID);
    expect(access).toEqual({ kind: "download", fileName: "localpilot-starter-kit.md", content: "# LocalPilot Starter Kit" });
    expect(reads).toEqual([path.join("/app", "src/server/deliverables", "localpilot-starter-kit.md")]);
    await expect(service.accessLink(BUYER.id, OFFER_ID)).resolves.toEqual({ kind: "download", href: `/api/products/${OFFER_ID}/access` });
  });

  it.each([[["REFUNDED"]], [["FAILED"]], [["APPROVAL_PENDING", "CAPTURE_PENDING"]], [[]]] as const)("403 for payments %j", async (statuses) => {
    const { service, reads } = setup([...statuses] as PaymentStatus[]);
    expect(await errorOf(service.access(BUYER, OFFER_ID))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(reads).toHaveLength(0);
    await expect(service.accessLink(BUYER.id, OFFER_ID)).resolves.toBeNull();
  });

  it("external links return the access URL", async () => {
    const { service } = setup(["COMPLETED"], { deliveryType: "external_link", deliverableKey: null, accessUrl: "https://example.com/download" });
    await expect(service.access(BUYER, OFFER_ID)).resolves.toEqual({ kind: "external_link", accessUrl: "https://example.com/download" });
  });

  it("the key regex and the allow-list reject path traversal and unknown keys (500, nothing read)", async () => {
    for (const key of ["../x.md", "..%2Fx.md", "unknown-kit.md", "LOCALPILOT.md", "localpilot-starter-kit.txt", "constructor", "__proto__.md"]) {
      expect(resolveDeliverableFile(key)).toBeNull();
      const { service, reads } = setup(["COMPLETED"], { deliveryType: "download", deliverableKey: key, accessUrl: null });
      expect(await errorOf(service.access(BUYER, OFFER_ID))).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
      expect(reads).toHaveLength(0);
    }
    expect(resolveDeliverableFile("localpilot-starter-kit.md")).toBe("localpilot-starter-kit.md");
  });

  it("no deliverable row → 404", async () => {
    const { service } = setup(["COMPLETED"], null);
    expect(await errorOf(service.access(BUYER, OFFER_ID))).toMatchObject({ code: "NOT_FOUND" });
  });
});
