# Library and templates

Home stores your library on this device. Returning users see Continue working first; New scape
reveals the existing composer and templates. Last opened is separate from last edited.
The sidebar opens **Home**, **Inbox**, **Templates**,
**Published**, **Agents**, and **Instructions**; compact navigation serves smaller screens.
Import, Back up library, Settings, and Help remain available in the shell.

## Create and reopen

Describe an idea in the Home composer, choose a template, and generate with your own Anthropic
key. Choose manual creation to start without AI. Templates are Blank, Product concept, User
journey, Screen flow, and Research synthesis. Each explains its starting blocks and suggested
prompts. Older Mind map and Product brief scapes use Research synthesis and Product concept.
A template focuses the initial draft; every scape can still add every supported block type.

Search by name or press `/` to focus search. Filter by all, pinned, or published;
counts show the available groups. Choose gallery or list and a sort order. Pinned scapes
appear first. Preferences and pins are local settings; pinning does not change document content
or its edited time. A card’s menu groups open, rename, duplicate, export, publish, and delete.
Rename and delete respect the same single-writer protection as the editor. Deleting a scape that
has ever been published first removes its server copy (sign-in required), then deletes the local
document, its history, its publication record, and its pin.

## Inbox, work state and content search

Capture a note from navigation, the editor or commands without connecting AI or choosing a
template. Save to Inbox confirms only after local persistence. Edit, archive and restore notes;
Add to scape creates a note in a new or closed existing scape. Promoted originals remain archived.
Open destinations are refused rather than overwritten. Cmd/Ctrl+Alt+N opens capture; dictation
keeps Cmd/Ctrl+Shift+Space.

Scape menus offer optional Active, Parked and Done states, independent of pins and edit time.
Filter by a state once it is in use. Search content (Cmd/Ctrl+Shift+F) searches titles, object
text, tags and flows locally, and opens the matched block. Home Cmd/Ctrl+K opens content search;
editor Cmd/Ctrl+K retains its command palette with search/capture/navigation entries.

Settings → General separates Interface style (Current, Graphite, Field) from Light/Dark/System.
Styles preserve the logo, orange Scapi artwork, fonts and all controls. Session restoration keeps
panel choices and selection; unsent drafts stay tab-session only and are never automatically sent.

Library backups include Inbox and archived originals as compatible note scapes. This build imports
them back into Inbox; older builds open them as ordinary scapes. Backups still exclude credentials,
preferences, publication ownership and action history. Work-state organization remains local.

## Published links

Published lists saved scapes with live or reserved links. Copy or view a live link; **Manage**
opens the editor’s publication controls. Edits remain private until **Update public copy**.
Unpublishing retains the URL and slot. Unsaved MCP chat previews have no local scape mapping
and are managed from their chat preview or the authenticated publication API.

## Agents and instructions

Agents contains local and hosted connection setup, scopes, review policy, and revocation.
The same panel remains in Settings for editor access. Keep the chosen library host available
for hosted clients. See [MCP](mcp.md) for in-chat preview and confirmation.

Instructions saves standing AI rules as you type. These apply to built-in drafts and Scapi
in this library. External MCP agents read each scape’s own instructions; set those from its
composer or the agent instruction tools.

## Move and protect your library

**Back up library** downloads `Precipice-library.json`: every scape's current document, without
its edit history (action log). A scape saved by a newer version of Precipice is left out, and the
backup names it. Import adds copies with new IDs and never overwrites existing scapes; a copy
whose name is already in the library is named "Name (imported)". A file that is not a Precipice
`.scape` or library backup is refused with "This isn't a Precipice file." A `.scape` file transfers individual documents. Credentials,
preferences, publication ownership, and MCP connections do not transfer. Browser and desktop
stores remain separate. Keep backups private and outside Git. See [local data](security-and-local-data.md).
