"use client";

// InsightsView — admin-only, full-page view that replaces the
// library canvas when the Insights side-rail item is active.
//
// Layout:
//
//   Team adoption                        [Range picker]
//   ┌───────────┐ ┌───────────┐ ┌───────────┐
//   │ Searches  │ │  Shared   │ │ Feedback  │   ← clickable tabs
//   │   487     │ │    23     │ │    31     │     (YouTube pattern)
//   └───────────┘ └───────────┘ └───────────┘
//
//   ┌─────────────────────────────────────────┐
//   │  Detail panel for the selected metric   │
//   │  (search feed / team shares / team fb)  │
//   └─────────────────────────────────────────┘
//
//   Coverage gaps
//   ┌─────────────────────────────────────────┐
//   │           Pivot matrix                  │
//   └─────────────────────────────────────────┘
//
//   Content analytics
//   ┌─────────────────────────────────────────┐
//   │  Coming soon (placeholder)              │
//   └─────────────────────────────────────────┘
//
// Each metric card is a tab — selecting one swaps the detail panel
// below to show the underlying rows (searches → search feed,
// shared → team-wide share rows with engagement, feedback → team
// feedback with attribution). Modeled after YouTube Studio's three
// metric cards above a swappable chart.
//
// The range picker drives BOTH the counter values AND the detail
// panel: switching to "Last 7 days" filters all three views in
// lockstep. Custom range pops a from/to picker.

import { useEffect, useMemo, useState } from "react";

type SearchSource = "library" | "storymatch";

interface SearchLogEntry {
  id: string;
  query: string;
  source: SearchSource;
  resultCount: number;
  topResultIds: string[];
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
}

type FieldType = "text" | "select" | "multi_select" | "number" | "date";
type FieldPopulator = "manual" | "vimeo" | "ai";

interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  showInFilters: boolean;
  position: number;
  system: boolean;
  systemColumn?: string;
  populator: FieldPopulator;
  aiAutoFill: boolean;
}

interface AssetLike {
  id: string;
  status: string;
  customFieldValues?: Record<string, unknown>;
}

// ── Range types ─────────────────────────────────────────────────
// `kind === "preset"` covers the standard 7/30/90/all shortcuts.
// `kind === "custom"` carries explicit ISO from/to. Both shapes
// resolve to the same set of query-string params via toQuery().
type RangePreset = "7" | "30" | "90" | "all";
type Range =
  | { kind: "preset"; preset: RangePreset }
  | { kind: "custom"; from: string; to: string };

const PRESET_LABEL: Record<RangePreset, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "all": "All time",
};

function toQuery(range: Range): string {
  if (range.kind === "preset") {
    if (range.preset === "all") return "";
    return `days=${range.preset}`;
  }
  // Custom — pass explicit ISO bounds. Each bound is optional but
  // we always have both from the picker UI.
  const parts: string[] = [];
  if (range.from) parts.push(`from=${encodeURIComponent(range.from)}`);
  if (range.to) parts.push(`to=${encodeURIComponent(range.to)}`);
  return parts.join("&");
}

function rangeKey(range: Range): string {
  // Stable key for effect dependency tracking. Same value → same
  // re-fetch. We can't use the Range object directly because React
  // does referential equality on dep arrays.
  return range.kind === "preset" ? `p:${range.preset}` : `c:${range.from}|${range.to}`;
}

function describeRange(range: Range): string {
  if (range.kind === "preset") return PRESET_LABEL[range.preset];
  const f = range.from ? new Date(range.from).toLocaleDateString() : "…";
  const t = range.to ? new Date(range.to).toLocaleDateString() : "…";
  return `${f} – ${t}`;
}

// ── Summary payload ─────────────────────────────────────────────
interface Summary {
  searches: number;
  linksShared: number;
  feedbackGiven: number;
}

interface Props {
  authHeaders: () => Promise<HeadersInit>;
  assets: AssetLike[];
  fieldDefs: FieldDef[];
  onRerunSearch?: (query: string, source: SearchSource) => void;
}

