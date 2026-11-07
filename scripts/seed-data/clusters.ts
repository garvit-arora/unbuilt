/**
 * The 12 seeded demand clusters (spec section 18, design 13 step 3). Everything here is synthetic demo data and is
 * stored with `is_demo=true`. The wording of the "Offline AI coding assistant" features is pinned by
 * tests/unit/matching.calibration.test.ts (scene 1 must map to them).
 */
import type { Category } from "@/lib/categories";
import type { ConstraintTag } from "@/lib/constraint-tags";

export type SeedFeature = { title: string; description?: string };

export type SeedRequest = {
  text: string;
  /** Stated target price in whole dollars (the price-qualified intent uses it). */
  targetDollars: number;
};

export type SeedProposal = {
  /** demo-builder-01..03 */
  builder: 1 | 2 | 3;
  title: string;
  description: string;
  approach: string;
  scope: string;
  timeline: string;
  priceDollars: number;
  techStack: string[];
  status: "submitted" | "building";
};

export type SeedCluster = {
  key: string;
  slug: string;
  title: string;
  category: Category;
  difficulty: 1 | 2 | 3 | 4 | 5;
  problemStatement: string;
  description: string;
  targetAudience: string;
  tags: ConstraintTag[];
  notes: string[];
  required: SeedFeature[];
  niceToHave: SeedFeature[];
  /** A requirement that emerged later: written as feature + v2 snapshot (4 clusters). */
  emerged?: SeedFeature & { daysAgo: number };
  /** Days before now of the first member's join (the cluster's created_at). */
  startDaysAgo: number;
  /** `front` puts most joins in the last 7 days (fastest growing). */
  growth: "steady" | "front";
  requests: SeedRequest[];
  proposals: SeedProposal[];
  blueprint: {
    architectureSummary: string;
    components: string[];
    stack: string[];
    businessModel: string;
    risks: { risk: string; mitigation: string }[];
  };
};

