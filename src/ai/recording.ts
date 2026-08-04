import { createApplier, type ApplyOptions, type GenerateResult } from "./generate";

export interface RecordedCall {
  tool: string;
  input: unknown;
}

export interface Recording {
  id: string;
  prompt: string;
  model: string;
  calls: RecordedCall[];
}

/**
 * A recorded generation, so the ribbon and the apply loop can be exercised with no API key
 * and no network — in the dev harness, in tests, and on a plane.
 *
 * It deliberately contains three calls that must be rejected: a wireframe whose `span` is
 * out of range, an edge to an object that was never created, and a type this build does not
 * know. A recording where everything succeeds would not exercise the half of the loop that
 * decides what to throw away.
 */
export const ONBOARDING_RECORDING: Recording = {
  id: "fintech-onboarding",
  prompt: "Design an onboarding flow for a fintech app.",
  model: "claude-sonnet-5",
  calls: [
    { tool: "RenameScape", input: { name: "Fintech onboarding" } },
    {
      tool: "CreateObject",
      input: {
        id: "goal",
        objectType: "note",
        title: "What onboarding has to achieve",
        data: {
          body:
            "Get a verified customer to their first deposit in under ten minutes, on a " +
            "mid-range phone, without contacting support.",
        },
      },
    },
    {
      tool: "CreateObject",
      input: {
        id: "kyc-constraint",
        objectType: "note",
        title: "Identity checks are non-negotiable",
        data: {
          body:
            "Regulation requires identity verification before the first deposit, so the " +
            "flow cannot defer it. The work is making it feel fast, not skipping it.",
        },
      },
    },
    {
      tool: "CreateObject",
      input: {
        id: "signup-journey",
        objectType: "journey",
        title: "First run",
        data: {
          steps: [
            { id: "s1", label: "Open the app", detail: "No account needed to look around." },
            { id: "s2", label: "Enter phone number", detail: "One-tap SMS code." },
            { id: "s3", label: "Scan ID", detail: "Document capture plus a liveness check." },
            { id: "s4", label: "Link a funding source" },
            { id: "s5", label: "Make the first deposit" },
          ],
        },
      },
    },
    {
      tool: "CreateObject",
      input: {
        id: "recovery-journey",
        objectType: "journey",
        title: "When verification fails",
        data: {
          steps: [
            { id: "r1", label: "Scan rejected", detail: "Glare, crop, or an expired document." },
            { id: "r2", label: "Say exactly what failed" },
            { id: "r3", label: "Retry with an on-screen guide" },
            { id: "r4", label: "Hand off to manual review", detail: "Answer within four hours." },
          ],
        },
      },
    },
    {
      tool: "CreateObject",
      input: {
        id: "welcome-screen",
        objectType: "wireframe",
        title: "Welcome",
        data: {
          primitives: [
            { id: "w1", kind: "box", label: "Logo", span: 4 },
            { id: "w2", kind: "text", label: "Money that moves when you do", span: 12 },
            { id: "w3", kind: "button", label: "Open an account", span: 12 },
            { id: "w4", kind: "button", label: "Sign in", span: 12 },
          ],
        },
      },
    },
    {
      tool: "CreateObject",
      input: {
        id: "id-capture-screen",
        objectType: "wireframe",
        title: "Scan your ID",
        data: {
          primitives: [
            { id: "i1", kind: "text", label: "Photograph the front of your ID", span: 12 },
            { id: "i2", kind: "box", label: "Camera viewport", span: 12 },
            { id: "i3", kind: "list", label: "Flat surface, good light, no glare", span: 12 },
            { id: "i4", kind: "button", label: "Capture", span: 12 },
          ],
        },
      },
    },
    {
      // Rejected: span must be 1..12. The model gets a specific reason back.
      tool: "CreateObject",
      input: {
        id: "deposit-screen",
        objectType: "wireframe",
        title: "Add money",
        data: {
          primitives: [
            { id: "d1", kind: "text", label: "How much?", span: 24 },
            { id: "d2", kind: "input", label: "Amount", span: 8 },
          ],
        },
      },
    },
    {
      // Rejected: this build has no persona plugin.
      tool: "CreateObject",
      input: {
        id: "primary-persona",
        objectType: "persona",
        title: "Gig worker, 29",
        data: { summary: "Paid irregularly, checks balance daily." },
      },
    },
    {
      tool: "CreateObject",
      input: {
        id: "drop-off",
        objectType: "note",
        title: "Where people actually leave",
        data: {
          body:
            "Most abandonment happens at the document scan, and half of those users never " +
            "come back. The funding step is a distant second.",
        },
      },
    },
    {
      tool: "ConnectObjects",
      input: { id: "e1", from: "goal", to: "signup-journey", label: "drives" },
    },
    {
      tool: "ConnectObjects",
      input: { id: "e2", from: "kyc-constraint", to: "signup-journey", label: "constrains" },
    },
    { tool: "ConnectObjects", input: { id: "e3", from: "signup-journey", to: "welcome-screen" } },
    {
      tool: "ConnectObjects",
      input: { id: "e4", from: "signup-journey", to: "id-capture-screen" },
    },
    {
      tool: "ConnectObjects",
      input: { id: "e5", from: "signup-journey", to: "recovery-journey", label: "on failure" },
    },
    {
      tool: "ConnectObjects",
      input: { id: "e6", from: "recovery-journey", to: "id-capture-screen" },
    },
    {
      tool: "ConnectObjects",
      input: { id: "e7", from: "drop-off", to: "id-capture-screen", label: "evidence" },
    },
    {
      // Rejected: deposit-screen was never created, because its own call was rejected.
      tool: "ConnectObjects",
      input: { id: "e8", from: "signup-journey", to: "deposit-screen" },
    },
  ],
};

export interface ReplayOptions extends ApplyOptions {
  /** Pause between calls, so the ribbon fills the way a real generation does. */
  delayMs?: number;
  signal?: AbortSignal;
}

/**
 * Replays a recording through the *same* applier a live generation uses, so the fixture
 * exercises the real validation, dispatch and layout cadence rather than a copy of them.
 */
export async function replayRecording(
  recording: Recording,
  options: ReplayOptions,
): Promise<GenerateResult> {
  const applier = createApplier(options);
  const delay = options.delayMs ?? 90;

  for (const call of recording.calls) {
    if (options.signal?.aborted) break;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (options.signal?.aborted) break;
    applier.apply(call.tool, call.input);
  }

  applier.finish();

  const cancelled = options.signal?.aborted === true;
  const done = {
    kind: "done" as const,
    txId: applier.txId,
    applied: applier.applied(),
    skipped: applier.skipped(),
    model: `${recording.model} (recorded)`,
    cancelled,
  };
  options.onEvent(done);
  return { txId: done.txId, applied: done.applied, skipped: done.skipped, cancelled };
}
