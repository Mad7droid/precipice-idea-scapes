import { lazy, Suspense, type ReactNode } from "react";
import { Editor } from "./Editor";
import { Home } from "./Home";
import { Link, match, useRoute } from "./router";
import { ToastHost } from "./ToastHost";
import { AppSettingsProvider } from "./useAppSettings";

const DevAi = lazy(() => import("@/routes/dev/ai").then(({ DevAi }) => ({ default: DevAi })));
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
];

export function App() {
  return (
    <AppSettingsProvider>
      <Routes />
      <ToastHost />
    </AppSettingsProvider>
  );
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
