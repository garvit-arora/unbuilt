import "server-only";
import type { Category } from "@/lib/categories";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { IntentSchema, type Intent, type PriceReference, type ProductType } from "@/lib/schemas/intent";
import { resolveIntraIntentConflicts } from "../constraint-compat";
import { normalizeTokens } from "../text-normalize";

/**
 * Deterministic Agent 1 fallback `heuristic-intent-v1` (design 7.4): keyword tables per category and constraint
 * tag, price regexes, a known-products list, clause splitting for missing capabilities and a title template.
 */

export const HEURISTIC_INTENT_ID = "heuristic-intent-v1";

export type HeuristicInput = { rawText: string; referenceUrl?: string | null; statedPriceCents?: number | null };

const TAG_PATTERNS: [ConstraintTag, RegExp][] = [
  [
    "deployment_offline",
    /\b(offline|off-line|without (an |any )?internet( connection)?|no internet|air[- ]?gapped|on[- ]device|runs? (entirely |completely |fully )?locally|local (llms?|models?)|locally[- ]run)\b/,
  ],
  ["deployment_local_first", /\blocal[- ]first\b|\b(stored|stores|kept|lives?) (locally|on (my|the|our) (own )?(device|machine|laptop|computer))\b/],
  ["deployment_self_hosted", /\bself[- ]host(ed|ing|able)?\b|\bon[- ]prem(ise)?s?\b|\bhost (it )?(myself|ourselves|on (my|our) own servers?)\b/],
  ["deployment_cloud_only", /\b(cloud[- ]only|only in the cloud|saas|(?<!self[- ])hosted (service|app|platform))\b/],
  [
    "privacy_no_data_upload",
    /\b((not|doesn'?t|don'?t|never|won'?t) (upload|send)s?|without (uploading|sending)|no cloud|privately|private (code|data|files|notes|documents)|privacy|never leaves? (my|the|our) (device|machine|laptop|network|servers?)|stays? on (my|the|our) (device|machine|laptop|servers?)|keeps? (my|our|the) \w+ private)\b/,
  ],
  ["collaboration_realtime", /\b(real[- ]?time|multiplayer|collaborative|team editing|pair[- ]programming|co-?edit(ing)?)\b/],
  [
    "pricing_no_subscription",
    /\b(no subscriptions?|without (a )?subscription|one[- ]time (purchase|payment|price|fee)|pay once|buy once|(doesn'?t|didn'?t|don'?t|wouldn'?t|not) require (a |an )?(\$\d+ )?(monthly |yearly |annual )?subscription)\b/,
  ],
  ["pricing_free", /(?<![\w-])free\b(?![- ](tier|trial))/],
  ["pricing_low_cost", /\b(cheap|affordable|inexpensive|low[- ]cost|budget[- ]friendly)\b/],
  ["open_source", /\bopen[- ]source\b|\bfoss\b|\bmit[- ]licen[cs]ed\b/],
  ["platform_desktop", /\b(desktop app|desktop application|on (my|the) desktop|windows app|mac app|macos app|linux app)\b/],
  ["platform_mobile", /\b(mobile app|on (my|the) phone|iphone|android|ios app|phone app)\b/],
  ["platform_browser", /\b(browser[- ]based|in the browser|in my browser|browser extension|chrome extension|web app)\b/],
  ["platform_cross_platform", /\bcross[- ]platform\b|\b(on|across) (all|every) (of )?(my )?devices\b|\bwindows,? mac(os)?,? and linux\b/],
  ["accessibility", /\b(accessib(le|ility)|screen[- ]readers?|a11y|wcag|colou?r[- ]blind|keyboard[- ]only)\b/],
  [
    "multilingual",
    /\b(multilingual|multi-lingual|(in|into) (my|their|our) (native|own|first) language|languages other than english|non-english|(several|multiple|many|other) languages|spanish|portuguese|hindi|mandarin|arabic)\b/,
  ],
  ["low_resource_hardware", /\b(\d+\s?gb (of )?ram|low[- ]end|old (laptop|computer|machine|hardware)|low[- ]resource|modest hardware|without a gpu|no gpu)\b/],
  ["integration_vscode", /\b(vs ?code|visual studio code)\b/],
];

const MAX_WILLING_RE =
  /\b(?:less than|under|below|max(?:imum)?(?: of)?|no more than|at most)\s*(?:\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b)/g;
const WOULD_PAY_RE = /\b(?:pay|spend)\s+(?:up to\s+|around\s+|about\s+)?\$\s?(\d+(?:\.\d{1,2})?)/g;
const RECURRING_RE = /\$\s?(\d+(?:\.\d{1,2})?)\s*(?:\/|a|per|each)?\s*(month(?:ly)?|mo|year(?:ly)?|yr|annual(?:ly)?)\b/g;
const ANY_DOLLAR_RE = /\$\s?(\d+(?:\.\d{1,2})?)/g;
/** Any price phrase; segments matching it are dropped from missing capabilities. */
const PRICE_SEGMENT_RE =
  /\b(less than|under|below|max(imum)?|no more than|at most)\s*\$?\d+|\$\s?\d+|\b\d+\s*(dollars|usd|bucks)\b|\b(costs?|price[ds]?|priced|subscription)\b/;

const CATEGORY_PATTERNS: [Category, RegExp][] = [
  [
    "developer_tools",
    /\b(cod(e|es|ing|er|ers)|developers?|programming|programmers?|ide|ides|editor|debug(ging)?|github|git|compilers?|refactor(ing)?|devops|documentation|docs|readmes?|repos?|repositor(y|ies)|codebases?|cobol|legacy (code|software|systems?|apps?)|pull requests?|api|apis|terminal|vs ?code|cursor|copilot)\b/g,
  ],
  ["design", /\b(design(s|ers?)?|figma|miro|mockups?|wireframes?|ui|ux|whiteboards?|boards?|brainstorm(s|ing)?|prototypes?|sketch(es)?|diagrams?|canvas)\b/g],
  ["education", /\b(learn(ing)?|tutor(ing|s)?|teach(ing|er|ers)?|students?|courses?|lessons?|study|studying|education|beginners?)\b/g],
  [
    "business_tools",
    /\b(business(es)?|analytics|crm|invoic(e|es|ing)|sales|spreadsheets?|excel|google sheets|reports?|dashboards?|visitors?|traffic|clients?)\b/g,
  ],
  [
    "productivity",
    /\b(notes?|note-taking|knowledge|second brain|todos?|to-dos?|tasks?|calendars?|meetings?|emails?|inbox|productivity|automat(e|es|ion|ions)|workflows?|bookmarks?|personal (files|documents)|routines?|calls?|zoom|transcri(be|bed|bes|ption|ptions)|summar(y|ies|ize|ized)|recordings?)\b/g,
  ],
  ["browser_extensions", /\b(browser extension|chrome extension|firefox add-?on|extensions?)\b/g],
  ["mobile_apps", /\b(mobile apps?|iphone|android|ios|phone apps?)\b/g],
  ["ai_products", /\b(ai|llms?|gpt|chatbots?|machine learning)\b/g],
  ["software", /\b(software|apps?|application|program|desktop)\b/g],
];

const AUDIENCES: Record<Category, string> = {
  software: "People who want better everyday software",
  developer_tools: "Software developers",
  productivity: "Knowledge workers and individuals organizing their work",
  education: "Learners and educators",
  design: "Designers and product teams",
  ai_products: "People adopting AI tools",
  business_tools: "Small businesses and teams",
  browser_extensions: "People who work in the browser",
  mobile_apps: "Mobile users",
};

const KNOWN_PRODUCTS = [
  "Cursor",
  "GitHub Copilot",
  "Copilot",
  "ChatGPT",
  "Notion",
  "Obsidian",
  "Evernote",
  "Excel",
  "Google Sheets",
  "Airtable",
  "Figma",
  "Miro",
  "Zoom",
  "Otter",
  "Google Analytics",
  "Zapier",
  "IFTTT",
  "Premiere",
  "DaVinci Resolve",
  "Duolingo",
  "Codecademy",
  "Confluence",
  "Mixpanel",
  "Teams",
];

const GENERAL_STOP = new Set(
  "a an the i we my our me to of for in on at by is are be it this that which who want wish need would like there were was some someone something can could please just really and or with so as if than then very".split(
    " ",
  ),
);

const TRIGGER_RE = /\b(want|wish|need|looking for|would love)\b/i;
const SPLIT_RE = /\b(?:that|which|and|with)\b|[,;]/i;
const LEADING_AUX_RE = /^(?:(?:i|we|it|that|to|can|should|must|will|also|is|are|be)\s+)+/i;

function normalizeQuotes(text: string): string {
  return text.replace(/[’‘`]/g, "'");
}

function dollarsToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function periodOf(word: string): PriceReference["period"] {
  return /^(year|yr|annual)/.test(word) ? "yearly" : "monthly";
}

export function extractConstraintTags(text: string): ConstraintTag[] {
  const lower = normalizeQuotes(text).toLowerCase();
  const tags: ConstraintTag[] = [];
  for (const [tag, pattern] of TAG_PATTERNS) if (pattern.test(lower)) tags.push(tag);
  const hasMaxPrice = new RegExp(MAX_WILLING_RE.source).test(lower);
  if (hasMaxPrice && !tags.includes("pricing_low_cost")) tags.push("pricing_low_cost");
  return resolveIntraIntentConflicts(tags);
}

export function extractPriceReferences(text: string, statedPriceCents?: number | null): PriceReference[] {
  const lower = normalizeQuotes(text).toLowerCase();
  const refs: PriceReference[] = [];
  const used = new Set<number>();
  const take = (index: number, ref: PriceReference) => {
    if (used.has(index) || refs.length >= 5) return;
    used.add(index);
    refs.push(ref);
  };
  const dollarIndex = (match: RegExpExecArray) => match.index + match[0].indexOf(match[1] ?? match[2] ?? "");

  for (const match of lower.matchAll(MAX_WILLING_RE)) {
    const amount = match[1] ?? match[2];
    const after = lower.slice(match.index + match[0].length, match.index + match[0].length + 20);
    const recurring = /^\s*(?:\/|a|per)?\s*(month|mo|year|yr|annual)/.exec(after);
    take(dollarIndex(match), {
      amountCents: dollarsToCents(amount),
      period: recurring ? periodOf(recurring[1]) : "unknown",
      relation: "max_willing",
    });
  }
  for (const match of lower.matchAll(WOULD_PAY_RE)) {
    take(dollarIndex(match), { amountCents: dollarsToCents(match[1]), period: "unknown", relation: "max_willing" });
  }
  for (const match of lower.matchAll(RECURRING_RE)) {
    take(dollarIndex(match), { amountCents: dollarsToCents(match[1]), period: periodOf(match[2]), relation: "current_alternative" });
  }
  for (const match of lower.matchAll(ANY_DOLLAR_RE)) {
    take(dollarIndex(match), { amountCents: dollarsToCents(match[1]), period: "unknown", relation: "mentioned" });
  }
  if (statedPriceCents && !refs.some((r) => r.relation === "max_willing" && r.amountCents === statedPriceCents) && refs.length < 5) {
    refs.push({ amountCents: statedPriceCents, period: "unknown", relation: "max_willing" });
  }
  return refs;
}

export function detectCategory(text: string): Category {
  const lower = normalizeQuotes(text).toLowerCase();
  let best: Category = "software";
  let bestScore = 0;
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    const score = [...lower.matchAll(pattern)].length;
    // CATEGORY_PATTERNS is in priority order, so ties keep the earlier (more specific) category.
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

export function extractAlternatives(text: string): string[] {
  const found: string[] = [];
  const add = (name: string) => {
    const clean = name.trim().slice(0, 80);
    if (clean && !found.some((f) => f.toLowerCase() === clean.toLowerCase())) found.push(clean);
  };
  for (const product of KNOWN_PRODUCTS) {
    const escaped = product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      // "Copilot" alone is skipped when "GitHub Copilot" was already found.
      if (!found.some((f) => f.toLowerCase().includes(product.toLowerCase()))) add(product);
    }
  }
  for (const match of text.matchAll(/\balternative (?:to|for) ([A-Z][\w.+-]*)/g)) add(match[1]);
  return found.slice(0, 8);
}

function contentWordCount(segment: string): number {
  return normalizeTokens(segment).length;
}

/** Clause splitting (design 7.4): after the first trigger word, split, drop the head phrase and price clauses. */
export function extractMissingCapabilities(text: string): string[] {
  const clean = normalizeQuotes(text);
  const trigger = TRIGGER_RE.exec(clean);
  if (!trigger) return [];
  const rest = clean.slice(trigger.index + trigger[0].length);
  const segments = rest.split(SPLIT_RE).slice(1);
  const out: string[] = [];
  for (const raw of segments) {
    let segment = raw.replace(/\s+/g, " ").trim();
    segment = segment.replace(LEADING_AUX_RE, "").replace(/[.!?]+$/, "").trim();
    if (!segment || PRICE_SEGMENT_RE.test(segment.toLowerCase())) continue;
    if (contentWordCount(segment) < 2) continue;
    const capped = segment.slice(0, 120);
    if (!out.some((existing) => existing.toLowerCase() === capped.toLowerCase())) out.push(capped);
    if (out.length >= 10) break;
  }
  return out;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function titleCase(word: string): string {
  return word.length <= 3 && word === word.toUpperCase() ? word : capitalize(word.toLowerCase());
}

export function buildTitle(text: string, category: Category, tags: readonly ConstraintTag[]): string {
  const lower = text.toLowerCase();
  if (category === "developer_tools" && /\b(assistant|copilot)\b/.test(lower)) {
    const prefix = tags.includes("deployment_offline") ? "offline " : tags.includes("privacy_no_data_upload") ? "private " : "";
    return capitalize(`${prefix}AI coding assistant`);
  }
  const trigger = TRIGGER_RE.exec(text);
  const source = trigger ? text.slice(trigger.index + trigger[0].length) : text;
  const words = normalizeQuotes(source)
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !GENERAL_STOP.has(word.toLowerCase().replace(/'/g, "")));
  const title = words.slice(0, 6).map(titleCase).join(" ").slice(0, 80).trim();
  return title.length >= 3 ? title : "Untitled wish";
}

function suggestProductType(text: string, category: Category, tags: readonly ConstraintTag[]): ProductType {
  const lower = text.toLowerCase();
  if (tags.includes("integration_vscode") || /\b(ide|editor) (plugin|extension)\b/.test(lower)) return "ide_plugin";
  if (/\b(browser extension|chrome extension|firefox add-?on)\b/.test(lower) || category === "browser_extensions") return "browser_extension";
  if (tags.includes("platform_mobile") || category === "mobile_apps") return "mobile_app";
  if (/\b(cli|command[- ]line|terminal)\b/.test(lower)) return "cli";
  if (/\b(api|sdk|webhook)\b/.test(lower)) return "api_service";
  if (tags.includes("deployment_offline") || tags.includes("platform_desktop")) return "desktop_app";
  return "web_app";
}

const TAG_NOTES: Partial<Record<ConstraintTag, string>> = {
  deployment_offline: "Must work without an internet connection",
  deployment_local_first: "Data lives on the user's device first",
  deployment_self_hosted: "Must be self-hostable",
  deployment_cloud_only: "Expected to run as a hosted cloud service",
  privacy_no_data_upload: "User data must not be uploaded to third parties",
  pricing_no_subscription: "No recurring subscription",
  pricing_low_cost: "Price sensitive",
  open_source: "Open source",
  low_resource_hardware: "Must run on modest hardware",
};

function firstSentence(text: string, max: number): string {
  const sentence = /^[\s\S]*?[.!?](\s|$)/.exec(text)?.[0] ?? text;
  const trimmed = sentence.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function interpretHeuristically(input: HeuristicInput): Intent {
  const text = input.rawText.trim();
  const lower = normalizeQuotes(text).toLowerCase();
  const constraintTags = extractConstraintTags(text);
  const category = detectCategory(text);
  const missingCapabilities = extractMissingCapabilities(text);
  const priceReferences = extractPriceReferences(text, input.statedPriceCents);
  const title = buildTitle(text, category, constraintTags);
  const desired = missingCapabilities.length
    ? `${capitalize(title.toLowerCase().startsWith("ai") ? title : title.charAt(0).toLowerCase() + title.slice(1))} that ${joinList(missingCapabilities)}.`
    : firstSentence(text, 400);

  const priceSensitivity: Intent["priceSensitivity"] =
    constraintTags.some((t) => t === "pricing_low_cost" || t === "pricing_free" || t === "pricing_no_subscription")
      ? "high"
      : priceReferences.length > 0
        ? "medium"
        : "low";
  const urgency: Intent["urgency"] = /\b(urgent|urgently|asap|desperately|immediately|right now|every day|daily|constantly)\b/.test(lower)
    ? "high"
    : /\b(someday|eventually|nice to have|one day)\b/.test(lower)
      ? "low"
      : "medium";

  const intent: Intent = {
    title,
    problemSummary: firstSentence(text, 400),
    desiredOutcome: desired.length <= 400 ? desired : `${desired.slice(0, 399)}…`,
    currentAlternatives: extractAlternatives(text),
    missingCapabilities,
    targetAudience: AUDIENCES[category],
    category,
    suggestedProductType: suggestProductType(text, category, constraintTags),
    constraintTags,
    constraintNotes: constraintTags.map((tag) => TAG_NOTES[tag]).filter((note): note is string => Boolean(note)).slice(0, 8),
    priceReferences,
    priceSensitivity,
    urgency,
    confidence: 0.4,
  };
  return IntentSchema.parse(intent);
}
