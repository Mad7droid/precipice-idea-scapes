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

export type LiveStage = "routing" | "queued" | "running" | "done" | "skipped";

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
}

export interface UseLiveVoiceOptions {
  baseline: () => RouteBaseline;
  context: () => RouteContext;
  jevKey: string;
  /** True while any ask or edit is running, whichever mode started it. */
  busy: boolean;
  onSend: (text: string, route: SendRoute) => void;
  onCommand?: (command: LocalCommand) => void;
}

/** A run that has not visibly started by now was refused (no AI connection, read-only tab). */
// One shared import: phrases arrive in bursts, and each must not start its own module load.
let jevModule: Promise<typeof import("@/ai/router/jev")> | null = null;
const loadJev = () => (jevModule ??= import("@/ai/router/jev"));

const START_GRACE_MS = 1500;
const KEEP = 6;

export function useLiveVoice({
  baseline,
  context,
  jevKey,
  busy,
  onSend,
  onCommand,
}: UseLiveVoiceOptions) {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const decisions = useRef(new Map<number, { route: SendRoute; command?: LocalCommand } | null>());
  const running = useRef<{ id: number; startedAt: number; seenBusy: boolean } | null>(null);
  const sequence = useRef(0);
  const latest = useRef({ baseline, context, jevKey, onSend, onCommand });
  latest.current = { baseline, context, jevKey, onSend, onCommand };

  const update = useCallback((id: number, patch: Partial<LiveEntry>) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const push = useCallback(
    (text: string) => {
      const id = ++sequence.current;
      const heardAt = performance.now();
      setEntries((prev) => [...prev.slice(-(KEEP - 1)), { id, text, stage: "routing", heardAt }]);
      const { baseline: base, context: ctx, jevKey: key } = latest.current;
      const routeContext = { ...ctx(), input: "voice" as const };
      const local = heuristicRoute(text, routeContext);
      const finish = (jev: Awaited<ReturnType<typeof import("@/ai/router/jev").askJev>>) => {
        const suggestion = merge(local, jev);
        const decision = decide(base(), suggestion, new Set());
        const command = latest.current.onCommand ? decision.command : undefined;
        decisions.current.set(id, { route: decision.route, ...(command ? { command } : {}) });
        update(id, {
          stage: "queued",
          action: command ? command.kind : labelFor(decision.route.intent),
          decider: jev ? "jev" : key.trim() ? "fallback" : "local",
          routeMs: Math.round(performance.now() - heardAt),
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
        update(current.id, { stage: "done", runMs: Math.round(elapsed) });
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
  }, [busy, entries, update]);

  const clear = useCallback(() => {
    decisions.current.clear();
    running.current = null;
    setEntries([]);
  }, []);

  return { entries, push, clear };
}

function labelFor(intent: SendRoute["intent"]) {
  return intent === "ask" ? "Ask" : intent === "connect" ? "Connect" : "Edit";
}
