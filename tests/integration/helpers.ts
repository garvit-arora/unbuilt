/**
 * Integration helpers for the local Supabase stack (`npx supabase start`, `npm run db:env`, `npx supabase db reset`).
 * Every fixture created here is tracked and removed by `cleanup()`.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/types";

export type Db = SupabaseClient<Database>;
type Tables = Database["public"]["Tables"];
export type PaymentStatus = Database["public"]["Enums"]["payment_status"];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run \`npx supabase start\` and \`npm run db:env\` before \`npm run test:integration\`.`);
  }
  return value;
}

const URL = required("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function serviceClient(): Db {
  return createClient<Database>(URL, SERVICE_KEY, noSession);
}

export function anonClient(): Db {
  return createClient<Database>(URL, ANON_KEY, noSession);
}

/** PostgREST reports missing table/column privileges as SQLSTATE 42501. */
export const PERMISSION_DENIED = "42501";

/** A 1536-dimension vector with `value` at `index` (unit vectors make cosine similarity easy to predict). */
export function unitVector(index: number, value = 1): number[] {
  const v = new Array<number>(1536).fill(0);
  v[index] = value;
  return v;
}

export function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export type TestUser = { id: string; email: string; password: string; client: Db };

export class Fixtures {
  readonly db = serviceClient();
  private users: string[] = [];
  private clusters: string[] = [];
  private merchants: string[] = [];
  private proposals: string[] = [];
  private offers: string[] = [];
  private payments: string[] = [];
  readonly tag = randomUUID().slice(0, 8);