type Metric = "searches" | "shares" | "feedback";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export default function InsightsView({ authHeaders, assets, fieldDefs, onRerunSearch }: Props) {
  // Range applies to counters AND the active detail panel.
  // Default to All-time so the page has something interesting on
  // first load even if recent activity is sparse.
  const [range, setRange] = useState<Range>({ kind: "preset", preset: "all" });
  // Active metric — drives which detail panel renders below the
  // counters. Defaults to Searches because that's the most
  // information-dense + the original Insights surface.
  const [metric, setMetric] = useState<Metric>("searches");

  return (
    <div className="iv">
      <style>{css}</style>

      <header className="iv-page-head">
        <div>
          <h2>Insights</h2>
          <p className="iv-page-sub">See how your team is using StoryMatch and where the library has gaps.</p>
        </div>
      </header>

      <section className="iv-section">
        <div className="iv-section-head">
          <h3>Team adoption</h3>
          <RangePicker value={range} onChange={setRange}/>
        </div>

        <MetricTabs
          authHeaders={authHeaders}
          range={range}
          metric={metric}
          onChange={setMetric}
        />

        {/* Detail panel for the selected metric. */}
        <div className="iv-detail">
          {metric === "searches" && (
            <SearchFeed authHeaders={authHeaders} range={range} onRerunSearch={onRerunSearch}/>
          )}
          {metric === "shares" && (
            <TeamSharesPanel authHeaders={authHeaders} range={range}/>
          )}
          {metric === "feedback" && (
            <TeamFeedbackPanel authHeaders={authHeaders} assets={assets} range={range}/>
          )}
        </div>

        {/* Coverage gaps lives below the swappable detail. It has
            no time concept (it's measured against the current
            library) so the range picker doesn't affect it. */}
        <div className="iv-subsection">
          <div className="iv-subsection-head">
            <h4>Coverage gaps</h4>
            <p className="iv-subsection-sub">Where the library is thin. Red cells have no published assets — that&apos;s a gap your team can&apos;t close.</p>
          </div>
          <GapMatrix assets={assets} fieldDefs={fieldDefs}/>
        </div>
      </section>

      <section className="iv-section">
        <div className="iv-section-head">
          <h3>Content analytics</h3>
        </div>
        <div className="iv-coming-soon">
          <div className="iv-coming-soon-h">Coming soon</div>
          <p>
            Per-asset performance, dormant assets, top-performing quotes, and content freshness — all the
            ways to measure how the library itself is doing, separate from how the team uses it.
          </p>
        </div>
      </section>
    </div>
  );
}

// ─── Range picker ────────────────────────────────────────────────
// Preset dropdown + an inline "custom" mode that swaps the dropdown
// for two date inputs. Picking a preset reverts back to the
// dropdown UI on the next render.
function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  // The custom popover is open whenever the active range is custom
  // OR the user just clicked Custom and is mid-edit. We stash a
  // local draft so changing the date inputs doesn't refetch on
  // every keystroke — only on Apply.
  const [customOpen, setCustomOpen] = useState(value.kind === "custom");
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [draftFrom, setDraftFrom] = useState<string>(
    value.kind === "custom" ? value.from.slice(0, 10) : sevenDaysAgo,
  );
  const [draftTo, setDraftTo] = useState<string>(
    value.kind === "custom" ? value.to.slice(0, 10) : today,
  );

  const onPresetChange = (v: string) => {
    if (v === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange({ kind: "preset", preset: v as RangePreset });
  };

  const applyCustom = () => {
    // Always end at end-of-day for `to` so the same-day case
    // ("from today to today") includes everything that happened
    // earlier today.
    const fromIso = new Date(draftFrom + "T00:00:00").toISOString();
    const toIso = new Date(draftTo + "T23:59:59.999").toISOString();
    onChange({ kind: "custom", from: fromIso, to: toIso });
    setCustomOpen(false);
  };

  const cancelCustom = () => {
    setCustomOpen(false);
    // If we were already in custom mode, keep it. Otherwise no-op.
  };

  if (customOpen) {
    return (
      <div className="iv-range iv-range-custom">
        <span className="iv-range-label">Range</span>
        <input
          type="date"
          value={draftFrom}
          max={draftTo || today}
          onChange={e => setDraftFrom(e.target.value)}
        />
        <span className="iv-range-dash">→</span>
        <input
          type="date"
          value={draftTo}
          min={draftFrom}
          max={today}
          onChange={e => setDraftTo(e.target.value)}
        />
        <button type="button" className="iv-range-apply" onClick={applyCustom}>Apply</button>
        <button type="button" className="iv-range-cancel" onClick={cancelCustom}>Cancel</button>
      </div>
    );
  }

  return (
    <label className="iv-range">
      <span className="iv-range-label">Range</span>
      <select
        value={value.kind === "custom" ? "custom" : value.preset}
        onChange={e => onPresetChange(e.target.value)}
      >
        {(["7", "30", "90", "all"] as RangePreset[]).map(r => (
          <option key={r} value={r}>{PRESET_LABEL[r]}</option>
        ))}
        <option value="custom">
          {value.kind === "custom" ? describeRange(value) : "Custom range…"}
        </option>
      </select>
    </label>
  );
}

