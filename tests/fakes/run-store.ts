import { randomUUID } from "node:crypto";
import type { NewRun, RunRecord, RunStore } from "@/server/ai/run-recorder";

/** In-memory `ai_analysis_runs`. */
export function createFakeRunStore() {
  const rows: (RunRecord & { raw: NewRun })[] = [];
  let tick = 0;

  const store: RunStore = {
    async insert(run) {
      const id = run.id ?? randomUUID();
      tick += 1;
      rows.push({
        id,
        agent: run.agent,
        targetType: run.targetType,
        targetId: run.targetId ?? null,
        provider: run.provider,
        modelName: run.modelName,
        promptVersion: run.promptVersion,
        inputHash: run.inputHash,
        status: run.status,
        output: run.output ?? null,
        attempts: run.attempts ?? 1,
        createdBy: run.createdBy ?? null,
        createdAt: run.createdAt ?? new Date(Date.UTC(2026, 10, 7, 0, 0, tick)).toISOString(),
        raw: run,
      });
      return id;
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async findCachedSuccess({ agent, inputHash, modelName, promptVersion, since }) {
      const hits = rows.filter(
        (row) =>
          row.agent === agent &&
          row.inputHash === inputHash &&
          row.modelName === modelName &&
          row.promptVersion === promptVersion &&
          row.status === "succeeded" &&
          row.createdAt >= since,
      );
      return hits.at(-1) ?? null;
    },
    async findLatestForTarget(agent, targetType, targetId) {
      const hits = rows.filter((row) => row.agent === agent && row.targetType === targetType && row.targetId === targetId);
      return hits.at(-1) ?? null;
    },
  };

  return { store, rows };
}
