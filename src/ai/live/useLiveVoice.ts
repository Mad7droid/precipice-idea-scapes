import { useCallback, useEffect, useRef, useState } from "react";
import { decide, merge, type RouteBaseline } from "@/ai/router/decide";
import { heuristicRoute } from "@/ai/router/heuristics";
import type { LocalCommand, RouteContext, SendRoute } from "@/ai/router/types";

/**
 * Live voice: each spoken phrase is routed and run as soon as it is heard — no draft, no Send.
 *
 * Routing starts the moment a phrase lands, even while an earlier phrase is still running, so
 * the decision is ready when its turn comes. Runs are strictly in spoken order, one at a time:
 * two edits never race on the same scape. Every edit is still its own undoable transaction and
 * an ask still cannot write; live mode removes the click, not the guarantees.
 */

export type LiveStage = "routing" | "queued" | "running" | "done" | "failed" | "skipped";

export interface LiveEntry {
  id: number;
  text: string;
  stage: LiveStage;
  /** What it became: Ask, Edit, Connect or a local command. */
  action?: string;
  /** Who decided: Jev, or this device (including when Jev did not answer). */
  decider?: "jev" | "local" | "fallback";
  routeMs?: number;
  modelId?: string;
  /** Spoken → started running, and started → finished. */
  waitMs?: number;
  runMs?: number;
  heardAt: number;
  /** When the latest words of this entry were heard; a run waits briefly after it. */
  lastHeardAt: number;
}

export interface UseLiveVoiceOptions {
  baseline: () => RouteBaseline;
  context: () => RouteContext;
  jevKey: string;
  /** True while any ask or edit is running, whichever mode started it. */
  busy: boolean;
  /** True when the most recent ask or edit ended in an error, so a run is not shown as done. */
  failed?: boolean;
  onSend: (text: string, route: SendRoute) => void;
  onCommand?: (command: LocalCommand) => void;
}

/** A run that has not visibly started by now was refused (no AI connection, read-only tab). */
// One shared import: phrases arrive in bursts, and each must not start its own module load.
let jevModule: Promise<typeof import("@/ai/router/jev")> | null = null;
const loadJev = () => (jevModule ??= import("@/ai/router/jev"));

const START_GRACE_MS = 1500;
const KEEP = 6;
/**
 * A pause in speech is not always the end of a thought: the Mac recogniser closes a phrase
 * after ~0.7 s of quiet. A phrase waits this long before running, and words heard in that
 * window join it, so one spoken sentence is one request.
 */
export const SETTLE_MS = 600;

