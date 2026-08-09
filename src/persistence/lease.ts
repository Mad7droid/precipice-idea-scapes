import type { ScapeId } from "@/core/types";

/**
 * One writer per scape, across tabs.
 *
 * Autosave writes a full snapshot of whatever the tab holds in memory. Two tabs open on the
 * same scape therefore overwrite each other: the sequence guard in `startAutosave` and in
 * `DexieScapeRepository` is a per-tab counter, so it orders a tab's own writes and knows
 * nothing about anyone else's. Whichever tab typed last wins, and the other tab's work is
 * gone with no error and no way back.
 *
 * A lease fixes that by making the second tab read-only rather than by merging: merging two
 * divergent snapshots needs a CRDT, and the honest v1 answer is that only one tab edits.
 * Handing the lease over is one click, and the handover flushes the outgoing holder before
 * the incoming one reloads, so no edit is lost in either direction.
 */

export type LeaseStatus = "holder" | "follower";

/** Why the status changed. The Editor reloads the document on "promoted" and nothing else. */
export type LeaseChange = "initial" | "promoted" | "yielded";

export type LeaseMessage =
  /**
   * `reply` marks a claim sent to answer another claim rather than to open one. A tab that
   * opens second never hears the incumbent's opening claim — it was posted before the second
   * tab subscribed — so without the echo both tabs time out believing they are alone, and
   * both start writing. Replies are never echoed, which is what stops the echo from looping.
   */
  | { kind: "claim"; scapeId: ScapeId; from: string; reply?: boolean }
  | { kind: "held"; scapeId: ScapeId; from: string }
  | { kind: "release"; scapeId: ScapeId; from: string }
  | { kind: "takeover"; scapeId: ScapeId; from: string };

/**
 * The transport. Real tabs use `BroadcastChannel`; tests use an in-memory bus, because jsdom
 * does not implement it. A bus never delivers a message back to its sender, matching
 * `BroadcastChannel`.
 */
export interface LeaseBus {
  post(message: LeaseMessage): void;
  subscribe(handler: (message: LeaseMessage) => void): () => void;
  close(): void;
}

export interface ScapeLease {
  status(): LeaseStatus;
  /** Resolves when the opening claim settles — holder if nobody answered, follower if one did. */
  settled: Promise<LeaseStatus>;
  /** Demand the lease from whoever holds it. Resolves once this tab may write. */
  takeOver(): Promise<void>;
  stop(): void;
}

const CHANNEL = "precipice.lease";

/**
 * How long to wait for an existing holder to answer a claim. Long enough to cross a message
 * round trip in a busy tab, short enough that opening a scape in a fresh tab does not feel
 * gated on it — nothing is rendered behind this wait.
 */
const CLAIM_WINDOW_MS = 120;

/**
 * How long a takeover waits for the outgoing holder to flush and release. If it never
 * answers — a crashed or suspended tab — we take the lease anyway, because the alternative is
 * a scape that can never be edited again until the browser is restarted.
 */
const TAKEOVER_WINDOW_MS = 400;

function browserBus(): LeaseBus | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(CHANNEL);
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent) => handler(event.data as LeaseMessage);
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close: () => channel.close(),
  };
}

/** An in-memory bus shared by every lease built from the same object. For tests. */
export function memoryBusFactory(): () => LeaseBus {
  const handlers = new Set<(message: LeaseMessage) => void>();
  return () => {
    let own: ((message: LeaseMessage) => void) | null = null;
    return {
      post(message) {
        // Never delivered to the sender, matching BroadcastChannel.
        for (const handler of handlers) if (handler !== own) handler(message);
      },
      subscribe(handler) {
        own = handler;
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
          own = null;
        };
      },
      close() {
        if (own) handlers.delete(own);
        own = null;
      },
    };
  };
}

export interface LeaseOptions {
  scapeId: ScapeId;
  /** Unique per tab. Also the tie-break when two tabs claim the same scape at once. */
  holderId: string;
  onChange: (status: LeaseStatus, change: LeaseChange) => void;
  /** Runs before this tab gives up the lease. Flush here — the incoming holder reads next. */
  onYield?: () => void;
  bus?: LeaseBus | null;
  claimWindowMs?: number;
  takeoverWindowMs?: number;
}

