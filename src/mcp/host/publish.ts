import type { Scape } from "@/core/types";
import { scapeRepository } from "@/persistence/scapeRepository";
import { createPublication, updatePublication, unpublish, republish } from "@/publish/client";
import { projectScape } from "@/publish/project";
import { hostToken } from "./credential";

/** Called only after the person confirms the public-disclosure review card. */
export async function publishFromAgent(scape: Scape, withdraw: boolean) {
  const token = hostToken();
  if (!token)
    throw new Error(
      "Sign in to Precipice or connect this Mac in Agents, then ask the agent to retry.",
    );
  const existing = await scapeRepository.publications.get(scape.id);
  if (withdraw && !existing) throw new Error("This scape has no published snapshot.");
  const projection = projectScape(scape);
  if (!withdraw && projection.skipped.length)
    throw new Error(
      "Some blocks cannot be published. Open the Publish panel to review them first.",
    );
  let publication = withdraw
    ? await unpublish(existing!.publicationId, { token })
    : existing
      ? await updatePublication(existing.publicationId, projection.scape, { token })
      : await createPublication(projection.scape, { token });
  if (!withdraw && publication.status === "unpublished")
    publication = await republish(publication.publicationId, { token });
  await scapeRepository.publications.put({
    scapeId: scape.id,
    publicationId: publication.publicationId,
    publishedHash: publication.hash,
    version: publication.version,
    status: publication.status,
    updatedAt: publication.updatedAt,
  });
  window.dispatchEvent(new Event("precipice-publication-changed"));
  return {
    url: publication.url,
    message: withdraw ? "Public snapshot withdrawn." : "Public snapshot published.",
  };
}
