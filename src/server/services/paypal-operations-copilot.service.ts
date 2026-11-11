import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionUser } from "@/server/auth/guards";
import { llmClient, type LlmClient } from "@/server/ai/llm-client";
import { AppError } from "@/server/http/errors";
import { recordAudit } from "./audit.service";
import { runPayPalReadTool, type PayPalReadTool, type PayPalReadToolRunner } from "@/server/paypal-agent/toolkit";

export const PayPalCopilotRequestSchema = z
  .object({
    operation: z.enum(["order", "refund", "transaction"]),
    id: z.string().trim().min(12).max(255),
    question: z.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    const patterns = {
      order: /^[A-Z0-9]{17,32}$/,
      refund: /^[A-Za-z0-9_-]{15,32}$/,
      transaction: /^[A-Za-z0-9_-]{12,255}$/,
    } as const;
    if (!patterns[value.operation].test(value.id)) {
      context.addIssue({ code: "custom", path: ["id"], message: `Enter a valid PayPal ${value.operation} ID.` });
    }
  });

export type PayPalCopilotRequest = z.infer<typeof PayPalCopilotRequestSchema>;

const SummarySchema = z.object({
  status: z.string().min(1).max(80),
  summary: z.string().min(1).max(1200),
  findings: z.array(z.string().min(1).max(300)).max(6),
  recommendedAction: z.string().min(1).max(500),
  confidence: z.enum(["high", "medium", "low"]),
});

export type PayPalCopilotResult = z.infer<typeof SummarySchema> & {
  source: "paypal-agent-toolkit";
  tool: PayPalReadTool;
  aiGenerated: boolean;
  model: string | null;
  inspectedAt: string;
};

const SAFE_KEYS = new Set([
  "id", "status", "intent", "create_time", "update_time", "transaction_id", "transaction_event_code",
  "transaction_initiation_date", "transaction_updated_date", "transaction_amount", "fee_amount", "transaction_status",
  "ending_balance_available", "custom_field", "invoice_id", "amount", "currency_code", "value", "gross_amount",
  "paypal_fee", "net_amount", "seller_receivable_breakdown", "seller_payable_breakdown", "captures", "refunds",
  "payments", "purchase_units", "custom_id", "reference_id", "found", "total_items", "transaction_details", "message",
]);

/** Data minimization boundary before a PayPal response can be sent to the configured LLM. */
export function sanitizePayPalData(value: unknown, depth = 0): unknown {
  if (depth > 7) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayPalData(item, depth + 1));
  if (typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!SAFE_KEYS.has(key)) continue;
    const sanitized = sanitizePayPalData(child, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

function toolRequest(input: PayPalCopilotRequest): { tool: PayPalReadTool; args: Record<string, unknown> } {
  if (input.operation === "order") return { tool: "get_order", args: { id: input.id } };
  if (input.operation === "refund") return { tool: "get_refund", args: { refund_id: input.id } };
  return { tool: "list_transactions", args: { transaction_id: input.id, search_months: 12, page_size: 10, page: 1 } };
}

function findStatus(data: unknown): string {
  if (!data || typeof data !== "object") return "Unknown";
  const record = data as Record<string, unknown>;
  for (const key of ["status", "transaction_status"]) if (typeof record[key] === "string") return record[key] as string;
  if (Array.isArray(record.transaction_details) && record.transaction_details[0]) {
    const info = (record.transaction_details[0] as Record<string, unknown>).transaction_info;
    if (info && typeof info === "object" && typeof (info as Record<string, unknown>).transaction_status === "string") {
      return (info as Record<string, unknown>).transaction_status as string;
    }
  }
  return "Unknown";
}

function fallbackSummary(operation: PayPalCopilotRequest["operation"], data: unknown): z.infer<typeof SummarySchema> {
  const status = findStatus(data);
  return {
    status,
    summary: `PayPal Agent Toolkit returned the ${operation} record with status ${status}. AI summarization was unavailable, so this is a deterministic summary.`,
    findings: ["The record was retrieved directly from PayPal Sandbox using a read-only toolkit action."],
    recommendedAction: "Compare this provider status with the matching UNBUILT payment record. Use the existing reconciliation controls if they differ.",
    confidence: status === "Unknown" ? "low" : "high",
  };
}

type CopilotDeps = {
  runTool: PayPalReadToolRunner;
  llm: LlmClient;
  audit: typeof recordAudit;
  now: () => Date;
};

export function createPayPalOperationsCopilot(deps: CopilotDeps) {
  return {
    async inspect(actor: Pick<SessionUser, "id" | "role">, input: PayPalCopilotRequest): Promise<PayPalCopilotResult> {
      if (actor.role !== "admin") throw new AppError("FORBIDDEN", 403);
      const request = toolRequest(input);
      const raw = await deps.runTool(request.tool, request.args);
      const safeData = sanitizePayPalData(raw);
      const llm = await deps.llm.completeJson({
        agent: "paypal_operations_copilot",
        promptVersion: "v1",
        system:
          "You are UNBUILT's read-only PayPal Sandbox operations analyst. Summarize only the supplied sanitized provider data. Never claim to have changed a payment, never recommend bypassing buyer approval, and never request personal data. If evidence is incomplete, say so.",
        user: JSON.stringify({ operation: input.operation, question: input.question || "Explain the current state and safest next step.", paypal: safeData }),
        schema: SummarySchema,
        schemaName: "paypal_operations_summary",
        targetType: "system",
        actorId: actor.id,
        maxRetries: 1,
      });
      const summary = llm.ok ? llm.data : fallbackSummary(input.operation, safeData);
      await deps.audit({
        actorId: actor.id,
        action: "paypal_agent.inspect",
        entityType: "paypal_sandbox_record",
        metadata: {
          operation: input.operation,
          tool: request.tool,
          resourceHash: createHash("sha256").update(input.id).digest("hex").slice(0, 16),
          aiGenerated: llm.ok,
          runId: llm.ok ? llm.runId : null,
        },
      });
      return {
        ...summary,
        source: "paypal-agent-toolkit",
        tool: request.tool,
        aiGenerated: llm.ok,
        model: llm.ok ? llm.model : null,
        inspectedAt: deps.now().toISOString(),
      };
    },
  };
}

export const paypalOperationsCopilot = createPayPalOperationsCopilot({
  runTool: runPayPalReadTool,
  llm: llmClient,
  audit: recordAudit,
  now: () => new Date(),
});