export function acquireScapeLease(options: LeaseOptions): ScapeLease {
  const {
    scapeId,
    holderId,
    onChange,
    onYield,
    claimWindowMs = CLAIM_WINDOW_MS,
    takeoverWindowMs = TAKEOVER_WINDOW_MS,
  } = options;
  const bus = options.bus === undefined ? browserBus() : options.bus;

  // No transport means no other tab can be detected, so behave exactly as the app did before
  // leases existed: this tab writes. Failing closed here would make a browser without
  // BroadcastChannel a browser where nothing saves.
  if (!bus) {
    onChange("holder", "initial");
    return {
      status: () => "holder",
      settled: Promise.resolve("holder"),
      takeOver: () => Promise.resolve(),
      stop: () => {},
    };
  }

  let phase: "claiming" | "holder" | "follower" = "claiming";
  let stopped = false;
  let claimTimer: ReturnType<typeof setTimeout> | undefined;
  let takeoverTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveTakeover: (() => void) | null = null;
  let settle: (status: LeaseStatus) => void = () => {};
  const settled = new Promise<LeaseStatus>((resolve) => {
    settle = resolve;
  });

  // A promotion after the opening claim is a reload point for the Editor; the opening claim
  // is not, because the Editor is loading the document anyway.
  let settledOnce = false;

  const become = (next: "holder" | "follower", change: LeaseChange) => {
    if (stopped || phase === next) return;
    const wasClaiming = phase === "claiming";
    phase = next;
    onChange(next, change);
    if (wasClaiming && !settledOnce) {
      settledOnce = true;
      settle(next);
    }
  };

  const startClaim = () => {
    phase = "claiming";
    bus.post({ kind: "claim", scapeId, from: holderId });
    clearTimeout(claimTimer);
    claimTimer = setTimeout(() => {
      // Nobody answered, so nobody is holding it.
      if (phase === "claiming") become("holder", settledOnce ? "promoted" : "initial");
    }, claimWindowMs);
  };

  const finishTakeover = () => {
    clearTimeout(takeoverTimer);
    takeoverTimer = undefined;
    become("holder", "promoted");
    resolveTakeover?.();
    resolveTakeover = null;
  };

  const unsubscribe = bus.subscribe((message) => {
    if (stopped || message.scapeId !== scapeId || message.from === holderId) return;

    switch (message.kind) {
      case "claim":
        if (phase === "holder") {
          bus.post({ kind: "held", scapeId, from: holderId });
          return;
        }
        if (phase !== "claiming") return;
        if (!message.reply) bus.post({ kind: "claim", scapeId, from: holderId, reply: true });
        // Two tabs are claiming the same scape at once. Both apply this comparison and it is
        // total, so exactly one defers; without it both time out and both start writing.
        if (message.from < holderId) become("follower", "initial");
        return;

      case "held":
        if (phase === "claiming") become("follower", "initial");
        return;

      case "takeover":
        if (phase === "holder") {
          onYield?.();
          become("follower", "yielded");
          bus.post({ kind: "release", scapeId, from: holderId });
        }
        return;

      case "release":
        // The holder is gone. Followers race for it through the normal claim handshake,
        // which already has a tie-break, so two of them cannot both win.
        if (resolveTakeover) finishTakeover();
        else if (phase === "follower") startClaim();
        return;
    }
  });

  startClaim();

  return {
    status: () => (phase === "holder" ? "holder" : "follower"),
    settled,

    takeOver() {
      if (phase === "holder") return Promise.resolve();
      if (resolveTakeover) return Promise.resolve(); // one in flight is enough
      return new Promise<void>((resolve) => {
        resolveTakeover = resolve;
        bus.post({ kind: "takeover", scapeId, from: holderId });
        // The holder may be a tab that was closed mid-flight, or suspended by the OS. Take
        // the lease regardless once the window passes.
        takeoverTimer = setTimeout(finishTakeover, takeoverWindowMs);
      });
    },

    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(claimTimer);
      clearTimeout(takeoverTimer);
      // Announce on the way out so a waiting tab promotes immediately rather than sitting
      // read-only until someone clicks.
      if (phase === "holder") bus.post({ kind: "release", scapeId, from: holderId });
      unsubscribe();
      bus.close();
    },
  };
}
