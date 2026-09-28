import { useState } from "react";
import { Button } from "@/design/Button";
import { readSession, startSignIn } from "@/publish/session";
import { TurnstileChallenge } from "@/publish/PublishSheet";
import { MCP_ORIGIN } from "@/mcp/host/relay";
import { Brand } from "../Brand";

export function HostConsent({ challenge }: { challenge: string }) {
  const session = readSession();
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [callback, setCallback] = useState("");
  const connect = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${MCP_ORIGIN}/host/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session!.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ challenge }),
      });
      if (!response.ok) throw new Error("Could not connect. Sign in again and retry.");
      const { redirectTo } = (await response.json()) as { redirectTo: string };
      setCallback(redirectTo);
      window.location.assign(redirectTo);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid h-full place-items-center bg-base p-4">
      <section className="w-full max-w-md rounded-xl border border-subtle bg-surface p-6">
        <Brand compact />
        <h1 className="mt-5 text-lg text-fg">Connect your Mac to Precipice</h1>
        <p className="mt-2 text-xs text-fg-secondary">
          Allow the Precipice app that opened this page to host agents for your account. Its library
          stays on your Mac. Only continue if you started this from Settings → Agents in Precipice.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-5">
          {callback ? (
            <a href={callback} className="text-accent">
              Return to Precipice
            </a>
          ) : session ? (
            <Button variant="primary" disabled={busy} onClick={() => void connect()}>
              Connect this Mac
            </Button>
          ) : signingIn ? (
            <TurnstileChallenge
              disabled={busy}
              onToken={(token) => {
                setBusy(true);
                void startSignIn(`/host/${challenge}`, token).catch(() => {
                  setBusy(false);
                  setError("Could not sign in. Try again.");
                });
              }}
            />
          ) : (
            <Button variant="primary" onClick={() => setSigningIn(true)}>
              Continue with Google
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
