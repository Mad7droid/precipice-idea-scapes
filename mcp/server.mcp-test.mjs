import assert from "node:assert/strict";
import test from "node:test";
import { createBridge } from "./server.mjs";

const scape = {
  id: "scape_1",
  name: "Onboarding",
  objects: {
    welcome: { id: "welcome", type: "note", title: "Welcome", data: { body: "Hello" } },
  },
  objectOrder: ["welcome"],
  relationships: {},
};

async function withBridge(run) {
  const bridge = createBridge({ port: 0 });
  const port = await bridge.listen();
  try {
    await run(`http://127.0.0.1:${port}`, bridge);
  } finally {
    await bridge.close();
  }
}

test("a paired browser tab receives and acknowledges an MCP action batch", async () => {
  await withBridge(async (origin, bridge) => {
    const code = "ABCD2345";
    const created = await fetch(`${origin}/bridge/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Precipice-Bridge-Code": code },
      body: JSON.stringify({ scape }),
    });
    assert.equal(created.status, 201);
    const { sessionId } = await created.json();

    const pending = bridge.enqueue(sessionId, [
      { type: "CreateObject", id: "sign-up", objectType: "journey", title: "Sign up", data: { steps: [] } },
    ]);
    const commands = await fetch(`${origin}/bridge/sessions/${sessionId}/commands`, {
      headers: { "X-Precipice-Bridge-Code": code },
    });
    const { commands: queued } = await commands.json();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].actions[0].id, "sign-up");

    const acknowledged = await fetch(`${origin}/bridge/sessions/${sessionId}/commands/${queued[0].id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Precipice-Bridge-Code": code },
      body: JSON.stringify({ status: "applied", applied: 1, skipped: 0, scape }),
    });
    assert.equal(acknowledged.status, 204);
    assert.deepEqual(await pending, { status: "applied", applied: 1, skipped: 0, scape });
  });
});

test("a bridge session rejects a request without its pairing code", async () => {
  await withBridge(async (origin) => {
    const response = await fetch(`${origin}/bridge/sessions/scape_missing/commands`);
    assert.equal(response.status, 401);
  });
});

// Claude Desktop starts this command more than once. The instance that loses the race for the
// port used to exit, taking the host's tool list with it.
test("a second instance survives a port already in use", async () => {
  const first = createBridge({ port: 0 });
  const port = await first.listen();
  const second = createBridge({ port });
  try {
    const bound = await second.listen({ attempts: 2, delayMs: 10 });
    assert.equal(bound, null, "the second instance must not claim the port");
    assert.equal(second.isBound(), false);
    assert.equal(first.isBound(), true, "the incumbent keeps serving");
  } finally {
    await first.close();
  }
});

test("an incumbent stands down when a newer instance asks for the port", async () => {
  let relinquished = false;
  const first = createBridge({ port: 0, onRelinquish: () => (relinquished = true) });
  const port = await first.listen();
  const base = `http://127.0.0.1:${port}`;

  // A browser page cannot trigger this: every fetch to this port carries an Origin header.
  const fromPage = await fetch(`${base}/bridge/instance`, {
    method: "DELETE",
    headers: { Origin: "http://localhost:5173", "X-Precipice-Bridge-Takeover": "1" },
  });
  assert.equal(fromPage.status, 403);
  assert.equal(relinquished, false);

  const takeover = await fetch(`${base}/bridge/instance`, {
    method: "DELETE",
    headers: { "X-Precipice-Bridge-Takeover": "1" },
  });
  assert.equal(takeover.status, 204);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(relinquished, true);
  await first.close();
});
