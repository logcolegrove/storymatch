// Public showcase page. No auth required — anyone with the URL
// can open it (same contract as /s/[shareId] for single-asset shares).
//
// Server fetches the resolved showcase via the DAL. The resolver
// silently drops assets that no longer exist or aren't Public, so
// the page never 404s because of stale references. If the
// showcase itself was deleted, we 404 — that's the only legitimate
// "this URL is dead" case (the admin or rep removed it on purpose).
//
// We also fetch the org's FieldDefs alongside the showcase so the
// filter-element renderers can show category labels + value pickers
// keyed off the same schema as the master library. No auth gate —
// field defs are display-only on the public page (no admin-mode
// edits possible from here).

import { notFound } from "next/navigation";
import { resolveShowcase } from "@/lib/showcase-dal";
import { fetchOrgFieldDefs } from "@/lib/field-defs";
import ShowcasePageClient from "./ShowcasePageClient";

export default async function ShowcasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resolved = await resolveShowcase(id);
  if (!resolved) notFound();

  // Fetch field defs in parallel-ish. resolveShowcase already came
  // back, so the network call here is sequential but cheap — single
  // table read. Default to empty array on any error to keep the
  // public page rendering with the asset grid alone.
  let fieldDefs: { key: string; label: string; type: "text" | "select" | "multi_select" | "number" | "date"; options?: string[] }[] = [];
  try {
    const defs = await fetchOrgFieldDefs(resolved.orgId);
    fieldDefs = defs.map(d => ({ key: d.key, label: d.label, type: d.type, options: d.options }));
  } catch (e) {
    console.error("[showcase] failed to fetch field defs", e);
  }

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
      fieldDefs={fieldDefs}
    />
  );
}
