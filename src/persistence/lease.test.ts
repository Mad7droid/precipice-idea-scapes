import { describe, expect, it, vi } from "vitest";
import {
  acquireScapeLease,
  memoryBusFactory,
  type LeaseChange,
  type LeaseStatus,
  type ScapeLease,
} from "./lease";

/**
 * Windows are milliseconds rather than the production 120/400 so the suite does not spend a
 * second waiting on handshakes. The protocol is the same; only the patience changes.
 */
const CLAIM = 5;
const TAKEOVER = 5;

const wait = (ms = CLAIM * 3) => new Promise((resolve) => setTimeout(resolve, ms));

function harness() {
  const makeBus = memoryBusFactory();
  const leases: ScapeLease[] = [];

  const open = (holderId: string, scapeId = "scp_1") => {
    const changes: Array<[LeaseStatus, LeaseChange]> = [];
    const onYield = vi.fn();
    const lease = acquireScapeLease({
      scapeId,
      holderId,
      bus: makeBus(),
      claimWindowMs: CLAIM,
      takeoverWindowMs: TAKEOVER,
      onChange: (status, change) => changes.push([status, change]),
      onYield,
    });
    leases.push(lease);
    return { lease, changes, onYield };
  };

  return { open, stopAll: () => leases.forEach((lease) => lease.stop()) };
}

describe("scape lease", () => {
  it("holds the lease when no other tab answers", async () => {
    const { open, stopAll } = harness();
    const { lease, changes } = open("tab-a");

    await expect(lease.settled).resolves.toBe("holder");
    expect(changes).toEqual([["holder", "initial"]]);
    stopAll();
  });

  it("follows when another tab already holds the same scape", async () => {
    const { open, stopAll } = harness();
    const first = open("tab-a");
    await first.lease.settled;

    const second = open("tab-b");
    await expect(second.lease.settled).resolves.toBe("follower");
    expect(first.lease.status()).toBe("holder");
    stopAll();
  });

  it("does not contend across different scapes", async () => {
    const { open, stopAll } = harness();
    const first = open("tab-a", "scp_1");
    await first.lease.settled;

    const second = open("tab-b", "scp_2");
    await expect(second.lease.settled).resolves.toBe("holder");
    stopAll();
  });

  it("hands over on takeover, flushing the outgoing holder first", async () => {
    const { open, stopAll } = harness();
    const first = open("tab-a");
    await first.lease.settled;
    const second = open("tab-b");
    await second.lease.settled;

    await second.lease.takeOver();

    expect(first.onYield).toHaveBeenCalledTimes(1);
    expect(first.lease.status()).toBe("follower");
    expect(second.lease.status()).toBe("holder");
    // The Editor reloads on "promoted" and on nothing else, so the reason matters.
    expect(second.changes.at(-1)).toEqual(["holder", "promoted"]);
    stopAll();
  });

  it("yields before it flushes, never after", async () => {
    const { open, stopAll } = harness();
    const first = open("tab-a");
    await first.lease.settled;
    const second = open("tab-b");
    await second.lease.settled;

    let statusAtYield: LeaseStatus | null = null;
    first.onYield.mockImplementation(() => {
      statusAtYield = first.lease.status();
    });

    await second.lease.takeOver();

    // Still holder while flushing: a flush that ran after the downgrade would be dropped by
    // autosave's own canWrite guard, and the outgoing tab's last edit would be lost.
    expect(statusAtYield).toBe("holder");
    stopAll();
  });

  it("promotes a waiting follower when the holder's tab closes", async () => {
    const { open, stopAll } = harness();
    const first = open("tab-a");
    await first.lease.settled;
    const second = open("tab-b");
    await second.lease.settled;
    expect(second.lease.status()).toBe("follower");

    first.lease.stop();
    await wait();

    expect(second.lease.status()).toBe("holder");
    expect(second.changes.at(-1)).toEqual(["holder", "promoted"]);
    stopAll();
  });

  it("gives the lease to exactly one tab when two claim at the same instant", async () => {
    const { open, stopAll } = harness();
    const a = open("tab-a");
    const b = open("tab-b");

    await Promise.all([a.lease.settled, b.lease.settled]);

    const holders = [a, b].filter(({ lease }) => lease.status() === "holder");
    expect(holders).toHaveLength(1);
    stopAll();
  });

  // The tie-break is a string comparison, so it resolves differently depending on which id
  // opened first. Both orderings have to end with one holder, not just the lucky one.
  it.each([
    ["tab-a", "tab-b"],
    ["tab-b", "tab-a"],
  ])("settles on one holder when %s claims just before %s", async (firstId, secondId) => {
    const { open, stopAll } = harness();
    const first = open(firstId);
    const second = open(secondId);

    await Promise.all([first.lease.settled, second.lease.settled]);
    await wait();

    const holders = [first, second].filter(({ lease }) => lease.status() === "holder");
    expect(holders).toHaveLength(1);
    stopAll();
  });

  it("takes the lease anyway when the holder never answers", async () => {
    const { open, stopAll } = harness();
    const first = open("tab-a");
    await first.lease.settled;
    const second = open("tab-b");
    await second.lease.settled;

    // A tab the OS suspended or a renderer that crashed: still on the bus, never replies.
    first.lease.stop();
    const { lease } = open("tab-c");
    await lease.settled;

    await expect(second.lease.takeOver()).resolves.toBeUndefined();
    expect(second.lease.status()).toBe("holder");
    stopAll();
  });

  it("writes when the browser has no BroadcastChannel rather than failing closed", async () => {
    const changes: Array<[LeaseStatus, LeaseChange]> = [];
    const lease = acquireScapeLease({
      scapeId: "scp_1",
      holderId: "tab-a",
      bus: null,
      onChange: (status, change) => changes.push([status, change]),
    });

    await expect(lease.settled).resolves.toBe("holder");
    expect(changes).toEqual([["holder", "initial"]]);
    lease.stop();
  });
});
