import { useState } from "react";
import type { DesktopCredentials } from "./useCredentials";
import { buttonClass } from "@/design/Button";

export function CredentialSettings({
  credentials: c,
  id = "desktop-api-key",
  label = "Anthropic API key",
  placeholder = "sk-ant-…",
  vendor = "Anthropic",
  missing = "Add a key to generate.",
}: {
  credentials: DesktopCredentials;
  id?: string;
  label?: string;
  placeholder?: string;
  /** Who the key is sent to, named in the footnote. */
  vendor?: string;
  missing?: string;
}) {
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(false);
  const disabled = !c.ready || c.busy;
  const submit = async () => {
    if (!draft.trim() || disabled) return;
    if (remember) {
      if (!(await c.persist(draft))) return;
    } else c.change(draft.trim());
    setDraft("");
  };
  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1 block text-xs text-fg-secondary">
        {label}
      </label>
      <p role="status" className="mb-2 text-xs text-fg-tertiary">
        {!c.ready
          ? "Checking Keychain…"
          : c.saved
            ? "A key is saved in macOS Keychain."
            : c.key
              ? "Using a key for this app session."
              : missing}
      </p>
      <input
        id={id}
        type="password"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={c.saved ? "Enter a replacement key" : placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-subtle bg-inset px-3 py-2 text-sm text-fg focus-self"
      />
      <label className="mt-2 flex items-center gap-2 text-xs text-fg-secondary">
        <input
          type="checkbox"
          checked={remember}
          disabled={disabled}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Remember securely on this Mac
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={disabled || !draft.trim()}
          onClick={() => void submit()}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {c.busy
            ? "Updating…"
            : remember
              ? c.saved
                ? "Replace saved key"
                : "Save in Keychain"
              : "Use for this session"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void c.persist(null)}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          Remove key
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-tertiary">
        Saved keys survive app restarts. Session keys stay in memory until you quit. Removing a key
        clears both. Requests go directly to {vendor}.
      </p>
      {c.saved && (
        <p className="mt-2 text-xs text-fg-tertiary">
          A session replacement leaves the saved key available for the next launch.
        </p>
      )}
      {c.error && (
        <p role="alert" className="mt-2 text-xs text-fg-secondary">
          {c.error}
        </p>
      )}
    </div>
  );
}
