import "server-only";
import type { Blueprint } from "./schemas";

/** Pure Markdown rendering of a `BlueprintSchema` value (stored in `cluster_blueprints.markdown`, exported as .md). */

const list = (items: readonly string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- None stated");

export function blueprintToMarkdown(title: string, blueprint: Blueprint, label?: string): string {
  const sections = [
    `# ${title}: product blueprint`,
    ...(label ? [`_${label}_`] : []),
    `## Vision\n\n${blueprint.vision}`,
    `## Problem\n\n${blueprint.problem}`,
    `## Target customers\n\n${list(blueprint.targetCustomers)}`,
    `## Core requirements\n\n${list(blueprint.coreRequirements)}`,
    `## Non-functional requirements\n\n${list(blueprint.nonFunctionalRequirements)}`,
    `## MVP scope\n\n${list(blueprint.mvpScope)}`,
    `## Out of scope\n\n${list(blueprint.outOfScope)}`,
    `## Architecture\n\n${blueprint.architecture.summary}\n\n**Components**\n\n${list(blueprint.architecture.components)}\n\n**Suggested stack**\n\n${list(blueprint.architecture.suggestedStack)}`,
    `## Milestones\n\n${blueprint.milestones
      .map((m, i) => `${i + 1}. **${m.title}** (${m.durationWeeks} ${m.durationWeeks === 1 ? "week" : "weeks"})\n${m.deliverables.map((d) => `   - ${d}`).join("\n")}`)
      .join("\n")}`,
    `## Business model\n\n${blueprint.businessModel}`,
    `## Complexity\n\n${blueprint.complexity} / 5`,
    `## Risks\n\n${blueprint.risks.map((r) => `- **${r.risk}**: ${r.mitigation}`).join("\n") || "- None stated"}`,
    `## Acceptance criteria\n\n${list(blueprint.acceptanceCriteria)}`,
  ];
  return `${sections.join("\n\n")}\n`;
}