export const SEED_CLUSTERS: SeedCluster[] = [
  {
    key: "offline-coding",
    slug: "offline-ai-coding-assistant",
    title: "Offline AI coding assistant",
    category: "developer_tools",
    difficulty: 3,
    problemStatement:
      "Developers who cannot or will not send source code to third-party servers have no good AI coding assistant: the popular tools require a cloud connection and a monthly subscription.",
    description:
      "An AI coding assistant that runs completely on the developer's own machine with local models, never uploads code, and costs less than the cloud subscriptions it replaces.",
    targetAudience: "Developers at privacy-sensitive companies, freelancers on a budget, and anyone coding without reliable internet",
    tags: ["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"],
    notes: ["Must work without an internet connection", "Source code must never leave the machine", "Under $20"],
    required: [
      { title: "Works fully offline" },
      { title: "Runs local models (e.g. via Ollama)" },
      { title: "Never uploads private code" },
      { title: "Costs under $20" },
      { title: "Inline code completion in the editor" },
    ],
    niceToHave: [{ title: "Chat about the local codebase" }, { title: "One-time purchase option" }],
    emerged: { title: "Works on 8 GB RAM laptops", daysAgo: 12 },
    startDaysAgo: 58,
    growth: "front",
    requests: [
      {
        text: "I want a coding assistant that works offline on my laptop, runs local models through Ollama, and never uploads my private code.",
        targetDollars: 15,
      },
      { text: "Looking for an offline alternative to Cursor with code completion that doesn't send my code to the cloud.", targetDollars: 20 },
      {
        text: "I need an AI pair programmer that runs entirely locally because my company forbids putting source code on outside servers.",
        targetDollars: 18,
      },
      { text: "I wish Copilot had an offline mode that used a local model and cost less than $10 a month.", targetDollars: 10 },
      { text: "I want private code completion for air-gapped machines, with local LLMs and no subscription.", targetDollars: 19 },
      { text: "I need a cheap coding assistant that works without internet on flights and keeps my code private.", targetDollars: 12 },
      {
        text: "I would love a local-model coding helper for VS Code that never sends code anywhere and is affordable.",
        targetDollars: 15,
      },
      {
        text: "I want an AI coding assistant that runs on my own laptop with Ollama, chats about my codebase, and costs under $20.",
        targetDollars: 20,
      },
    ],
    proposals: [
      {
        builder: 1,
        title: "PrivateCoder for VS Code",
        description: "A VS Code extension that serves completions from a local Ollama model and blocks all outbound network calls.",
        approach: "Wrap the Ollama HTTP API in a VS Code inline-completion provider and ship tuned prompts for small code models.",
        scope: "Inline completion, a local chat panel and a network-egress self-test. No cloud features.",
        timeline: "6 weeks to a public beta",
        priceDollars: 19,
        techStack: ["TypeScript", "VS Code API", "Ollama"],
        status: "submitted",
      },
    ],
    blueprint: {
      architectureSummary:
        "An editor extension talks to a model runtime on localhost; nothing is sent beyond the loopback interface. A small indexer keeps embeddings of the open workspace on disk.",
      components: ["Editor extension (completion + chat)", "Local model runtime (Ollama)", "On-disk workspace index", "Network egress self-test"],
      stack: ["TypeScript", "VS Code extension API", "Ollama", "SQLite"],
      businessModel: "One-time purchase under $20 with free minor updates; no account required.",
      risks: [
        { risk: "Small local models produce weaker completions than cloud models", mitigation: "Ship curated model presets per RAM size and let users swap models" },
        { risk: "Users cannot verify that nothing leaves the machine", mitigation: "Document and test a no-egress check users can run themselves" },
      ],
    },
  },
  {
    key: "knowledge-search",
    slug: "privacy-first-personal-knowledge-search",
    title: "Privacy-first personal knowledge search",
    category: "productivity",
    difficulty: 3,
    problemStatement:
      "People keep notes, PDFs and documents in many places, and the AI search tools that could answer questions over them require uploading everything to someone else's servers.",
    description: "Natural-language search over personal notes and documents with the index stored on the user's own device.",
    targetAudience: "Researchers, writers and knowledge workers with large personal archives",
    tags: ["privacy_no_data_upload", "deployment_local_first"],
    notes: ["Index stays on the device", "No account or upload required"],
    required: [
      { title: "Searches all my notes and documents" },
      { title: "Indexes files locally" },
      { title: "Never uploads my data" },
      { title: "Natural-language questions over my files" },
      { title: "Works with Markdown and PDF" },
    ],
    niceToHave: [{ title: "Obsidian vault support" }, { title: "Encrypted index" }],
    emerged: { title: "Searches email archives", daysAgo: 20 },
    startDaysAgo: 55,
    growth: "steady",
    requests: [
      { text: "I want a search tool that indexes my notes and PDFs locally and never uploads my data anywhere.", targetDollars: 12 },
      { text: "I need a private second brain search that answers natural-language questions over my files.", targetDollars: 15 },
      { text: "I wish my Obsidian vault had semantic search that runs locally and keeps my notes private.", targetDollars: 10 },
      { text: "Looking for a local-first knowledge search across Markdown notes, PDFs and bookmarks.", targetDollars: 8 },
      { text: "I want to ask questions about my personal documents without sending them to a cloud AI.", targetDollars: 20 },
      { text: "I need a privacy-first search for research papers and notes with an encrypted index.", targetDollars: 25 },
      { text: "I would love a personal search engine for my documents that stays on my laptop.", targetDollars: 10 },
    ],
    proposals: [
      {
        builder: 2,
        title: "Lantern: local semantic search",
        description: "A desktop indexer that answers questions over Markdown and PDF files with a small local embedding model.",
        approach: "Incremental file watcher, local embeddings, hybrid keyword + vector search, answer snippets with file links.",
        scope: "Markdown, PDF and plain text. Obsidian vault detection. No sync.",
        timeline: "8 weeks",
        priceDollars: 15,
        techStack: ["Rust", "Tauri", "SQLite", "ONNX Runtime"],
        status: "building",
      },
    ],
    blueprint: {
      architectureSummary: "A background indexer watches chosen folders, extracts text and stores embeddings in a local database queried by a desktop UI.",
      components: ["Folder watcher and text extractor", "Local embedding model", "Hybrid search index", "Desktop search UI"],
      stack: ["Rust", "Tauri", "SQLite with vector extension"],
      businessModel: "Free tier for one folder; one-time licence for unlimited folders.",
      risks: [{ risk: "PDF extraction quality varies", mitigation: "Show the source passage with every answer so users can verify it" }],
    },
  },
  {
    key: "spreadsheet-automation",
    slug: "ai-native-spreadsheet-automation",
    title: "AI-native spreadsheet automation",
    category: "business_tools",
    difficulty: 3,
    problemStatement:
      "Small teams spend hours every week on repetitive spreadsheet work, and macros or scripts are too hard to write and maintain for most of them.",
    description: "Describe a spreadsheet task in plain English and get a reliable, explained automation for Excel or Google Sheets.",
    targetAudience: "Small-business owners, operations staff and analysts who live in spreadsheets",
    tags: [],
    notes: ["Every generated formula must be explained"],
    required: [
      { title: "Describe automations in plain English" },
      { title: "Works with Excel and Google Sheets" },
      { title: "Cleans and deduplicates rows" },
      { title: "Explains every formula it writes" },
      { title: "Scheduled refresh of reports" },
    ],
    niceToHave: [{ title: "Undo history for AI edits" }, { title: "Pulls data from CSV exports" }],
    startDaysAgo: 50,
    growth: "front",
    requests: [
      { text: "I want spreadsheet automation where I describe the task in plain English and it writes the formulas.", targetDollars: 30 },
      { text: "I need an AI for Google Sheets that cleans messy rows, removes duplicates and explains every formula.", targetDollars: 25 },
      { text: "I wish Excel could build my weekly sales report automatically from CSV exports.", targetDollars: 40 },
      { text: "Looking for a spreadsheet copilot that automates repetitive data cleanup for small business invoices.", targetDollars: 20 },
      { text: "I want to automate monthly budget reports in spreadsheets without learning macros.", targetDollars: 15 },
      { text: "I need an assistant that turns plain-English requests into spreadsheet automations with an undo history.", targetDollars: 35 },
      { text: "I would love scheduled spreadsheet reports that refresh themselves and flag errors in the data.", targetDollars: 30 },
      { text: "I want an AI-native spreadsheet tool that merges client lists and fixes formatting automatically.", targetDollars: 25 },
    ],
    proposals: [
      {
        builder: 3,
        title: "SheetPilot",
        description: "A Google Sheets add-on that turns plain-English instructions into explained formulas and Apps Script automations.",
        approach: "Constrained generation into a small DSL that compiles to formulas, with a preview diff before applying.",
        scope: "Google Sheets first; Excel via Office add-in in a later milestone.",
        timeline: "10 weeks",
        priceDollars: 25,
        techStack: ["TypeScript", "Apps Script", "Office.js"],
        status: "submitted",
      },
      {
        builder: 1,
        title: "Tabular Flows",
        description: "Scheduled spreadsheet reports built from CSV exports with plain-English steps.",
        approach: "A desktop runner that applies recorded steps to new CSV files on a schedule.",
        scope: "CSV import, cleanup steps, scheduled export to Excel.",
        timeline: "6 weeks",
        priceDollars: 30,
        techStack: ["Python", "DuckDB"],
        status: "building",
      },
    ],
    blueprint: {
      architectureSummary: "An add-on translates instructions into a reviewable plan of spreadsheet operations, previews the diff and applies it with undo.",
      components: ["Instruction parser", "Operation planner with preview", "Formula explainer", "Scheduler"],
      stack: ["TypeScript", "Google Apps Script", "Office.js"],
      businessModel: "Monthly plan for teams, discounted annual plan for individuals.",
      risks: [{ risk: "Silent data corruption from a wrong automation", mitigation: "Mandatory preview diff and one-click undo for every AI edit" }],
    },
  },
  {
    key: "whiteboard",
    slug: "local-first-collaborative-whiteboard",
    title: "Local-first collaborative whiteboard",
    category: "design",
    difficulty: 4,
    problemStatement: "Online whiteboards stop working without internet and keep every board on a vendor's servers.",
    description: "A whiteboard whose boards live on the user's device, work offline, and sync for real-time collaboration when online.",
    targetAudience: "Design teams, facilitators and remote teams with unreliable connections",
    tags: ["deployment_local_first", "collaboration_realtime"],
    notes: ["Boards are stored locally first", "Collaboration syncs when online"],
    required: [
      { title: "Works offline and syncs later" },
      { title: "Real-time collaboration when online" },
      { title: "Infinite canvas with sticky notes" },
      { title: "Boards stored on my device" },
      { title: "Export to PNG and PDF" },
    ],
    niceToHave: [{ title: "Self-hosted sync server" }, { title: "Diagram shapes library" }],
    emerged: { title: "End-to-end encrypted sync", daysAgo: 9 },
    startDaysAgo: 45,
    growth: "steady",
    requests: [
      { text: "I want a local-first whiteboard that works offline and syncs with my team when we reconnect.", targetDollars: 12 },
      { text: "I need a collaborative whiteboard with real-time editing where the boards live on my own device.", targetDollars: 15 },
      { text: "I wish there were a Miro alternative that stores boards locally and still lets us brainstorm together.", targetDollars: 10 },
      { text: "Looking for an infinite canvas with sticky notes that works on a plane and syncs later.", targetDollars: 8 },
      { text: "I want a whiteboard for design workshops with self-hosted sync and export to PDF.", targetDollars: 20 },
      { text: "I need a multiplayer diagram canvas that keeps working when the internet drops.", targetDollars: 12 },
    ],
    proposals: [],
    blueprint: {
      architectureSummary: "Boards are CRDT documents stored locally; an optional relay merges changes between peers when they are online.",
      components: ["Canvas renderer", "CRDT document store", "Sync relay", "Exporter"],
      stack: ["TypeScript", "Yjs", "IndexedDB", "WebRTC"],
      businessModel: "Free for personal use; paid team plan for the hosted relay, free self-hosted relay.",
      risks: [{ risk: "Merge conflicts on simultaneous edits", mitigation: "Use a CRDT so concurrent edits always converge" }],
    },
  },
  {
    key: "design-to-code",
    slug: "accessible-design-to-code-tool",
    title: "Accessible design-to-code tool",
    category: "design",
    difficulty: 4,
    problemStatement: "Design-to-code converters produce markup that fails accessibility audits, so teams rewrite the generated code by hand.",
    description: "Turns design files into semantic, accessible front-end code with contrast checks, keyboard support and screen-reader labels.",
    targetAudience: "Front-end teams and agencies that must meet WCAG",
    tags: ["accessibility"],
    notes: ["Output must meet WCAG 2.2 AA"],
    required: [
      { title: "Turns Figma designs into code" },
      { title: "Generates accessible semantic HTML" },
      { title: "Checks color contrast (WCAG)" },
      { title: "Keyboard navigation out of the box" },
      { title: "Screen-reader labels on every control" },
    ],
    niceToHave: [{ title: "React and Tailwind output" }, { title: "Accessibility report per screen" }],
    startDaysAgo: 40,
    growth: "steady",
    requests: [
      { text: "I want a design-to-code tool that turns Figma frames into accessible semantic HTML.", targetDollars: 40 },
      { text: "I need generated code from my mockups that passes WCAG contrast checks and works with screen readers.", targetDollars: 50 },
      { text: "I wish design handoff produced React components with keyboard navigation built in.", targetDollars: 35 },
      { text: "Looking for a Figma to code converter that adds screen-reader labels and an accessibility report.", targetDollars: 45 },
      { text: "I want accessible UI code from wireframes so my team stops failing audits.", targetDollars: 30 },
      { text: "I need a design-to-code tool for color-blind friendly palettes and accessible Tailwind output.", targetDollars: 25 },
    ],
    proposals: [],
    blueprint: {
      architectureSummary: "A plugin reads the design tree, infers semantic roles, and emits components that pass an automated accessibility test suite.",
      components: ["Design file reader", "Semantic role inference", "Code generator", "Accessibility checker"],
      stack: ["TypeScript", "Figma plugin API", "axe-core"],
      businessModel: "Per-seat monthly licence for teams.",
      risks: [{ risk: "Role inference guesses wrong for custom widgets", mitigation: "Let designers annotate roles and show a review list before export" }],
    },
  },
  {
    key: "coding-tutor",
    slug: "multilingual-coding-tutor",
    title: "Multilingual coding tutor",
    category: "education",
    difficulty: 3,
    problemStatement: "Most programming courses and AI tutors assume fluent English, which shuts out millions of beginners.",
    description: "An affordable coding tutor that explains concepts and gives feedback in the learner's own language.",
    targetAudience: "Beginner programmers and students who learn best in their first language",
    tags: ["multilingual", "pricing_low_cost"],
    notes: ["Explanations in the learner's language", "Student-friendly price"],
    required: [
      { title: "Explains code in my native language" },
      { title: "Interactive coding exercises" },
      { title: "Feedback on my mistakes" },
      { title: "Supports beginner learners" },
      { title: "Affordable for students" },
    ],
    niceToHave: [{ title: "Voice explanations" }, { title: "Works on low-end laptops" }],
    startDaysAgo: 35,
    growth: "steady",
    requests: [
      { text: "I want a coding tutor that explains programming concepts in my native language with interactive exercises.", targetDollars: 10 },
      { text: "I need an affordable programming tutor for students who learn better in Spanish.", targetDollars: 8 },
      { text: "I wish there were a beginner coding course that gives feedback on my mistakes in Portuguese.", targetDollars: 12 },
      { text: "Looking for a multilingual tutor that teaches Python to beginners and is cheap for students.", targetDollars: 5 },
      { text: "I want my kids to learn coding with lessons in Hindi and step-by-step feedback.", targetDollars: 10 },
      { text: "I need a coding teacher that switches between languages and checks my exercises.", targetDollars: 9 },
      { text: "I would love an AI tutor for programming in my first language with voice explanations.", targetDollars: 15 },
    ],
    proposals: [],
    blueprint: {
      architectureSummary: "A web app pairs graded exercises with a tutor model prompted to answer in the learner's chosen language.",
      components: ["Exercise runner", "Feedback engine", "Language-aware explanations", "Progress tracker"],
      stack: ["TypeScript", "Next.js", "WebAssembly Python runtime"],
      businessModel: "Low monthly student price with regional pricing.",
      risks: [{ risk: "Explanation quality differs by language", mitigation: "Review a sample of answers per language with native speakers" }],
    },
  },
  {
    key: "self-hosted-analytics",
    slug: "lightweight-self-hosted-analytics",
    title: "Lightweight self-hosted analytics",
    category: "business_tools",
    difficulty: 2,
    problemStatement: "Website owners want simple traffic numbers without cookies, consent banners or handing visitor data to an ad company.",
    description: "Open-source, cookie-free web analytics that runs on a small server the owner controls.",
    targetAudience: "Bloggers, indie makers and agencies running client sites",
    tags: ["deployment_self_hosted", "privacy_no_data_upload", "open_source"],
    notes: ["Visitor data stays on the owner's server", "No cookies"],
    required: [
      { title: "Self-hosted on a small server" },
      { title: "No cookies or personal data" },
      { title: "Simple dashboard of visitors and pages" },
      { title: "Lightweight tracking script" },
      { title: "Open source" },
    ],
    niceToHave: [{ title: "Docker one-line install" }, { title: "Goals and events" }],
    emerged: { title: "Imports Google Analytics history", daysAgo: 15 },
    startDaysAgo: 60,
    growth: "steady",
    requests: [
      { text: "I want a self-hosted analytics tool with a simple dashboard and no cookies.", targetDollars: 9 },
      { text: "I need lightweight website analytics I can host on my own server without tracking personal data.", targetDollars: 10 },
      { text: "I wish there were an open-source Google Analytics alternative with a tiny tracking script.", targetDollars: 5 },
      { text: "Looking for privacy-friendly visitor analytics that installs with one Docker command on my VPS.", targetDollars: 12 },
      { text: "I want simple traffic stats for my blog that I host myself, with goals and events.", targetDollars: 8 },
      { text: "I need self-hosted analytics for client sites that keeps visitor data on our servers.", targetDollars: 20 },
      { text: "I would love open-source analytics that runs on a cheap server and shows pages and referrers.", targetDollars: 6 },
    ],
    proposals: [
      {
        builder: 2,
        title: "Tally: tiny self-hosted analytics",
        description: "A single Go binary with a 1 KB tracking script and a SQLite store.",
        approach: "Aggregate on ingest so no per-visitor records are kept; daily salted hashes for unique counts.",
        scope: "Pages, referrers, countries, goals. Docker image and systemd unit.",
        timeline: "4 weeks",
        priceDollars: 9,
        techStack: ["Go", "SQLite", "Preact"],
        status: "submitted",
      },
    ],
    blueprint: {
      architectureSummary: "A single binary serves the tracking endpoint and dashboard and stores pre-aggregated counts in an embedded database.",
      components: ["Tracking script", "Ingest endpoint", "Aggregation store", "Dashboard"],
      stack: ["Go", "SQLite", "Preact"],
      businessModel: "Open source and free to self-host; paid support plans for agencies.",
      risks: [{ risk: "Unique-visitor counts without cookies are approximate", mitigation: "Label the metric as an estimate and document the method" }],
    },
  },
  {
    key: "video-copilot",
    slug: "open-source-video-editing-copilot",
    title: "Open-source video editing copilot",
    category: "software",
    difficulty: 5,
    problemStatement: "AI editing features are locked inside expensive proprietary editors, while open-source editors have none.",
    description: "An open-source assistant for desktop video editors that removes silences, writes captions locally and suggests cuts.",
    targetAudience: "Podcasters, YouTubers and educators who edit their own videos",
    tags: ["open_source", "platform_desktop"],
    notes: ["Open-source licence", "Runs inside a desktop editor"],
    required: [
      { title: "Cuts silences and filler words automatically" },
      { title: "Generates captions locally" },
      { title: "Suggests B-roll and cuts" },
      { title: "Open source" },
      { title: "Runs as a desktop app" },
    ],
    niceToHave: [{ title: "Plugin for Kdenlive or Shotcut" }, { title: "Exports to common formats" }],
    startDaysAgo: 12,
    growth: "front",
    requests: [
      { text: "I want an open-source video editing copilot that cuts silences and filler words automatically.", targetDollars: 20 },
      { text: "I need a desktop app that generates captions locally and suggests cuts for my YouTube videos.", targetDollars: 25 },
      { text: "I wish there were an AI assistant for Kdenlive that suggests B-roll and trims footage.", targetDollars: 15 },
      { text: "Looking for an open-source alternative to Premiere's AI features that runs on my PC.", targetDollars: 30 },
      { text: "I want automatic rough cuts for podcast videos in an open-source editor.", targetDollars: 20 },
    ],
    proposals: [],
    blueprint: {
      architectureSummary: "A desktop companion analyses audio and transcripts locally and writes edit decisions back to the editor's project file.",
      components: ["Local speech-to-text", "Silence and filler detector", "Edit decision writer", "Editor plugin"],
      stack: ["Python", "whisper.cpp", "FFmpeg", "Kdenlive MLT"],
      businessModel: "Open source with paid pre-built installers and priority support.",
      risks: [{ risk: "Editor project formats change between versions", mitigation: "Target the MLT XML format and test against each release" }],
    },
  },
  {
    key: "dev-docs",
    slug: "automated-developer-documentation-maintenance",
    title: "Automated developer documentation maintenance",
    category: "developer_tools",
    difficulty: 3,
    problemStatement: "Developer documentation drifts out of date with every merge, and nobody has time to keep READMEs and API references accurate.",
    description: "A repository bot that detects outdated docs after code changes and proposes fixes as pull requests.",
    targetAudience: "Open-source maintainers and engineering teams with public APIs",
    tags: [],
    notes: ["Changes are proposed, never pushed directly"],
    required: [
      { title: "Updates docs when code changes" },
      { title: "Opens pull requests with doc fixes" },
      { title: "Detects outdated README sections" },
      { title: "Generates API reference from code" },
      { title: "Works with GitHub" },
    ],
    niceToHave: [{ title: "Changelog drafts" }, { title: "Style guide checks" }],
    startDaysAgo: 30,
    growth: "steady",
    requests: [
      { text: "I want a tool that updates our docs automatically when the code changes and opens pull requests.", targetDollars: 30 },
      { text: "I need something that detects outdated README sections after every merge.", targetDollars: 20 },
      { text: "I wish our API reference generated itself from the code and stayed accurate.", targetDollars: 25 },
      { text: "Looking for a GitHub bot that keeps developer documentation in sync with the repository.", targetDollars: 15 },
      { text: "I want changelog drafts and doc fixes proposed for each pull request.", targetDollars: 20 },
      { text: "I need automated documentation maintenance for a large codebase with a style guide check.", targetDollars: 50 },
    ],
    proposals: [],
    blueprint: {
      architectureSummary: "A GitHub App diffs each merged change against the docs that reference the touched symbols and opens a pull request with suggested edits.",
      components: ["GitHub App webhook handler", "Symbol-to-docs index", "Doc diff generator", "Pull request writer"],
      stack: ["TypeScript", "GitHub Apps", "tree-sitter"],
      businessModel: "Free for public repositories; per-repository monthly price for private ones.",
      risks: [{ risk: "Noisy pull requests annoy maintainers", mitigation: "Batch suggestions per release and let maintainers set a confidence threshold" }],
    },
  },
  {
    key: "personal-automation",
    slug: "cross-platform-personal-automation-engine",
    title: "Cross-platform personal automation engine",
    category: "productivity",
    difficulty: 4,
    problemStatement: "Personal automation tools are either cloud-only services or tied to one operating system.",
    description: "A no-code automation engine that runs locally on every desktop OS and syncs workflows across the user's devices.",
    targetAudience: "Power users and small teams who juggle several devices",
    tags: ["platform_cross_platform", "deployment_local_first"],
    notes: ["Workflows run on the user's devices"],
    required: [
      { title: "Runs on Windows, Mac and Linux" },
      { title: "Triggers on files, time and apps" },
      { title: "No-code workflow builder" },
      { title: "Runs automations locally" },
      { title: "Syncs across all my devices" },
    ],
    niceToHave: [{ title: "Phone notifications" }, { title: "Script steps for power users" }],
    startDaysAgo: 10,
    growth: "front",
    requests: [
      { text: "I want a personal automation engine that runs on Windows, Mac and Linux with a no-code builder.", targetDollars: 10 },
      { text: "I need workflows that trigger on files and time and run locally instead of through Zapier.", targetDollars: 8 },
      { text: "I wish there were an IFTTT alternative that works across all my devices without an account.", targetDollars: 5 },
      { text: "Looking for cross-platform automation for my routines with script steps for power users.", targetDollars: 12 },
      { text: "I want desktop and phone automations that sync and keep my data local-first.", targetDollars: 10 },
    ],
    proposals: [],
    blueprint: {
      architectureSummary: "A small daemon per device evaluates triggers locally; workflow definitions sync through an end-to-end encrypted channel.",
      components: ["Trigger daemon", "Visual workflow builder", "Encrypted workflow sync", "Step runtime"],
      stack: ["Rust", "Tauri", "SQLite"],
      businessModel: "Free single-device use; one-time licence for multi-device sync.",
      risks: [{ risk: "OS permission models differ", mitigation: "Ship per-OS permission guides and degrade triggers gracefully" }],
    },
  },
  {
    key: "meeting-notes",
    slug: "privacy-preserving-meeting-notes",
    title: "Privacy-preserving meeting notes",
    category: "productivity",
    difficulty: 3,
    problemStatement: "AI note takers upload confidential meeting audio to third-party servers, which many professions cannot allow.",
    description: "Meeting transcription and summaries that run entirely on the user's computer, so audio never leaves it.",
    targetAudience: "Consultants, therapists, lawyers and teams handling confidential conversations",
    tags: ["privacy_no_data_upload", "deployment_offline"],
    notes: ["Audio never leaves the device", "Works offline"],
    required: [
      { title: "Transcribes meetings on my device" },
      { title: "Summaries with action items" },
      { title: "Audio never leaves my machine" },
      { title: "Works with Zoom and Teams calls" },
      { title: "Speaker labels" },
    ],
    niceToHave: [{ title: "Searchable meeting archive" }, { title: "Exports to Notion" }],
    startDaysAgo: 48,
    growth: "front",
    requests: [
      { text: "I want meeting notes that are transcribed on my device and the audio never leaves my machine.", targetDollars: 15 },
      { text: "I need an Otter alternative that works offline and gives me summaries with action items.", targetDollars: 12 },
      { text: "I wish Zoom calls could be summarized privately without uploading recordings to the cloud.", targetDollars: 15 },
      { text: "Looking for local transcription of client calls with speaker labels for confidential work.", targetDollars: 25 },
      { text: "I want private meeting summaries for Teams calls that run entirely on my laptop.", targetDollars: 20 },
      { text: "I need meeting notes for therapy sessions that never upload audio anywhere.", targetDollars: 30 },
      { text: "I would love an offline note taker with a searchable archive of past meetings.", targetDollars: 10 },
      { text: "I want on-device meeting transcription that exports action items to Notion.", targetDollars: 12 },
    ],
    proposals: [
      {
        builder: 3,
        title: "Quiet Minutes",
        description: "A menu-bar app that records system audio, transcribes with whisper.cpp and summarizes with a local model.",
        approach: "Local speech-to-text plus speaker diarization, then a small local model for action items.",
        scope: "macOS and Windows, Zoom and Teams audio, Markdown export.",
        timeline: "8 weeks",
        priceDollars: 15,
        techStack: ["Swift", "C++", "whisper.cpp", "llama.cpp"],
        status: "building",
      },
    ],
    blueprint: {
      architectureSummary: "A desktop recorder captures call audio, transcribes and summarizes it with local models, and stores notes in a local archive.",
      components: ["Audio capture", "Local transcription", "Speaker diarization", "Local summarizer", "Notes archive"],
      stack: ["Swift / C#", "whisper.cpp", "llama.cpp", "SQLite"],
      businessModel: "One-time purchase with optional paid model packs.",
      risks: [{ risk: "Recording consent rules differ by country", mitigation: "Show a consent reminder and an in-call indicator" }],
    },
  },
  {
    key: "legacy-modernization",
    slug: "ai-assisted-legacy-software-modernization",
    title: "AI-assisted legacy software modernization",
    category: "developer_tools",
    difficulty: 5,
    problemStatement:
      "Companies depend on decades-old systems that few people understand, and rewriting them is risky, slow and expensive.",
    description: "An assistant that explains legacy code, maps its dependencies, writes characterization tests and plans an incremental migration, running inside the company network.",
    targetAudience: "Enterprise engineering teams maintaining COBOL, VB6 or old Java systems",
    tags: ["deployment_self_hosted"],
    notes: ["Must run inside the customer's network"],
    required: [
      { title: "Explains legacy code in plain English" },
      { title: "Migrates COBOL or VB6 to modern languages" },
      { title: "Generates tests before refactoring" },
      { title: "Runs inside our own network" },
      { title: "Maps dependencies across the codebase" },
    ],
    niceToHave: [{ title: "Incremental migration plans" }, { title: "Effort estimates per module" }],
    startDaysAgo: 42,
    growth: "steady",
    requests: [
      { text: "I want an AI tool that explains our legacy COBOL code in plain English and plans a migration.", targetDollars: 200 },
      { text: "I need help migrating a VB6 application to C# with tests generated before refactoring.", targetDollars: 150 },
      { text: "I wish there were a self-hosted assistant that maps dependencies across our old codebase.", targetDollars: 250 },
      { text: "Looking for legacy modernization that runs inside our own network because the code is confidential.", targetDollars: 300 },
      { text: "I want incremental migration plans with effort estimates for a twenty-year-old Java monolith.", targetDollars: 100 },
      { text: "I need an on-premise code modernization assistant for a bank's mainframe systems.", targetDollars: 500 },
    ],
    proposals: [
      {
        builder: 1,
        title: "Strata: legacy code atlas",
        description: "A self-hosted service that builds a dependency atlas of COBOL and VB6 systems and writes characterization tests.",
        approach: "Static analysis into a graph database, then targeted test generation for the modules picked for migration.",
        scope: "COBOL and VB6 parsing, dependency graph UI, characterization tests. Migration itself is out of scope.",
        timeline: "16 weeks",
        priceDollars: 400,
        techStack: ["Java", "ANTLR", "Neo4j"],
        status: "submitted",
      },
    ],
    blueprint: {
      architectureSummary: "A self-hosted analysis server parses the legacy codebase into a dependency graph and drives a local model to explain modules and draft tests.",
      components: ["Language parsers", "Dependency graph", "Explanation generator", "Test generator", "Migration planner"],
      stack: ["Java", "ANTLR", "PostgreSQL", "Self-hosted LLM"],
      businessModel: "Annual on-premise licence per codebase.",
      risks: [{ risk: "Generated migrations change behaviour", mitigation: "Require characterization tests to pass before and after every migrated module" }],
    },
  },
];

/** Sanity limits from design 13 step 3, asserted by seed-fixtures.test.ts. */
export const SEED_LIMITS = { required: [4, 7], niceToHave: [2, 4], requests: [5, 9] } as const;
