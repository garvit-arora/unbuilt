import "server-only";
import { randomUUID } from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { env } from "@/server/config/env";
import { AppError } from "@/server/http/errors";

/**
 * Isolated PayPal Agent Toolkit adapter.
 *
 * Only read operations are enabled. The existing checkout/refund services remain
 * the sole code paths that may create orders, capture money, or issue refunds.
 */

export type PayPalReadTool = "get_order" | "get_refund" | "list_transactions";

export const PAYPAL_COPILOT_ACTIONS = Object.freeze({
  orders: Object.freeze({ get: true }),
  payments: Object.freeze({ getRefunds: true }),
  transactions: Object.freeze({ list: true }),
});

type ToolCallResult = { content: unknown };

export type PayPalReadToolRunner = (tool: PayPalReadTool, args: Record<string, unknown>) => Promise<unknown>;

let toolkit: PayPalAgentToolkit | null = null;

function configuredToolkit(): PayPalAgentToolkit {
  if (!env.paypal.configured || !env.paypal.clientId || !env.paypal.clientSecret) {
    throw new AppError("PAYPAL_NOT_CONFIGURED", 503, "PayPal Sandbox is not configured for the operations copilot.");
  }
  if (env.paypal.env !== "sandbox") {
    throw new AppError("PAYPAL_NOT_CONFIGURED", 503, "The PayPal operations copilot is restricted to Sandbox.");
  }
  toolkit ??= new PayPalAgentToolkit({
    clientId: env.paypal.clientId,
    clientSecret: env.paypal.clientSecret,
    configuration: {
      actions: PAYPAL_COPILOT_ACTIONS,
      context: { sandbox: true, debug: false, source: "UNBUILT PayPal Operations Copilot" },
    },
  });
  return toolkit;
}

function parseToolContent(result: ToolCallResult): unknown {
  const content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal Agent Toolkit returned an unreadable response.");
  }
}

export const runPayPalReadTool: PayPalReadToolRunner = async (tool, args) => {
  const enabled = configuredToolkit().getTools().some((candidate) => candidate.function.name === tool);
  if (!enabled) throw new AppError("FORBIDDEN", 403, "That PayPal Agent Toolkit action is disabled.");

  const result = await configuredToolkit().handleToolCall({
    id: `unbuilt-${randomUUID()}`,
    type: "function",
    function: { name: tool, arguments: JSON.stringify(args) },
  });
  const parsed = parseToolContent(result);
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal could not return that Sandbox record yet.");
  }
  return parsed;
};
