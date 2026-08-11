import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { notify } from "@/core/notify";
import { scapeRepository } from "@/persistence/scapeRepository";
import { consumePublicCopy, localCopyFromPublication } from "@/shared/publicCopy";
import {
  completeSignIn,
  readAuthErrorFragment,
  readAuthFragment,
  type AuthErrorReturn,
} from "@/publish/session";
import { AuthErrorModal } from "@/publish/AuthErrorModal";
import { Editor } from "./Editor";
import { Home } from "./Home";
import { Link, match, navigate, scapeRoute, useRoute } from "./router";
import { ToastHost } from "./ToastHost";
import { AppSettingsProvider } from "./useAppSettings";

const DevAi = lazy(() => import("@/routes/dev/ai").then(({ DevAi }) => ({ default: DevAi })));
const DevPublish = lazy(() =>
  import("@/routes/dev/publish").then(({ DevPublish }) => ({ default: DevPublish })),
);
const DevCanvas = lazy(() =>
  import("@/routes/dev/canvas").then(({ DevCanvas }) => ({ default: DevCanvas })),
);
const DevObjects = lazy(() =>
  import("@/routes/dev/objects").then(({ DevObjects }) => ({ default: DevObjects })),
);
const DevPersistence = lazy(() =>
  import("@/routes/dev/persistence").then(({ DevPersistence }) => ({ default: DevPersistence })),
);

const DEV_ROUTES: Array<[string, string]> = [
  ["/dev/objects", "Object plugins — all types, both themes, 1× and 0.4×"],
  ["/dev/canvas", "Canvas — drag, connect, delete, layout, undo, live action log"],
  ["/dev/persistence", "Persistence — autosave, action log, export and import"],
  ["/dev/ai", "AI — key, prompt, ribbon, applied and skipped actions, evals"],
  ["/dev/publish", "Publishing — sign-in, publish, update, unpublish, quota, against a stub"],
];

export function App() {
  const signIn = useSignInReturn();
  const copying = usePublicCopyImport();

  // Routing is held back only while a sign-in code is being exchanged, which is one request
  // against a 60-second code. Rendering the route first would flash the wrong screen and then
  // navigate away from it.
  if (signIn.pending || copying) {
    return (
      <main className="grid h-full place-items-center bg-base" role="status">
        {signIn.pending ? "Signing you in…" : "Creating your local copy…"}
      </main>
    );
  }

  return (
    <AppSettingsProvider>
      <Routes />
      <ToastHost />
      {signIn.error && <AuthErrorModal error={signIn.error} onClose={signIn.dismissError} />}
    </AppSettingsProvider>
  );
}

/** The editor is the only side that writes the staged public copy into this browser's library. */
function usePublicCopyImport(): boolean {
  const [source] = useState(() => consumePublicCopy());
  const [pending, setPending] = useState(source !== null);

  useEffect(() => {
    if (!source) return;
    let live = true;
    const copy = localCopyFromPublication(source);

    void (async () => {
      await scapeRepository.saveSnapshot(copy, Date.now());
      if (!live) return;
      // Repositories surface quota failures as a notification and leave no row behind. Do not
      // navigate to an editor for a document that did not make it to durable local storage.
      if (!(await scapeRepository.get(copy.id))) {
        notify.error("Could not create a local copy.", "Your browser could not save the scape.");
        return;
      }
      navigate(scapeRoute(copy.id));
      notify.success("Local copy created.", "This copy is private to this browser.");
    })().finally(() => live && setPending(false));

    return () => {
      live = false;
    };
  }, [source]);

  return pending;
}

/**
 * The return leg of Google sign-in.
 *
 * The Worker sends the browser back to `<origin>/#token=<code>&return=<route>`: one fragment
 * carrying both values, because this app's routes live in the fragment. The code is exchanged
 * once, the fragment is stripped, and the user is put back where they were — which is the whole
 * reason `return` travels at all.
 */
function useSignInReturn(): {
  pending: boolean;
  error: AuthErrorReturn | null;
  dismissError: () => void;
} {
  const [pending, setPending] = useState(() => readAuthFragment(window.location.hash) !== null);
  const [error, setError] = useState<AuthErrorReturn | null>(() =>
    readAuthErrorFragment(window.location.hash),
  );

  useEffect(() => {
    if (!error) return;
    // Remove the one-shot auth result before navigating. The route is restored separately so
    // the hash router never has to interpret the auth payload as a page.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    navigate(error.returnRoute);
  }, [error]);

  useEffect(() => {
    if (!pending) return;
    let live = true;

    void completeSignIn()
      .then((result) => {
        if (!live) return;
        navigate(result?.returnRoute ?? "/");
        if (result) notify.success("Signed in.", result.session.email);
      })
      .catch(() => {
        if (!live) return;
        navigate("/");
        notify.error("Sign-in did not complete.", "Try publishing again.");
      })
      .finally(() => live && setPending(false));

    return () => {
      live = false;
    };
  }, [pending]);

  return { pending, error, dismissError: () => setError(null) };
}

function Routes() {
  const route = useRoute();

  if (route === "/dev/objects")
    return (
      <DevRoute>
        <DevObjects />
      </DevRoute>
    );
  if (route === "/dev/canvas")
    return (
      <DevRoute>
        <DevCanvas />
      </DevRoute>
    );
  if (route === "/dev/persistence")
    return (
      <DevRoute>
        <DevPersistence />
      </DevRoute>
    );
  if (route === "/dev/ai")
    return (
      <DevRoute>
        <DevAi />
      </DevRoute>
    );
  if (route === "/dev/publish")
    return (
      <DevRoute>
        <DevPublish />
      </DevRoute>
    );
  if (route.startsWith("/dev")) return <DevIndex route={route} />;

  const scapeId = match("/s", route);
  // Keyed so that navigating between two scapes remounts rather than trying to reconcile one
  // document's canvas, selection and autosave into another's.
  if (scapeId) return <Editor key={scapeId} scapeId={scapeId} />;

  return <Home />;
}

function DevRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="grid h-full place-items-center bg-base" role="status">
          Loading development harness…
        </main>
      }
    >
      {children}
    </Suspense>
  );
}

function DevIndex({ route }: { route: string }) {
  return (
    <div className="h-full overflow-auto bg-base px-8 py-10">
      <div className="mx-auto max-w-[720px]">
        <span className="mono">dev harnesses</span>
        <h1 className="mt-2 text-2xl text-fg">Precipice</h1>
        <p className="mt-2 text-fg-secondary">
          Each harness exercises one workstream against the fixture scape, standalone.
        </p>

        <ul className="mt-8 space-y-1">
          {DEV_ROUTES.map(([path, description]) => (
            <li key={path}>
              <Link
                to={path}
                className="block rounded-md px-3 py-2 transition-colors duration-instant ease-out hover:bg-hover"
              >
                <span className="mono">{path}</span>
                <span className="mt-0.5 block text-fg-secondary">{description}</span>
              </Link>
            </li>
          ))}
        </ul>

        {route !== "/dev" && (
          <p className="mt-8 text-fg-tertiary">
            <span className="mono">{route}</span> is not built yet.
          </p>
        )}
      </div>
    </div>
  );
}
