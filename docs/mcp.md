# Local MCP bridge

The Precipice MCP bridge lets a local agent such as Codex or Claude Desktop read the scape open
in your browser and send validated object and relationship actions back to it. It is a local
integration: the bridge binds to `127.0.0.1`, holds nothing after it stops, and never receives an
AI-provider key.

## Set up Codex

From the repository root, register the local MCP server once:

```sh
codex mcp add precipice -- node "$PWD/mcp/server.mjs"
```

Restart Codex (or begin a new Codex session) after registering it. Confirm the setup with:

```sh
codex mcp get precipice
```

Then pair the open scape using the steps below. In Codex, the tools appear as `pair_with_precipice`,
`read_active_scape`, `search_active_scape`, `read_active_objects`, and `apply_to_active_scape`.

## Set up Claude Desktop

Run `corepack pnpm install` once in this repository. Then add the following entry to Claude
Desktop's MCP configuration, replacing the path with this checkout's absolute path:

```json
{
  "mcpServers": {
    "precipice": {
      "command": "node",
      "args": ["/absolute/path/to/precipice-idea-scapes/mcp/server.mjs"]
    }
  }
}
```

Restart Claude Desktop after saving the configuration. Claude starts the bridge itself; do not
run a second copy of `pnpm mcp` at the same time. `pnpm mcp` is useful only when developing or
testing the bridge outside Claude.

## Pair an open scape

1. Open the scape you want to work on in Precipice.
2. Open **Settings → Claude MCP** and select **Connect**.
3. In Codex or Claude, call `pair_with_precipice` with the eight-character code shown in Precipice.
4. The agent can now call `read_active_scape`, `search_active_scape`, and `read_active_objects`.

To create a flow, ask the agent to inspect the scape first and then use `apply_to_active_scape`.
For example: “Build an onboarding flow for the concept we just discussed. Add the journey,
supporting notes, and connect the steps in the paired Precipice scape.”

New cards are laid out by Precipice. Claude cannot set their coordinates, and the app validates
the same action and object schemas used by its built-in generation before applying anything.

## Review versus direct apply

The bridge starts in review mode. The agent's change batch appears in Settings, where you can apply
or reject it. Enable **Apply agent changes immediately** only for the current pairing if you
want the fast brainstorm-to-canvas workflow. Either route makes a single undoable transaction.

Disconnecting in Precipice revokes the pairing immediately. Closing the local MCP process also
discards every paired scape and pairing code.
