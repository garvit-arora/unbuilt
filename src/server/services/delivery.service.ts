import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SessionUser } from "@/server/auth/guards";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabasePaymentsRepo, type PaymentsRepo } from "@/server/db/repositories/payments.repo";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { isCaptured } from "@/server/payments/state-machine";

/**
 * Post-purchase delivery (design 9.10). Only a buyer with a payment in CAPTURED_STATES gets access (a pending refund
 * does not revoke it; REFUNDED does). Downloads are resolved through a static allow-list, never from a raw path.
 */

export const DELIVERABLE_KEY_RE = /^[a-z0-9-]+\.md$/;
export const DELIVERABLE_ALLOW_LIST: Readonly<Record<string, string>> = { "localpilot-starter-kit.md": "localpilot-starter-kit.md" };
export const DELIVERABLES_DIR = "src/server/deliverables";

export type Deliverable = { deliveryType: "download" | "external_link"; deliverableKey: string | null; accessUrl: string | null };

export type DeliveryAccess = { kind: "download"; fileName: string; content: string } | { kind: "external_link"; accessUrl: string };

export type DeliveryLink = { kind: "download"; href: string } | { kind: "external_link"; href: string };

export type DeliveryDeps = {
  payments: Pick<PaymentsRepo, "listForBuyerOffer">;
  findDeliverable: (offerId: string) => Promise<Deliverable | null>;
  readFile: (filePath: string) => Promise<string>;
  root: string;
  logger: Logger;
};

/** Maps a stored key to a bundled file name, or null. Both the pattern and the allow-list must accept it. */
export function resolveDeliverableFile(key: string | null): string | null {
  if (!key || !DELIVERABLE_KEY_RE.test(key) || !Object.hasOwn(DELIVERABLE_ALLOW_LIST, key)) return null;
  return DELIVERABLE_ALLOW_LIST[key];
}

export function createDeliveryService(deps: DeliveryDeps) {
  async function assertPurchased(userId: string, offerId: string) {
    const payments = await deps.payments.listForBuyerOffer(userId, offerId);
    if (!payments.some((p) => isCaptured(p.status))) {
      throw new AppError("FORBIDDEN", 403, "Access requires a completed PayPal Sandbox purchase of this offer.");
    }
  }

  async function deliverableFor(offerId: string): Promise<Deliverable> {
    const deliverable = await deps.findDeliverable(offerId);
    if (!deliverable) throw new AppError("NOT_FOUND", 404, "This offer has no deliverable.");
    return deliverable;
  }

  async function access(user: Pick<SessionUser, "id">, offerId: string): Promise<DeliveryAccess> {
    await assertPurchased(user.id, offerId);
    const deliverable = await deliverableFor(offerId);
    if (deliverable.deliveryType === "external_link") {
      if (!deliverable.accessUrl) {
        deps.logger.error("delivery.missing_access_url", { offerId });
        throw new AppError("INTERNAL_ERROR", 500, "Something went wrong.", { expose: false });
      }
      return { kind: "external_link", accessUrl: deliverable.accessUrl };
    }
    const fileName = resolveDeliverableFile(deliverable.deliverableKey);
    if (!fileName) {
      deps.logger.error("delivery.key_rejected", { offerId, key: deliverable.deliverableKey });
      throw new AppError("INTERNAL_ERROR", 500, "Something went wrong.", { expose: false });
    }
    try {
      const content = await deps.readFile(path.join(deps.root, DELIVERABLES_DIR, fileName));
      return { kind: "download", fileName, content };
    } catch (error) {
      deps.logger.error("delivery.file_unreadable", { offerId, fileName, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "deliverable not bundled" : "read failed", error });
      throw new AppError("INTERNAL_ERROR", 500, "Something went wrong.", { expose: false });
    }
  }

  /** The receipt's access link for a buyer who has a captured payment, or null. */
  async function accessLink(userId: string, offerId: string): Promise<DeliveryLink | null> {
    const payments = await deps.payments.listForBuyerOffer(userId, offerId);
    if (!payments.some((p) => isCaptured(p.status))) return null;
    const deliverable = await deps.findDeliverable(offerId);
    if (!deliverable) return null;
    if (deliverable.deliveryType === "external_link") return deliverable.accessUrl ? { kind: "external_link", href: deliverable.accessUrl } : null;
    return { kind: "download", href: `/api/products/${offerId}/access` };
  }

  return { access, accessLink };
}

export type DeliveryService = ReturnType<typeof createDeliveryService>;

async function findDeliverable(offerId: string): Promise<Deliverable | null> {
  const { data, error } = await getServiceClient()
    .from("offer_deliverables")
    .select("delivery_type, deliverable_key, access_url")
    .eq("offer_id", offerId)
    .maybeSingle();
  if (error) dbFail("offer_deliverables lookup failed", error);
  return data ? { deliveryType: data.delivery_type as Deliverable["deliveryType"], deliverableKey: data.deliverable_key, accessUrl: data.access_url } : null;
}

export const deliveryService: DeliveryService = createDeliveryService({
  payments: supabasePaymentsRepo,
  findDeliverable,
  readFile: (filePath) => readFile(filePath, "utf8"),
  root: process.cwd(),
  logger: defaultLogger,
});