// ─── Metric tabs (counter cards) ─────────────────────────────────
// Three big numbers across the top. Each card is a clickable tab —
// the active one is solid + accent-bordered, the others sit at a
// muted neutral. This is the YouTube Studio pattern.
function MetricTabs({ authHeaders, range, metric, onChange }: {
  authHeaders: () => Promise<HeadersInit>;
  range: Range;
  metric: Metric;
  onChange: (m: Metric) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const qs = toQuery(range);
        const r = await fetch(`/api/insights/summary${qs ? `?${qs}` : ""}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as Summary;
        if (cancelled) return;
        setSummary(data);
      } catch (e) {
        console.error("[MetricTabs] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey(range), authHeaders]);

  const display = (n: number | undefined) => {
    if (loading || n == null) return "—";
    return n.toLocaleString();
  };

  return (
    <div className="iv-tabs">
      <MetricCard
        active={metric === "searches"}
        onClick={() => onChange("searches")}
        label="Searches"
        value={display(summary?.searches)}
        hint="Library + StoryMatch queries"
      />
      <MetricCard
        active={metric === "shares"}
        onClick={() => onChange("shares")}
        label="Links shared"
        value={display(summary?.linksShared)}
        hint="Asset links sent to prospects"
      />
      <MetricCard
        active={metric === "feedback"}
        onClick={() => onChange("feedback")}
        label="Feedback given"
        value={display(summary?.feedbackGiven)}
        hint="Ratings + notes on assets"
      />
    </div>
  );
}

function MetricCard({ active, onClick, label, value, hint }: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      className={`iv-tab${active ? " on" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className="iv-tab-value">{value}</div>
      <div className="iv-tab-label">{label}</div>
      <div className="iv-tab-hint">{hint}</div>
    </button>
  );
}

// ─── Search feed ─────────────────────────────────────────────────
// Chronological list of every library + StoryMatch search. Rows are
// clickable to re-run the search. Now shows the searcher's email.
function SearchFeed({ authHeaders, range, onRerunSearch }: {
  authHeaders: () => Promise<HeadersInit>;
  range: Range;
  onRerunSearch?: (query: string, source: SearchSource) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<SearchLogEntry[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | SearchSource>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const parts: string[] = [];
        if (sourceFilter !== "all") parts.push(`source=${sourceFilter}`);
        const rq = toQuery(range);
        if (rq) parts.push(rq);
        const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
        const r = await fetch(`/api/search-logs${qs}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as { recent: SearchLogEntry[] };
        if (cancelled) return;
        setRecent(data.recent || []);
      } catch (e) {
        console.error("[SearchFeed] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, rangeKey(range), authHeaders]);

  return (
    <div className="iv-feed">
      <div className="iv-filterbar">
        {([
          { v: "all", label: "All" },
          { v: "library", label: "Library" },
          { v: "storymatch", label: "StoryMatch" },
        ] as { v: "all" | SearchSource; label: string }[]).map(opt => (
          <button
            key={opt.v}
            type="button"
            className={`iv-chip${sourceFilter === opt.v ? " on" : ""}`}
            onClick={() => setSourceFilter(opt.v)}
          >{opt.label}</button>
        ))}
      </div>

      <div className="iv-list">
        {loading ? (
          <div className="iv-empty">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="iv-empty">
            <div className="iv-empty-h">No searches in this range</div>
            <p className="iv-empty-sub">Once your team starts running searches, they&apos;ll show up here.</p>
          </div>
        ) : recent.map(entry => {
          const zero = entry.resultCount === 0;
          return (
            <button
              key={entry.id}
              type="button"
              className="iv-search-row"
              onClick={() => onRerunSearch?.(entry.query, entry.source)}
              title="Click to re-run this search"
            >
              <div className="iv-search-q">{entry.query}</div>
              <div className="iv-search-meta">
                <span className={`iv-source-pill ${entry.source}`}>
                  {entry.source === "storymatch" ? "StoryMatch" : "Library"}
                </span>
                {entry.userEmail && (
                  <span className="iv-search-user" title={entry.userEmail}>{entry.userEmail}</span>
                )}
                <span className={`iv-search-count${zero ? " zero" : ""}`}>
                  {zero ? "0 results" : `${entry.resultCount} ${entry.resultCount === 1 ? "result" : "results"}`}
                </span>
                <span className="iv-search-when">{timeAgo(entry.createdAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Team shares panel ───────────────────────────────────────────
// Org-wide view of every trackable share link, with engagement
// metrics. Same data MySharesView shows under "Whole team" scope,
// presented inline + compact.
interface ShareRow {
  id: string;
  asset_id: string;
  sender_user_id: string;
  sender_email: string | null;
  created_at: string;
  open_count: number;
  asset_headline: string;
  asset_company: string;
  asset_thumbnail: string;
  max_watched_percent: number;
  completed: boolean;
  visitor_count: number;
}

function TeamSharesPanel({ authHeaders, range }: {
  authHeaders: () => Promise<HeadersInit>;
  range: Range;
}) {
  const [loading, setLoading] = useState(true);
  const [shares, setShares] = useState<ShareRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const parts: string[] = ["scope=org"];
        const rq = toQuery(range);
        if (rq) parts.push(rq);
        const r = await fetch(`/api/share/list?${parts.join("&")}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as { shares: ShareRow[] };
        if (cancelled) return;
        setShares(data.shares || []);
      } catch (e) {
        console.error("[TeamSharesPanel] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey(range), authHeaders]);

  return (
    <div className="iv-feed">
      <div className="iv-list">
        {loading ? (
          <div className="iv-empty">Loading…</div>
        ) : shares.length === 0 ? (
          <div className="iv-empty">
            <div className="iv-empty-h">No shares in this range</div>
            <p className="iv-empty-sub">When your team copies asset links to send to prospects, those shares show up here with engagement data.</p>
          </div>
        ) : shares.map(s => (
          <div key={s.id} className="iv-share-row">
            {s.asset_thumbnail ? (
              <img src={s.asset_thumbnail} alt="" className="iv-share-thumb"/>
            ) : (
              <div className="iv-share-thumb iv-share-thumb-empty"/>
            )}
            <div className="iv-share-body">
              <div className="iv-share-headline">{s.asset_headline || "Untitled asset"}</div>
              <div className="iv-share-sub">
                {s.asset_company && <span>{s.asset_company}</span>}
                {s.sender_email && <span className="iv-share-author">{s.sender_email}</span>}
              </div>
            </div>
            <div className="iv-share-stats">
              <div className="iv-share-stat">
                <span className="iv-share-stat-v">{s.open_count}</span>
                <span className="iv-share-stat-l">{s.open_count === 1 ? "open" : "opens"}</span>
              </div>
              <div className="iv-share-stat">
                <span className="iv-share-stat-v">{Math.round(s.max_watched_percent)}%</span>
                <span className="iv-share-stat-l">watched</span>
              </div>
              {s.completed && <span className="iv-share-completed" title="Prospect watched to the end">✓ Done</span>}
            </div>
            <span className="iv-share-when">{timeAgo(s.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Team feedback panel ─────────────────────────────────────────
// Org-wide rating + comment stream. Pulls /api/feedback?summary=true
// which returns per-asset aggregate + comment list (with user
// attribution).
interface FeedbackComment {
  rating: "up" | "down";
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  userEmail: string | null;
}
interface FeedbackAssetBundle {
  assetId: string;
  up: number;
  down: number;
  total: number;
  netScore: number;
  comments: FeedbackComment[];
}
interface FeedbackAssetRef {
  id: string;
  headline?: string;
  company?: string;
  clientName?: string;
  thumbnail?: string;
}

function TeamFeedbackPanel({ authHeaders, assets, range }: {
  authHeaders: () => Promise<HeadersInit>;
  assets: AssetLike[];
  range: Range;
}) {
  const [loading, setLoading] = useState(true);
  const [bundles, setBundles] = useState<FeedbackAssetBundle[]>([]);

  // Asset lookup map — we got the slim AssetLike shape from
  // StoryMatchApp. We need headline + thumbnail to render each
  // group's row, but those aren't in AssetLike. Fall back to
  // asset_id text when missing.
  const assetMap = useMemo(() => {
    const m = new Map<string, FeedbackAssetRef>();
    for (const a of assets) {
      const rec = a as unknown as Record<string, unknown>;
      m.set(a.id, {
        id: a.id,
        headline: (rec.headline as string) || undefined,
        company: (rec.company as string) || undefined,
        clientName: (rec.clientName as string) || undefined,
        thumbnail: (rec.thumbnail as string) || undefined,
      });
    }
    return m;
  }, [assets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const parts: string[] = ["summary=true"];
        const rq = toQuery(range);
        if (rq) parts.push(rq);
        const r = await fetch(`/api/feedback?${parts.join("&")}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as { assets: FeedbackAssetBundle[] };
        if (cancelled) return;
        setBundles(data.assets || []);
      } catch (e) {
        console.error("[TeamFeedbackPanel] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey(range), authHeaders]);

  // Flatten into a chronological comment stream — easier to scan
  // than per-asset grouping when looking for "what did the team
  // say recently". Each comment carries its asset ref for context.
  const flat = useMemo(() => {
    const rows: Array<FeedbackComment & { assetRef: FeedbackAssetRef | undefined }> = [];
    for (const b of bundles) {
      for (const c of b.comments) {
        rows.push({ ...c, assetRef: assetMap.get(b.assetId) });
      }
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }, [bundles, assetMap]);

  // Surface the "silent" ratings too — assets that got a thumbs
  // with no comment count toward the total. We don't render them
  // as individual rows (no text to show) but we report them in a
  // header bar so the picture stays honest.
  const ratingsWithoutComment = useMemo(() => {
    let n = 0;
    for (const b of bundles) n += b.total;
    return n - flat.length;
  }, [bundles, flat.length]);

  return (
    <div className="iv-feed">
      <div className="iv-list">
        {loading ? (
          <div className="iv-empty">Loading…</div>
        ) : flat.length === 0 && bundles.length === 0 ? (
          <div className="iv-empty">
            <div className="iv-empty-h">No feedback in this range</div>
            <p className="iv-empty-sub">When your team rates assets, their ratings and notes show up here so you can spot what&apos;s working and what isn&apos;t.</p>
          </div>
        ) : (
          <>
            {ratingsWithoutComment > 0 && (
              <div className="iv-fb-meta">
                Plus {ratingsWithoutComment.toLocaleString()} silent {ratingsWithoutComment === 1 ? "rating" : "ratings"} (thumbs without a note) in this range.
              </div>
            )}
            {flat.map((c, i) => (
              <div key={`${c.userId || "anon"}-${c.createdAt}-${i}`} className={`iv-fb-row ${c.rating}`}>
                {c.assetRef?.thumbnail ? (
                  <img src={c.assetRef.thumbnail} alt="" className="iv-fb-thumb"/>
                ) : (
                  <div className="iv-fb-thumb iv-fb-thumb-empty"/>
                )}
                <div className="iv-fb-body">
                  <div className="iv-fb-headline">{c.assetRef?.headline || "Untitled asset"}</div>
                  <div className="iv-fb-meta-row">
                    <span className={`iv-fb-pill ${c.rating}`}>{c.rating === "up" ? "👍" : "👎"}</span>
                    {c.userEmail && <span className="iv-fb-user" title={c.userEmail}>{c.userEmail}</span>}
                    <span className="iv-fb-when">{timeAgo(c.createdAt)}</span>
                  </div>
                  {c.comment && <div className="iv-fb-text">{c.comment}</div>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Coverage gap matrix ─────────────────────────────────────────
// Unchanged from the previous Insights iteration — pivot of assets
// across two field dimensions with a 4-tier red/amber/green color
// scale.
function GapMatrix({ assets, fieldDefs }: { assets: AssetLike[]; fieldDefs: FieldDef[] }) {
  const axisCandidates = useMemo(() => {
    return fieldDefs
      .filter(f => (f.type === "select" || f.type === "multi_select") && Array.isArray(f.options) && f.options.length > 0)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [fieldDefs]);

  const [rowKey, setRowKey] = useState<string>("");
  const [colKey, setColKey] = useState<string>("");
  useEffect(() => {
    if (axisCandidates.length === 0) return;
    if (!rowKey || !axisCandidates.find(c => c.key === rowKey)) {
      setRowKey(axisCandidates[0]?.key || "");
    }
    if (!colKey || !axisCandidates.find(c => c.key === colKey)) {
      setColKey(axisCandidates[1]?.key || axisCandidates[0]?.key || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisCandidates]);

  const rowDef = axisCandidates.find(c => c.key === rowKey);
  const colDef = axisCandidates.find(c => c.key === colKey);

  const bucketsForAsset = (a: AssetLike, def: FieldDef): string[] => {
    const raw = def.system
      ? (a as unknown as Record<string, unknown>)[def.key]
      : (a.customFieldValues || {})[def.key];
    if (raw == null || raw === "") return [];
    if (Array.isArray(raw)) {
      return (raw as unknown[]).filter(v => typeof v === "string" && v.length > 0) as string[];
    }
    if (typeof raw === "string") return [raw];
    return [];
  };

  const matrix = useMemo(() => {
    if (!rowDef || !colDef) return null;
    const rowOpts = [...(rowDef.options || []), "Unspecified"];
    const colOpts = [...(colDef.options || []), "Unspecified"];
    const counts: Record<string, Record<string, number>> = {};
    for (const r of rowOpts) {
      counts[r] = {};
      for (const c of colOpts) counts[r][c] = 0;
    }
    for (const a of assets) {
      if (a.status === "deleted" || a.status === "archived") continue;
      const rs = bucketsForAsset(a, rowDef);
      const cs = bucketsForAsset(a, colDef);
      const rBuckets = rs.length > 0 ? rs : ["Unspecified"];
      const cBuckets = cs.length > 0 ? cs : ["Unspecified"];
      for (const r of rBuckets) {
        if (!(r in counts)) continue;
        for (const c of cBuckets) {
          if (!(c in counts[r])) continue;
          counts[r][c] += 1;
        }
      }
    }
    return { rowOpts, colOpts, counts };
  }, [rowDef, colDef, assets]);

  const tierForCount = (n: number): "zero" | "low" | "mid" | "high" => {
    if (n === 0) return "zero";
    if (n <= 2) return "low";
    if (n <= 5) return "mid";
    return "high";
  };

  if (axisCandidates.length < 2) {
    return (
      <div className="iv-empty">
        <div className="iv-empty-h">Not enough fields to map gaps</div>
        <p className="iv-empty-sub">
          Coverage analysis needs at least two single-choice or multi-choice fields. Add custom fields in <strong>Manage fields</strong> or wait for the default schema to seed.
        </p>
      </div>
    );
  }

  return (
    <div className="iv-gaps">
      <div className="iv-gaps-controls">
        <label className="iv-gaps-ctl">
          <span>Rows</span>
          <select value={rowKey} onChange={e => setRowKey(e.target.value)}>
            {axisCandidates.map(c => (
              <option key={c.id} value={c.key}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="iv-gaps-ctl">
          <span>Cols</span>
          <select value={colKey} onChange={e => setColKey(e.target.value)}>
            {axisCandidates.map(c => (
              <option key={c.id} value={c.key}>{c.label}</option>
            ))}
          </select>
        </label>
        <div className="iv-gaps-legend">
          <span className="iv-gaps-legend-h">Coverage</span>
          <span className="iv-gaps-swatch zero">0</span>
          <span className="iv-gaps-swatch low">1–2</span>
          <span className="iv-gaps-swatch mid">3–5</span>
          <span className="iv-gaps-swatch high">6+</span>
        </div>
      </div>

      {!matrix ? (
        <div className="iv-empty">Pick two dimensions to see coverage.</div>
      ) : (
        <div className="iv-gaps-table-wrap">
          <table className="iv-gaps-table">
            <thead>
              <tr>
                <th className="iv-gaps-corner"/>
                {matrix.colOpts.map(c => (
                  <th key={c} className="iv-gaps-col-h" title={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rowOpts.map(r => (
                <tr key={r}>
                  <th className="iv-gaps-row-h" title={r}>{r}</th>
                  {matrix.colOpts.map(c => {
                    const n = matrix.counts[r][c];
                    const tier = tierForCount(n);
                    return (
                      <td
                        key={c}
                        className={`iv-gaps-cell ${tier}`}
                        title={`${r} × ${c}: ${n} ${n === 1 ? "asset" : "assets"}`}
                      >{n}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="iv-gaps-note">
        Red cells are gaps — no published assets cover that combination. Archived and draft assets are excluded.
      </div>
    </div>
  );
}

const css = `
.iv{flex:1;min-width:0;overflow-y:auto;font-family:var(--font);color:var(--t1);padding:32px 40px 64px;display:flex;flex-direction:column;gap:32px;}

.iv-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;}
.iv-page-head h2{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.6px;color:var(--t1);margin:0;}
.iv-page-sub{font-size:13.5px;color:var(--t3);margin:6px 0 0;line-height:1.5;max-width:680px;}

.iv-section{display:flex;flex-direction:column;gap:20px;}
.iv-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
.iv-section-head h3{font-family:var(--serif);font-size:20px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}

/* Range picker — sits to the right of the section header. The
   custom mode swaps the dropdown for inline date inputs. */
.iv-range{display:inline-flex;align-items:center;gap:8px;font-family:var(--font);}
.iv-range-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.iv-range select{padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:12.5px;color:var(--t1);cursor:pointer;font-weight:500;}
.iv-range select:focus{outline:none;border-color:var(--accent);}
.iv-range-custom{flex-wrap:wrap;}
.iv-range-custom input[type=date]{padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:12.5px;color:var(--t1);}
.iv-range-custom input[type=date]:focus{outline:none;border-color:var(--accent);}
.iv-range-dash{color:var(--t4);font-weight:600;}
.iv-range-apply{padding:6px 12px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.iv-range-apply:hover{filter:brightness(1.08);}
.iv-range-cancel{padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:500;cursor:pointer;}
.iv-range-cancel:hover{background:var(--bg2);}

/* Metric tabs (YouTube-style cards). Inactive cards sit on a
   neutral background; the active card lifts to white + accent
   border with a colored top bar to make selection unmistakable. */
.iv-tabs{display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg);}
.iv-tab{background:var(--bg);border:none;border-right:1px solid var(--border);padding:18px 22px;display:flex;flex-direction:column;gap:4px;text-align:left;cursor:pointer;font-family:var(--font);color:var(--t1);position:relative;transition:background .12s;}
.iv-tab:last-child{border-right:none;}
.iv-tab:hover{background:#fff;}
.iv-tab.on{background:#fff;}
.iv-tab.on::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent);}
.iv-tab-value{font-family:var(--serif);font-size:34px;font-weight:600;letter-spacing:-.6px;color:var(--t1);line-height:1.1;font-variant-numeric:tabular-nums;}
.iv-tab-label{font-size:13px;font-weight:600;color:var(--t1);margin-top:4px;}
.iv-tab.on .iv-tab-label{color:var(--accent);}
.iv-tab-hint{font-size:11.5px;color:var(--t3);line-height:1.45;}

/* Detail panel below the tabs — wraps the active feed component. */
.iv-detail{display:flex;flex-direction:column;}

/* Subsection (Coverage gaps below the swappable detail) */
.iv-subsection{display:flex;flex-direction:column;gap:12px;margin-top:8px;}
.iv-subsection-head h4{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin:0;letter-spacing:-.2px;}
.iv-subsection-sub{font-size:12px;color:var(--t3);margin:3px 0 0;line-height:1.5;}

/* Feed container — used by all three detail panels for visual
   consistency (white card + bordered scroll region). */
.iv-feed{background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.iv-filterbar{display:flex;gap:6px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg);}
.iv-chip{padding:5px 11px;border:1px solid var(--border);border-radius:99px;background:#fff;color:var(--t2);font-family:var(--font);font-size:11.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.iv-chip:hover{border-color:var(--border2);color:var(--t1);}
.iv-chip.on{background:var(--accent);border-color:var(--accent);color:#fff;}

.iv-list{padding:10px 12px;display:flex;flex-direction:column;gap:6px;max-height:520px;overflow-y:auto;}
.iv-empty{padding:36px 20px;text-align:center;color:var(--t3);font-size:12.5px;}
.iv-empty-h{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.iv-empty-sub{font-size:12px;color:var(--t3);margin:0;line-height:1.5;}

/* Search row */
.iv-search-row{display:block;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font:inherit;color:inherit;cursor:pointer;transition:background .12s,border-color .12s;}
.iv-search-row:hover{background:var(--bg);border-color:var(--border2);}
.iv-search-q{font-size:13px;font-weight:600;color:var(--t1);line-height:1.4;word-break:break-word;}
.iv-search-meta{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}
.iv-source-pill{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.iv-source-pill.storymatch{background:#F2EBF9;color:var(--accent);}
.iv-source-pill.library{background:var(--bg2);color:var(--t3);}
.iv-search-user{font-size:11px;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;}
.iv-search-count{font-size:11px;color:var(--t3);font-weight:500;}
.iv-search-count.zero{color:#b91c1c;font-weight:700;}
.iv-search-when{font-size:11px;color:var(--t4);margin-left:auto;flex-shrink:0;}

/* Share row */
.iv-share-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;}
.iv-share-thumb{width:56px;height:36px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.iv-share-thumb-empty{background:var(--bg2);}
.iv-share-body{flex:1;min-width:0;}
.iv-share-headline{font-size:13px;font-weight:600;color:var(--t1);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.iv-share-sub{display:flex;gap:10px;margin-top:3px;font-size:11px;color:var(--t3);flex-wrap:wrap;}
.iv-share-author{font-weight:600;color:var(--t2);}
.iv-share-stats{display:flex;gap:14px;align-items:center;flex-shrink:0;}
.iv-share-stat{display:flex;flex-direction:column;align-items:flex-end;gap:1px;}
.iv-share-stat-v{font-size:14px;font-weight:700;color:var(--t1);font-variant-numeric:tabular-nums;}
.iv-share-stat-l{font-size:10px;color:var(--t4);text-transform:uppercase;letter-spacing:.4px;font-weight:600;}
.iv-share-completed{font-size:10px;font-weight:700;color:#065f46;background:#a7f3d0;padding:3px 7px;border-radius:99px;}
.iv-share-when{font-size:11px;color:var(--t4);flex-shrink:0;}

/* Feedback row */
.iv-fb-meta{font-size:11.5px;color:var(--t3);padding:4px 10px;font-style:italic;}
.iv-fb-row{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;}
.iv-fb-row.up{background:#f8fffb;}
.iv-fb-row.down{background:#fff8f8;}
.iv-fb-thumb{width:56px;height:36px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.iv-fb-thumb-empty{background:var(--bg2);}
.iv-fb-body{flex:1;min-width:0;}
.iv-fb-headline{font-size:13px;font-weight:600;color:var(--t1);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.iv-fb-meta-row{display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;}
.iv-fb-pill{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:13px;}
.iv-fb-pill.up{background:#dcfce7;}
.iv-fb-pill.down{background:#fee2e2;}
.iv-fb-user{font-size:11px;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;}
.iv-fb-when{font-size:11px;color:var(--t4);}
.iv-fb-text{font-size:12.5px;color:var(--t1);line-height:1.5;margin-top:6px;}

/* Gaps matrix */
.iv-gaps{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 20px 20px;display:flex;flex-direction:column;gap:12px;}
.iv-gaps-controls{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;}
.iv-gaps-ctl{display:flex;flex-direction:column;gap:4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;min-width:160px;}
.iv-gaps-ctl select{padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;font-family:var(--font);font-size:12.5px;color:var(--t1);text-transform:none;letter-spacing:0;font-weight:500;cursor:pointer;}
.iv-gaps-ctl select:focus{outline:none;border-color:var(--accent);}

.iv-gaps-legend{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--t3);font-weight:600;margin-left:auto;align-self:flex-end;}
.iv-gaps-legend-h{text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-right:4px;}
.iv-gaps-swatch{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:20px;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;}
.iv-gaps-swatch.zero{background:#fee2e2;color:#b91c1c;}
.iv-gaps-swatch.low{background:#fef3c7;color:#92400e;}
.iv-gaps-swatch.mid{background:#dcfce7;color:#15803d;}
.iv-gaps-swatch.high{background:#a7f3d0;color:#065f46;}

.iv-gaps-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:9px;background:#fff;}
.iv-gaps-table{border-collapse:separate;border-spacing:0;width:100%;font-family:var(--font);font-size:12px;color:var(--t1);}
.iv-gaps-corner{background:var(--bg2);border-bottom:1px solid var(--border);border-right:1px solid var(--border);position:sticky;left:0;top:0;z-index:2;min-width:120px;}
.iv-gaps-col-h{background:var(--bg2);color:var(--t2);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:8px 10px;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap;}
.iv-gaps-row-h{background:var(--bg);color:var(--t1);font-size:12px;font-weight:600;padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);border-right:1px solid var(--border);position:sticky;left:0;z-index:1;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;}
.iv-gaps-cell{padding:0;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;border-bottom:1px solid var(--border);height:42px;min-width:60px;cursor:default;}
.iv-gaps-cell.zero{background:#fee2e2;color:#b91c1c;}
.iv-gaps-cell.low{background:#fef3c7;color:#92400e;}
.iv-gaps-cell.mid{background:#dcfce7;color:#15803d;}
.iv-gaps-cell.high{background:#a7f3d0;color:#065f46;}

.iv-gaps-note{font-size:11px;color:var(--t3);line-height:1.5;font-style:italic;}

/* Content Analytics placeholder */
.iv-coming-soon{background:#fff;border:1px dashed var(--border2);border-radius:12px;padding:32px 28px;text-align:center;}
.iv-coming-soon-h{font-family:var(--serif);font-size:16px;font-weight:600;color:var(--t1);margin-bottom:6px;}
.iv-coming-soon p{font-size:13px;color:var(--t3);margin:0;line-height:1.6;max-width:560px;margin-left:auto;margin-right:auto;}

@media (max-width: 900px) {
  .iv{padding:20px 18px 48px;}
  .iv-tabs{grid-template-columns:1fr;}
  .iv-tab{border-right:none;border-bottom:1px solid var(--border);}
  .iv-tab:last-child{border-bottom:none;}
  .iv-page-head{flex-direction:column;align-items:flex-start;}
}
`;
