# Precipice for macOS

The Mac app and `precipice.pages.dev` share the React editor in this repository.
The existing Pages workflow still builds and deploys the web app. Desktop builds
are an additional target; they do not deploy or change the hosted site.

## Build and install

Requires macOS 12+, Xcode command-line tools, Rust stable, Node.js, and pnpm.
See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
xcode-select --install
# Install Rust using https://rustup.rs, then open a new shell or:
source "$HOME/.cargo/env"
pnpm install --frozen-lockfile
pnpm desktop:dev
```

For a local release:

```sh
pnpm desktop:build
```

Open the DMG under `src-tauri/target/release/bundle/dmg/`, drag Precipice into
Applications, then launch it. Builds target the current Mac architecture. This
local build is not Developer ID signed or notarized and needs no Apple Developer
account. For downloaded unsigned builds, macOS may require approval in System
Settings → Privacy & Security. Do not disable Gatekeeper globally.

For distribution to other people, use Developer ID signing and Apple notarization:
[Tauri signing guide](https://v2.tauri.app/distribute/sign/macos/). Stable signing
identity also avoids unexpected Keychain access prompts across updates. The
manual GitHub workflow produces unsigned test artifacts, not public releases.

## Remember a key

Open Settings, paste an Anthropic key, check **Remember securely on this Mac**,
and click **Save in Keychain**. On later launches the app loads that key. To
replace it, paste a new key, check the same option, and choose **Replace saved
key**. **Remove key** deletes the Keychain item and clears the active session key.
If macOS denies deletion, the UI reports that the stored key remains.

Without the checkbox, **Use for this session** keeps the key only in memory until
quit/reload. A temporary replacement does not overwrite a saved key. If the login
keychain is locked or access is denied, unlock it and reopen the app to retry
loading, or enter a temporary key. No failed operation falls back to disk storage.

The credential is a non-synchronizing generic-password item in the login Keychain,
service `dev.precipice.desktop.anthropic`, account `api-key`. The app never stores
it in localStorage, sessionStorage, IndexedDB, exports, configuration files, or
logs. Native errors return fixed messages. The key is present in the running
app's memory and JavaScript context for the shared AI SDK; Keychain protects it
at rest, not against a compromised app or logged-in device. It is not a Secure
Enclave/non-exportable credential. macOS Keychain backup/migration policies still
apply. No iCloud credential synchronization is requested.

Desktop AI calls use Anthropic directly, with its browser-access header. Web AI
calls keep using the existing Worker and tab-session storage. The native bridge
exposes only read/save/remove for this fixed credential to the local main window;
remote pages get no native permissions. Navigation away from the bundled app is
blocked, and the bundled app has a CSP. Service workers are web-only.

## Data and current limits

Scapes in the Mac app are separate from browser Scapes. Choose **Export library** on the browser home page, then **Import** in the Mac
app and select the downloaded `Precipice-library.json` file. All Scapes are added as new copies in one
transaction; existing desktop Scapes are never overwritten. Document content,
timestamps and action history transfer; credentials, preferences, publication
ownership and MCP pairing do not. The file is plain JSON: keep it private and out
of Git. Export individual `.scape` files for selective transfer. Neither route
automatically synchronizes future edits. Updating the app with
the same bundle identifier preserves its local data and Keychain service name.
Uninstalling the app does not remove its Keychain item; remove the key in Settings
first, or remove the item using Keychain Access.

This first desktop target covers local editing and AI generation. Hosted publishing,
Google sign-in, remote MCP pairing, browser links, and download/export behavior
need separate installed-app compatibility checks; browser OAuth and Turnstile
origins are not configured for the native origin. Continue using the web app for
hosted publishing. Do not put production publishing environment variables into
a local desktop build expecting browser authentication to work automatically.

## Verification

```sh
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
# Optional: writes, replaces, reads, and deletes a disposable test Keychain item:
cargo test --manifest-path src-tauri/Cargo.toml keychain_round_trip -- --ignored
```

Manual installed-app acceptance: save a test key, quit/reopen, generate; replace,
quit/reopen and generate; remove, quit/reopen and confirm a key is requested. Deny
Keychain access and verify the error and temporary-session flow. Use your own
throwaway API key for paid generation checks. Confirm a `Precipice-library.json`
transfer before moving important work from the browser.
