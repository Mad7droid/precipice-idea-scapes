import { useEffect, useState } from "react";

/**
 * A hash router in thirty lines, because no router is in the locked stack and the route set
 * is fixed: the app itself plus four dev harnesses. If routing ever needs params or nesting,
 * swap this for react-router and note the dependency.
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
