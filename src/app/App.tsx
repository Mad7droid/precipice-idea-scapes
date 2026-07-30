import { DevObjects } from "@/routes/dev/objects";
import { Link, useRoute } from "./router";

const DEV_ROUTES: Array<[string, string]> = [
  ["/dev/objects", "Object plugins — all types, both themes, 1× and 0.4×"],
  ["/dev/canvas", "Canvas — drag, connect, delete, layout, undo, live action log"],
  ["/dev/persistence", "Persistence — autosave, action log, export and import"],
  ["/dev/ai", "AI — key, prompt, ribbon, applied and skipped actions, evals"],
];

export function App() {
  const route = useRoute();

  if (route === "/dev/objects") return <DevObjects />;
  if (route.startsWith("/dev")) return <DevIndex route={route} />;

  return (
    <div className="grid h-full place-items-center bg-canvas">
      <div className="text-center">
        <h1 className="text-3xl text-fg">Precipice</h1>
        <p className="mt-2 text-fg-secondary">The workspace is not wired up yet.</p>
        <Link
          to="/dev"
          className="mono mt-6 inline-block rounded-full bg-surface px-4 py-2 text-fg-secondary"
        >
          Dev harnesses
        </Link>
      </div>
    </div>
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
