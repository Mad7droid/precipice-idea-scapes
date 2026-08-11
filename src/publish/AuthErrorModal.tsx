import type { AuthErrorReturn } from "./session";

/** Keeps an OAuth rejection in the editor, where the user still has the scape they were working on. */
export function AuthErrorModal({
  error,
  onClose,
}: {
  error: AuthErrorReturn;
  onClose: () => void;
}) {
  const inviteRequired = error.code === "invite_required";

  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[440px] rounded-xl border border-subtle bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-required-title"
        aria-describedby="invite-required-description"
      >
        <span className="mono text-fg-accent">
          {inviteRequired ? "INVITE ONLY" : "SIGN-IN ERROR"}
        </span>
        <h2 id="invite-required-title" className="mt-2 text-xl text-fg">
          {inviteRequired ? "You’re not on the invite list yet" : "Sign-in could not finish"}
        </h2>
        <p id="invite-required-description" className="mt-2 text-sm text-fg-secondary">
          {inviteRequired
            ? "Precipice is currently invite-only. Ask an administrator to invite the Google account you used, then try signing in again from Publish."
            : "A temporary server error interrupted sign-in. Return to Publish and try again."}
        </p>

        <div className="mt-4 rounded-md bg-inset px-3 py-2.5 text-xs text-fg-tertiary">
          Your scape is still here, and nothing was published or changed.
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors duration-fast hover:bg-accent-hover"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
