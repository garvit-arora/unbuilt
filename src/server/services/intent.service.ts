import "server-only";
import { DEFAULT_CURRENCY } from "@/lib/money";
import type { IntentBody } from "@/lib/schemas/demand";
import { supabaseClustersRepo, type ClustersRepo } from "@/server/db/repositories/clusters.repo";
import { supabaseIntentsRepo, type IntentsRepo } from "@/server/db/repositories/intents.repo";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { clusterService, type Actor, type ClusterService } from "./cluster.service";
import { metricsService, type MetricsService } from "./metrics.service";

/** L1/L2 purchase intents (spec section 7). No money moves here; interest is never treated as a payment. */

export type IntentDeps = {
  clusters: ClustersRepo;
  intents: IntentsRepo;
  clusterService: Pick<ClusterService, "resolveJoinable" | "ensureMember">;
  metrics: MetricsService;
  logger: Logger;
};

export function createIntentService(deps: IntentDeps) {
  async function setIntent(actor: Actor, ref: string, body: IntentBody) {
    const cluster = await deps.clusterService.resolveJoinable(ref);
    const membership = await deps.clusterService.ensureMember(actor, cluster);
    const priced = body.level === "price_qualified";
    const intent = await deps.intents.upsert({
      clusterId: cluster.id,
      userId: actor.id,
      level: body.level,
      targetPriceCents: priced ? (body.targetPriceCents ?? null) : null,
      maximumPriceCents: priced ? (body.maximumPriceCents ?? null) : null,
      currency: DEFAULT_CURRENCY,
      isDemo: membership.isDemo,
    });
    let metrics = null;
    try {
      await deps.clusters.insertEvent({
        clusterId: cluster.id,
        type: "intent_set",
        actorId: actor.id,
        payload: { level: intent.level, targetPriceCents: intent.targetPriceCents, maximumPriceCents: intent.maximumPriceCents },
        isDemo: membership.isDemo,
      });
      metrics = await deps.metrics.refreshCluster(cluster.id);
    } catch (error) {
      deps.logger.warn("intent.post_commit_failed", { error });
    }
    return { intent, metrics };
  }

  async function withdraw(actor: Actor, ref: string) {
    const cluster = await deps.clusterService.resolveJoinable(ref);
    const intent = await deps.intents.withdraw(cluster.id, actor.id);
    let metrics = null;
    if (intent) {
      try {
        await deps.clusters.insertEvent({ clusterId: cluster.id, type: "intent_withdrawn", actorId: actor.id, payload: {}, isDemo: intent.isDemo });
        metrics = await deps.metrics.refreshCluster(cluster.id);
      } catch (error) {
        deps.logger.warn("intent.post_commit_failed", { error });
      }
    }
    return { intent, metrics };
  }

  return { setIntent, withdraw };
}

export type IntentService = ReturnType<typeof createIntentService>;

export const intentService: IntentService = createIntentService({
  clusters: supabaseClustersRepo,
  intents: supabaseIntentsRepo,
  clusterService,
  metrics: metricsService,
  logger: defaultLogger,
});
