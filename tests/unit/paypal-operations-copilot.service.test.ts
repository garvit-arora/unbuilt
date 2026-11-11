import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@/server/ai/llm-client";
import { PAYPAL_COPILOT_ACTIONS } from "@/server/paypal-agent/toolkit";
import {
  createPayPalOperationsCopilot,
  PayPalCopilotRequestSchema,
  sanitizePayPalData,
} from "@/server/services/paypal-operations-copilot.service";

const ADMIN = { id: "00000000-0000-4000-8000-000000000001", role: "admin" as const };

function harness(llmResult: unknown = { ok: false, reason: "not_configured" }) {
  const runTool = vi.fn(async () => ({
    id: "5O190127TN364715T",
    status: "COMPLETED",
    payer: { email_address: "buyer@example.com", name: { given_name: "Private" } },
    purchase_units: [{ amount: { currency_code: "USD", value: "15.00" }, custom_id: "commitment-1" }],
  }));
  const completeJson = vi.fn(async (params: unknown) => {
    void params;
    return llmResult;
  });
  const audit = vi.fn(async () => undefined);
  const service = createPayPalOperationsCopilot({
    runTool,
    llm: { completeJson } as unknown as LlmClient,
    audit,
    now: () => new Date("2026-11-11T12:00:00.000Z"),
  });
  return { service, runTool, completeJson, audit };
}

describe("PayPal operations copilot", () => {
  it("registers only read-only Agent Toolkit permissions", () => {
    expect(PAYPAL_COPILOT_ACTIONS).toEqual({ orders: { get: true }, payments: { getRefunds: true }, transactions: { list: true } });
    expect(JSON.stringify(PAYPAL_COPILOT_ACTIONS)).not.toMatch(/create|capture|refund\":true|dispute|invoice|subscription/i);
  });

  it("allows only valid PayPal record identifiers", () => {
    expect(PayPalCopilotRequestSchema.safeParse({ operation: "order", id: "bad" }).success).toBe(false);
    expect(PayPalCopilotRequestSchema.safeParse({ operation: "order", id: "5O190127TN364715T" }).success).toBe(true);
    expect(PayPalCopilotRequestSchema.safeParse({ operation: "refund", id: "REFUND_123456789" }).success).toBe(true);
  });

  it("removes payer, email, address and other personal fields before LLM use", () => {
    expect(
      sanitizePayPalData({
        id: "ORDER1234567890123",
        status: "COMPLETED",
        payer: { email_address: "buyer@example.com", name: { given_name: "Buyer" } },
        shipping: { address: { address_line_1: "Private road" } },
        purchase_units: [{ amount: { currency_code: "USD", value: "15.00" } }],
      }),
    ).toEqual({
      id: "ORDER1234567890123",
      status: "COMPLETED",
      purchase_units: [{ amount: { currency_code: "USD", value: "15.00" } }],
    });
  });

  it("uses only the read-only order lookup and returns a deterministic fallback when AI is unavailable", async () => {
    const h = harness();
    const result = await h.service.inspect(ADMIN, { operation: "order", id: "5O190127TN364715T" });
    expect(h.runTool).toHaveBeenCalledWith("get_order", { id: "5O190127TN364715T" });
    expect(result).toMatchObject({ source: "paypal-agent-toolkit", tool: "get_order", status: "COMPLETED", aiGenerated: false, model: null });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "paypal_agent.inspect", metadata: expect.objectContaining({ tool: "get_order", aiGenerated: false }) }));
  });

  it("sends only sanitized PayPal data to the configured LLM", async () => {
    const h = harness({
      ok: true,
      data: { status: "COMPLETED", summary: "Verified order.", findings: ["Amount is USD 15.00."], recommendedAction: "No action needed.", confidence: "high" },
      runId: "run-1",
      model: "thinkingmachines/Inkling",
      cached: false,
    });
    const result = await h.service.inspect(ADMIN, { operation: "order", id: "5O190127TN364715T", question: "Is it complete?" });
    const params = h.completeJson.mock.calls[0][0] as { user: string };
    expect(params.user).not.toContain("buyer@example.com");
    expect(params.user).not.toContain("Private");
    expect(params.user).toContain("15.00");
    expect(result).toMatchObject({ aiGenerated: true, model: "thinkingmachines/Inkling", summary: "Verified order." });
  });

  it("rejects non-admin callers before contacting PayPal", async () => {
    const h = harness();
    await expect(h.service.inspect({ id: "buyer", role: "buyer" }, { operation: "order", id: "5O190127TN364715T" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.runTool).not.toHaveBeenCalled();
  });
});
