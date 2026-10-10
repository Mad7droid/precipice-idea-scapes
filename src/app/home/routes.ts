/** The pages that share the home shell. Anything else is a scape, a consent screen, or dev. */
export const HOME_PAGES = {
  "/": "home",
  "/templates": "templates",
  "/published": "published",
  "/agents": "agents",
  "/instructions": "instructions",
} as const;

export type HomePage = (typeof HOME_PAGES)[keyof typeof HOME_PAGES];

export function homePage(route: string): HomePage | null {
  return (HOME_PAGES as Record<string, HomePage>)[route] ?? null;
}

export const PAGE_ROUTE: Record<HomePage, string> = {
  home: "/",
  templates: "/templates",
  published: "/published",
  agents: "/agents",
  instructions: "/instructions",
};
