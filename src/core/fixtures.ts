import type { Relationship, Scape, ScapeMeta, ScapeObject } from "./types";

/**
 * A hand-built sample Scape. Every workstream develops against this, which is why none of
 * them are blocked on the other three.
 *
 * Positions are pre-laid-out left-to-right so the fixture renders sensibly before Dagre runs.
 */

const T0 = 1735689600000; // 2025-01-01T00:00:00Z — fixed so snapshots are stable

function obj(
  id: string,
  type: string,
  title: string,
  data: Record<string, unknown>,
  x: number,
  y: number,
): ScapeObject {
  return { id, type, title, data, x, y, createdAt: T0, updatedAt: T0 };
}

function rel(id: string, from: string, to: string, label?: string): Relationship {
  return label === undefined ? { id, from, to } : { id, from, to, label };
}

const OBJECTS: ScapeObject[] = [
  obj(
    "brief",
    "note",
    "Onboarding brief",
    {
      body:
        "New customers abandon at identity verification. Target: first deposit within eight " +
        "minutes of install, on a mid-range Android phone, without a support contact.",
    },
    0,
    0,
  ),
  obj(
    "constraints",
    "note",
    "Regulatory constraints",
    {
      body:
        "KYC is mandatory before any deposit. Documents are held for seven years. We cannot " +
        "defer verification to after the first transaction, however much we would like to.",
    },
    0,
    180,
  ),
  obj(
    "happy-path",
    "journey",
    "Account opening",
    {
      steps: [
        { id: "s1", label: "Install and open", detail: "No account required to browse." },
        { id: "s2", label: "Enter phone number", detail: "One-tap SMS autofill." },
        { id: "s3", label: "Verify identity", detail: "Document scan plus liveness check." },
        { id: "s4", label: "Link a funding source", detail: "Bank or debit card." },
        { id: "s5", label: "Make first deposit" },
      ],
    },
    340,
    0,
  ),
  obj(
    "recovery",
    "journey",
    "Verification retry",
    {
      steps: [
        { id: "r1", label: "Scan rejected", detail: "Glare, crop, or expiry." },
        { id: "r2", label: "Show what failed", detail: "Name the specific problem." },
        { id: "r3", label: "Retry with guidance" },
        { id: "r4", label: "Escalate to manual review", detail: "Under four hours." },
      ],
    },
    340,
    260,
  ),
  obj(
    "returning",
    "journey",
    "Returning user",
    {
      steps: [
        { id: "g1", label: "Recognise device" },
        { id: "g2", label: "Biometric unlock" },
        { id: "g3", label: "Resume where they stopped" },
      ],
    },
    340,
    520,
  ),
  obj(
    "wf-welcome",
    "wireframe",
    "Welcome screen",
    {
      primitives: [
        { id: "p1", kind: "box", label: "Brand mark", span: 12 },
        { id: "p2", kind: "text", label: "Move money without the wait", span: 12 },
        { id: "p3", kind: "text", label: "Supporting line", span: 10 },
        { id: "p4", kind: "button", label: "Get started", span: 12 },
        { id: "p5", kind: "button", label: "I already have an account", span: 12 },
      ],
    },
    700,
    0,
  ),
  obj(
    "wf-phone",
    "wireframe",
    "Phone entry",
    {
      primitives: [
        { id: "q1", kind: "text", label: "What's your number?", span: 12 },
        { id: "q2", kind: "input", label: "+1", span: 3 },
        { id: "q3", kind: "input", label: "Phone number", span: 9 },
        { id: "q4", kind: "text", label: "We'll text a six-digit code", span: 12 },
        { id: "q5", kind: "button", label: "Send code", span: 12 },
      ],
    },
    700,
    260,
  ),
  obj(
    "wf-verify",
    "wireframe",
    "Identity capture",
    {
      primitives: [
        { id: "v1", kind: "text", label: "Photograph your ID", span: 12 },
        { id: "v2", kind: "box", label: "Camera viewport", span: 12 },
        { id: "v3", kind: "list", label: "Flat surface / good light / no glare", span: 12 },
        { id: "v4", kind: "button", label: "Capture", span: 12 },
      ],
    },
    700,
    520,
  ),
  obj(
    "wf-fund",
    "wireframe",
    "Funding source",
    {
      primitives: [
        { id: "f1", kind: "text", label: "How would you like to add money?", span: 12 },
        { id: "f2", kind: "list", label: "Bank / Debit card / Wire", span: 12 },
        { id: "f3", kind: "input", label: "Amount", span: 6 },
        { id: "f4", kind: "button", label: "Continue", span: 6 },
      ],
    },
    700,
    780,
  ),
  obj(
    "drop-off",
    "note",
    "Where people leave",
    {
      body:
        "Sixty-one percent of abandonment happens on the document scan. Half of those never " +
        "retry. The second-largest drop is the funding step, at fourteen percent.",
    },
    1060,
    0,
  ),
  obj(
    "open-question",
    "note",
    "Open question",
    {
      body:
        "Can the funding step be deferred until after the first deposit intent, so the user " +
        "has already committed before we ask for bank credentials?",
    },
    1060,
    180,
  ),
  obj(
    "copy-rules",
    "note",
    "Copy rules",
    {
      body:
        "Sentence case. No exclamation marks. Errors say what failed and what to do next. " +
        "Never apologise for a rejected document scan — explain the problem instead.",
    },
    1060,
    360,
  ),
  obj(
    "verification-spec",
    "scape",
    "Verification spec",
    {
      body:
        "## Document scan\n\n" +
        "The scan runs on-device and uploads a single frame. A retry never re-asks for the " +
        "document type — that answer is kept from the first attempt.\n\n" +
        "| Check | Blocking | Retry |\n" +
        "| --- | --- | --- |\n" +
        "| Glare | Yes | Immediate |\n" +
        "| Liveness | Yes | Once |\n" +
        "| Address match | No | Manual review |\n\n" +
        "### Failure copy\n\n" +
        "- Name the problem, not the person\n" +
        "- Say what to change before retrying\n" +
        "- Offer manual review after the second failure",
    },
    1060,
    540,
  ),
];

