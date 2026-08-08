import { useEffect, useState } from "react";

/**
 * A hash router in fifty lines, because no router is in the locked stack and the route set is
 * still small: home, one scape, four dev harnesses.
 *
 * It grew exactly one feature — a single trailing parameter, for `/s/<scapeId>` — rather than
 * the react-router dependency. Nested routes or a second parameter would be the point to stop
 * and swap this out; a `match` that only understands one segment is not worth defending twice.
 */
export function useRoute(): string {
  const [route, setRoute] = useState(() => normalize(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(normalize(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

function normalize(hash: string): string {
  const path = hash.replace(/^#/, "");
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "");
}

/**
 * The one parameterised route. Returns the trailing segment of `/<prefix>/<value>`, or null.
 *
 * `match("/s", "/s/scp_abc")` → `"scp_abc"`. A nested path underneath returns null rather than
 * a partial match, so a future `/s/<id>/settings` fails loudly here instead of silently
 * loading the wrong scape.
 */
export function match(prefix: string, route: string): string | null {
  if (!route.startsWith(`${prefix}/`)) return null;
  const rest = route.slice(prefix.length + 1);
  return rest.length > 0 && !rest.includes("/") ? decodeURIComponent(rest) : null;
}

export const scapeRoute = (id: string) => `/s/${encodeURIComponent(id)}`;

export function navigate(route: string): void {
  window.location.hash = route;
}

export function Link({
  to,
  children,
  className,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
