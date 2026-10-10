import type { ReactNode } from "react";

/** The title block every sidebar page opens with: what this is, in a sentence. */
export function PageHeader({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-medium text-fg">{title}</h1>
        {children && <p className="mt-2 text-sm leading-6 text-fg-secondary">{children}</p>}
      </div>
      {action}
    </div>
  );
}