const RELATIONSHIPS: Relationship[] = [
  rel("r-brief-happy", "brief", "happy-path", "drives"),
  rel("r-constraints-happy", "constraints", "happy-path", "constrains"),
  rel("r-happy-welcome", "happy-path", "wf-welcome"),
  rel("r-happy-phone", "happy-path", "wf-phone"),
  rel("r-happy-verify", "happy-path", "wf-verify"),
  rel("r-happy-fund", "happy-path", "wf-fund"),
  rel("r-happy-recovery", "happy-path", "recovery", "on failure"),
  rel("r-recovery-verify", "recovery", "wf-verify"),
  rel("r-returning-welcome", "returning", "wf-welcome"),
  rel("r-dropoff-verify", "drop-off", "wf-verify", "evidence"),
  rel("r-question-fund", "open-question", "wf-fund"),
  rel("r-copy-verify", "copy-rules", "wf-verify"),
  rel("r-spec-verify", "verification-spec", "wf-verify", "specifies"),
];

function assemble(
  id: string,
  name: string,
  objects: ScapeObject[],
  relationships: Relationship[],
): Scape {
  return {
    id,
    name,
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    objectOrder: objects.map((o) => o.id),
    relationships: Object.fromEntries(relationships.map((r) => [r.id, r])),
    viewState: { x: 0, y: 0, zoom: 1 },
    createdAt: T0,
    updatedAt: T0,
  };
}

/** The 13-object sample. Returns a fresh deep copy every call — tests mutate it freely. */
export function fixtureScape(): Scape {
  return structuredClone(assemble("scp_fixture", "Fintech onboarding", OBJECTS, RELATIONSHIPS));
}

/**
 * A large synthetic Scape. Workstream C's context projection must be written against this,
 * not against the 13-object fixture — the fixture fits in a prompt whole and so hides every
 * truncation bug the projection exists to solve.
 */
export function syntheticScape(count = 200): Scape {
  const types = ["note", "journey", "wireframe", "scape"];
  const objects: ScapeObject[] = [];
  const relationships: Relationship[] = [];

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const id = `syn-${String(i).padStart(3, "0")}`;
    const data: Record<string, unknown> =
      type === "note" || type === "scape"
        ? { body: `Synthetic body ${i}. ${"Filler sentence about the domain. ".repeat(6)}` }
        : type === "journey"
          ? {
              steps: Array.from({ length: 5 }, (_, s) => ({
                id: `${id}-s${s}`,
                label: `Step ${s + 1} of flow ${i}`,
                detail: `Detail for step ${s + 1}, describing what the user does here.`,
              })),
            }
          : {
              primitives: Array.from({ length: 6 }, (_, p) => ({
                id: `${id}-p${p}`,
                kind: (["box", "text", "input", "button", "list"] as const)[p % 5],
                label: `Element ${p + 1}`,
                span: (p % 3) + 4,
              })),
            };

    objects.push(
      obj(id, type, `Synthetic object ${i}`, data, (i % 20) * 320, Math.floor(i / 20) * 240),
    );

    if (i > 0) {
      relationships.push(rel(`syn-r-${i}`, `syn-${String(i - 1).padStart(3, "0")}`, id));
    }
    // A few long-range edges so the adjacency list is not a straight chain.
    if (i > 10 && i % 7 === 0) {
      relationships.push(
        rel(`syn-x-${i}`, `syn-${String(i - 10).padStart(3, "0")}`, id, "relates to"),
      );
    }
  }

  return assemble("scp_synthetic", `Synthetic scape (${count})`, objects, relationships);
}

/** An empty Scape, for "new scape" and for tests that want to build state up by dispatch. */
export function emptyScape(id: string, name = "Untitled scape", meta?: ScapeMeta): Scape {
  const scape = assemble(id, name, [], []);
  return meta ? { ...scape, meta } : scape;
}
