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
