import { useState } from "react";
import type { DesktopCredentials } from "./useCredentials";
import { buttonClass } from "@/design/Button";

/** A desktop key: saved in macOS Keychain, never shown again, replaceable or removable. */
export function CredentialSettings({
  credentials: c,
  id = "desktop-api-key",
  label = "Anthropic API key",
  placeholder = "sk-ant-…",
}: {
  credentials: DesktopCredentials;
  id?: string;
  label?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const disabled = !c.ready || c.busy;
  const submit = async () => {
    if (!draft.trim() || disabled) return;
    if (await c.persist(draft)) setDraft("");
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-fg-secondary">
        {label}
      </label>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          id={id}
          type="password"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={c.saved ? "Saved · paste to replace" : placeholder}
          autoComplete="off"
          spellCheck={false}
          className="mono min-w-0 flex-1 rounded-md border border-subtle bg-inset px-3 py-1.5 text-sm text-fg placeholder:text-fg-tertiary focus-self"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {c.busy ? "Saving…" : c.saved ? "Replace" : "Save"}
        </button>
        {c.saved && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void c.persist(null)}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Remove
          </button>
        )}
      </form>
      <p role="status" className="mt-1.5 text-xs text-fg-tertiary">
        {!c.ready
          ? "Checking Keychain…"
          : c.saved
            ? "Saved in this Mac’s Keychain."
            : "Kept in this Mac’s Keychain once saved."}
      </p>
      {c.error && !c.denied && (
        <p role="alert" className="mt-1.5 text-xs text-fg-secondary">
          {c.error}
        </p>
      )}
    </div>
  );
}