  /** Creates a confirmed auth user (the profile comes from the handle_new_user trigger) and a signed-in client. */
  async user(options: { role?: string; displayName?: string } = {}): Promise<TestUser> {
    const email = `it-${this.tag}-${randomUUID().slice(0, 8)}@unbuilt.test`;
    const password = `Pw-${randomUUID()}`;
    const { data, error } = await this.db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: options.displayName ?? `IT ${this.tag}`, role: options.role ?? "buyer" },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    this.users.push(data.user.id);
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
    return { id: data.user.id, email, password, client };
  }

  /** Registers an auth user created elsewhere (e.g. through signUp) for cleanup. */
  trackUser(id: string) {
    this.users.push(id);
  }

  async cluster(overrides: Partial<Tables["demand_clusters"]["Insert"]> = {}) {
    const slug = `it-${this.tag}-${randomUUID().slice(0, 8)}`;
    const { data, error } = await this.db
      .from("demand_clusters")
      .insert({
        slug,
        title: `Integration cluster ${slug}`,
        description: "Integration test cluster",
        problem_statement: "Integration test problem",
        category: "developer_tools",
        ...overrides,
      })
      .select()
      .single();
    if (error) throw new Error(`cluster insert failed: ${error.message}`);
    this.clusters.push(data.id);
    return data;
  }

  async request(userId: string, overrides: Partial<Tables["demand_requests"]["Insert"]> = {}) {
    const { data, error } = await this.db
      .from("demand_requests")
      .insert({
        user_id: userId,
        raw_text: "I want an integration test request that is long enough",
        structured_intent: { title: "Integration request", constraintTags: [] },
        intent_provider: "fallback",
        embedding_local: vectorLiteral(unitVector(0)),
        embedding_local_version: "hash-v1-d1536",
        normalized_text_hash: randomUUID(),
        ...overrides,
      })
      .select()
      .single();
    if (error) throw new Error(`request insert failed: ${error.message}`);
    return data;
  }

  async feature(clusterId: string, title: string, overrides: Partial<Tables["feature_requests"]["Insert"]> = {}) {
    const { data, error } = await this.db
      .from("feature_requests")
      .insert({
        cluster_id: clusterId,
        title,
        normalized_title: title.toLowerCase(),
        kind: "required",
        origin: "seed",
        ...overrides,
      })
      .select()
      .single();
    if (error) throw new Error(`feature insert failed: ${error.message}`);
    return data;
  }

  /** Builder + proposal + seller merchant + available offer on a fresh cluster. */
  async offer(options: { priceCents?: number } = {}) {
    const builder = await this.user({ role: "builder" });
    const cluster = await this.cluster();
    const merchant = await this.db
      .from("merchant_accounts")
      .insert({ display_name: `IT merchant ${this.tag}`, kind: "seller", environment: "sandbox", onboarding_status: "not_required" })
      .select()
      .single();
    if (merchant.error) throw new Error(`merchant insert failed: ${merchant.error.message}`);
    this.merchants.push(merchant.data.id);
    const proposal = await this.db
      .from("product_proposals")
      .insert({ cluster_id: cluster.id, builder_id: builder.id, title: "IT proposal", description: "Integration test proposal" })
      .select()
      .single();
    if (proposal.error) throw new Error(`proposal insert failed: ${proposal.error.message}`);
    this.proposals.push(proposal.data.id);
    const offer = await this.db
      .from("product_offers")
      .insert({
        proposal_id: proposal.data.id,
        cluster_id: cluster.id,
        builder_id: builder.id,
        merchant_id: merchant.data.id,
        title: "IT offer",
        description: "Integration test offer",
        offer_type: "completed_product",
        price_cents: options.priceCents ?? 1500,
        currency: "USD",
        availability_status: "available",
        product_exists: true,
        delivery_terms: "Delivered instantly in tests",
        refund_terms: "Refunds handled in tests",
        refund_window_days: 14,
      })
      .select()
      .single();
    if (offer.error) throw new Error(`offer insert failed: ${offer.error.message}`);
    this.offers.push(offer.data.id);
    return { builder, cluster, merchant: merchant.data, proposal: proposal.data, offer: offer.data };
  }

  /** A payment row written with the service role (as the payment service would). */
  async payment(buyerId: string, status: PaymentStatus, options: { amountCents?: number } = {}) {
    const { offer } = await this.offer({ priceCents: options.amountCents });
    const { data, error } = await this.db
      .from("payments")
      .insert({
        buyer_id: buyerId,
        offer_id: offer.id,
        proposal_id: offer.proposal_id,
        cluster_id: offer.cluster_id,
        merchant_id: offer.merchant_id,
        paypal_env: "sandbox",
        paypal_order_id: `IT-${randomUUID()}`,
        amount_cents: offer.price_cents,
        currency: "USD",
        status,
      })
      .select()
      .single();
    if (error) throw new Error(`payment insert failed: ${error.message}`);
    this.payments.push(data.id);
    return data;
  }

  async refund(paymentId: string, requestedBy: string, status: Database["public"]["Enums"]["refund_status"], amountCents: number) {
    const { data, error } = await this.db
      .from("refunds")
      .insert({ payment_id: paymentId, requested_by: requestedBy, status, amount_cents: amountCents, currency: "USD", reason: "Integration test refund" })
      .select()
      .single();
    if (error) throw new Error(`refund insert failed: ${error.message}`);
    return data;
  }

  async cleanup() {
    const db = this.db;
    if (this.payments.length) {
      await db.from("moderation_flags").delete().in("entity_id", this.payments);
      await db.from("refunds").delete().in("payment_id", this.payments);
      await db.from("payments").delete().in("id", this.payments);
    }
    if (this.offers.length) await db.from("product_offers").delete().in("id", this.offers);
    if (this.proposals.length) await db.from("product_proposals").delete().in("id", this.proposals);
    if (this.merchants.length) await db.from("merchant_accounts").delete().in("id", this.merchants);
    if (this.clusters.length) {
      await db.from("moderation_flags").delete().in("entity_id", this.clusters);
      await db.from("demand_clusters").delete().in("id", this.clusters);
    }
    await db.from("rate_limit_buckets").delete().like("key", `it-${this.tag}%`);
    for (const id of this.users) await db.auth.admin.deleteUser(id);
  }
}
