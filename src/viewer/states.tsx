/**
 * The four pages that are not a scape.
 *
 * This is the page a stranger sees first, often before they know what Precipice is, so each
 * state says what happened and what — if anything — to do about it. None of them apologise and
 * none of them blame the reader.
 */
function Shell({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 text-center">
      <div className="max-w-sm">
        <p className="text-base text-fg">{title}</p>
        <p className="mt-2 text-sm text-fg-tertiary">{detail}</p>
      </div>
    </main>
  );
}

export function LoadingState() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6" aria-busy="true">
      <p className="text-sm text-fg-tertiary" role="status">
        Loading…
      </p>
    </main>
  );
}

export function MissingState() {
  return (
    <Shell
      title="Nothing here"
      detail="This link does not point at a published scape. It may have been mistyped, or the
        publication may have been deleted."
    />
  );
}

/**
 * Deliberately distinct from "nothing here". Telling someone who already holds the link that it
 * *was* published discloses that it once existed, which is an acceptable trade for an error
 * page that makes sense — the alternative is a reader who thinks they mistyped a URL they were
 * sent.
 */
export function UnpublishedState() {
  return (
    <Shell
      title="No longer published"
      detail="The author unpublished this scape. The link will start working again if they
        publish it once more."
    />
  );
}

export function ErrorState({ detail }: { detail: string }) {
  return <Shell title="Could not load this scape" detail={detail} />;
}

export function UnknownRouteState() {
  return (
    <Shell
      title="Nothing here"
      detail="Published scapes live at addresses beginning /p/. Check the link you followed."
    />
  );
}