export function useLiveVoice({
  baseline,
  context,
  jevKey,
  busy,
  failed = false,
  onSend,
  onCommand,
}: UseLiveVoiceOptions) {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const versions = useRef(new Map<number, number>());
  const [tick, setTick] = useState(0);
  const decisions = useRef(new Map<number, { route: SendRoute; command?: LocalCommand } | null>());
  const running = useRef<{ id: number; startedAt: number; seenBusy: boolean } | null>(null);
  const sequence = useRef(0);
  const latest = useRef({ baseline, context, jevKey, onSend, onCommand });
  latest.current = { baseline, context, jevKey, onSend, onCommand };

  const update = useCallback((id: number, patch: Partial<LiveEntry>) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const route = useCallback(
    (id: number, text: string) => {
      const version = (versions.current.get(id) ?? 0) + 1;
      versions.current.set(id, version);
      decisions.current.delete(id);
      const { baseline: base, context: ctx, jevKey: key } = latest.current;
      const routeContext = { ...ctx(), input: "voice" as const };
      const local = heuristicRoute(text, routeContext);
      const started = performance.now();
      const finish = (jev: Awaited<ReturnType<typeof import("@/ai/router/jev").askJev>>) => {
        // Words joined this entry while it was routing; the newer routing wins.
        if (versions.current.get(id) !== version) return;
        const suggestion = merge(local, jev);
        const decision = decide(base(), suggestion, new Set());
        const command = latest.current.onCommand ? decision.command : undefined;
        decisions.current.set(id, { route: decision.route, ...(command ? { command } : {}) });
        update(id, {
          stage: "queued",
          action: command ? command.kind : labelFor(decision.route.intent),
          decider: jev ? "jev" : key.trim() ? "fallback" : "local",
          routeMs: Math.round(performance.now() - started),
          ...(command ? {} : { modelId: decision.route.modelId }),
        });
      };
      if (!key.trim()) {
        finish(null);
        return;
      }
      void loadJev()
        .then(({ askJev }) => askJev(text, routeContext, key))
        .catch(() => null)
        .then(finish);
    },
    [update],
  );

  const push = useCallback(
    (text: string) => {
      const now = performance.now();
      const last = entriesRef.current.at(-1);
      if (
        last &&
        (last.stage === "routing" || last.stage === "queued") &&
        now - last.lastHeardAt < SETTLE_MS + 1500
      ) {
        const joined = `${last.text} ${text}`;
        const merged = { ...last, text: joined, stage: "routing" as const, lastHeardAt: now };
        entriesRef.current = entriesRef.current.map((entry) =>
          entry.id === last.id ? merged : entry,
        );
        setEntries(entriesRef.current);
        route(last.id, joined);
        return;
      }
      const id = ++sequence.current;
      const entry: LiveEntry = { id, text, stage: "routing", heardAt: now, lastHeardAt: now };
      entriesRef.current = [...entriesRef.current.slice(-(KEEP - 1)), entry];
      setEntries(entriesRef.current);
      route(id, text);
    },
    [route],
  );

  // The runner: one phrase at a time, in spoken order, each when the scape is free.
  useEffect(() => {
    const current = running.current;
    if (current) {
      if (busy) {
        current.seenBusy = true;
        return;
      }
      const elapsed = performance.now() - current.startedAt;
      if (current.seenBusy) {
        update(current.id, { stage: failed ? "failed" : "done", runMs: Math.round(elapsed) });
        running.current = null;
      } else {
        const timer = window.setTimeout(
          () => {
            if (running.current !== current) return;
            running.current = null;
            update(current.id, { stage: "skipped" });
          },
          Math.max(0, START_GRACE_MS - elapsed),
        );
        return () => window.clearTimeout(timer);
      }
    }
    if (busy || running.current) return;
    const next = entries.find((entry) => entry.stage === "queued");
    // A phrase still routing holds back the ones after it, so spoken order is kept.
    const blocked = entries.find((entry) => entry.stage === "routing");
    if (!next || (blocked && blocked.id < next.id)) return;
    const decision = decisions.current.get(next.id);
    // Commands run at once; requests wait out the settle window in case speech continues.
    const settleLeft = next.lastHeardAt + SETTLE_MS - performance.now();
    if (!decision?.command && settleLeft > 0) {
      const timer = window.setTimeout(() => setTick((n) => n + 1), settleLeft);
      return () => window.clearTimeout(timer);
    }
    decisions.current.delete(next.id);
    const startedAt = performance.now();
    const waitMs = Math.round(startedAt - next.heardAt);
    if (decision?.command) {
      latest.current.onCommand?.(decision.command);
      update(next.id, { stage: "done", waitMs, runMs: 0 });
      return;
    }
    if (!decision) {
      update(next.id, { stage: "skipped" });
      return;
    }
    running.current = { id: next.id, startedAt, seenBusy: false };
    update(next.id, { stage: "running", waitMs });
    latest.current.onSend(next.text, decision.route);
  }, [busy, entries, failed, update, tick]);

  const clear = useCallback(() => {
    decisions.current.clear();
    versions.current.clear();
    running.current = null;
    entriesRef.current = [];
    setEntries([]);
  }, []);

  return { entries, push, clear };
}

function labelFor(intent: SendRoute["intent"]) {
  return intent === "ask" ? "Ask" : intent === "connect" ? "Connect" : "Edit";
}
