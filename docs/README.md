# Documentation

Maintained guides for the current source tree:

| Guide | Purpose |
| --- | --- |
| [Product and setup](../README.md) | Browser and desktop workflows, features, screenshots |
| [Desktop](desktop.md) | Build/install, Keychain, sign-in, local data and acceptance checks |
| [Agents and MCP](mcp.md) | Local and hosted client setup, review, scopes and deployment |
| [Publishing](publishing-runbook.md) | Hosted snapshots, configuration, limits and sharing checks |
| [Architecture](codebase-architecture.md) | Runtime boundaries and implementation map |
| [Security and local data](security-and-local-data.md) | Storage, credentials, disclosure and agent trust |
| [Security policy](../SECURITY.md) | Private vulnerability reporting and repository hygiene |
| [Design language](design-language.md) | Visual principles and current component rules |
| [Screenshot provenance](screenshots/README.md) | Public demo images and safe capture procedure |

[CHANGELOG.md](../CHANGELOG.md) records user-visible changes. [CLAUDE.md](../CLAUDE.md) gives
contributor rules. [NOTES.md](../NOTES.md) and the original
[persistence](ws-a-persistence.md), [canvas](ws-b-canvas.md), [AI](ws-c-ai.md), and
[objects](ws-d-objects.md) workstreams are historical design records; their scope limits are
not current feature restrictions. Source contracts and tests take precedence over old plans.

Docs describe implementation, not a guarantee that every hosted deployment or locally installed
app has been updated. Desktop installation and hosted deployment are separate release steps.
