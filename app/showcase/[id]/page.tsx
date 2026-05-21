// Public showcase page. No auth required — anyone with the URL
// can open it (same contract as /s/[shareId] for single-asset shares).
//
// Server fetches the resolved showcase via the DAL. The resolver
// silently drops assets that no longer exist or aren't Public, so
// the page never 404s because of stale references. If the
// showcase itself was deleted, we 404 — that's the only legitimate
// "this URL is dead" case (the admin or rep removed it on purpose).

import { notFound } from "next/navigation";
import { resolveShowcase } from "@/lib/showcase-dal";
import ShowcasePageClient from "./ShowcasePageClient";

export default async function ShowcasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resolved = await resolveShowcase(id);
  if (!resolved) notFound();

  return (
    <ShowcasePageClient
      showcase={{
        id: resolved.id,
        name: resolved.name,
        description: resolved.description,
        templateId: resolved.templateId,
        templateConfig: resolved.templateConfig,
      }}
      assets={resolved.assets}
    />
  );
}
