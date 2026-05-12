"use client";

import { useState, useMemo, useEffect } from "react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval, max, min } from "date-fns";
import Fuse, { type FuseOptionKey } from "fuse.js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Search,
  X,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  RefreshCw,
} from "lucide-react";

type Entry = {
  date: string;
  day: string;
  hours: number;
  shift_name: string;
  verified_skills: string;
  verified_skills_list: string[];
};

type Data = {
  scraped_at: string;
  summary: {
    total_sessions_approved: number;
    total_sessions_current_year?: number;
    total_hours_completed: number;
    total_hours_current_year: number;
    unique_skills: string[];
  };
  entries: Entry[];
};

const INITIAL_VISIBLE = 5;
const EXPAND_STEP = 5;

const fuseKeys: FuseOptionKey<Entry>[] = [
  { name: "shift_name", weight: 0.45 },
  { name: "date", weight: 0.22 },
  { name: "day", weight: 0.15 },
  { name: "verified_skills", weight: 0.15 },
  {
    name: "skills_list",
    getFn: (e: Entry) => e.verified_skills_list.join(" "),
    weight: 0.03,
  },
];

const chartAxisTick = { fontSize: 12, fill: "rgb(195,195,195)" };

const searchInputStyles = `
  ::-webkit-search-cancel-button,
  ::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
  }
`;

function freshnessMeta(scrapedAt: string): { dot: string; hint: string } {
  let parsed: Date;
  try {
    parsed = parseISO(scrapedAt);
  } catch {
    return {
      dot: "bg-[rgb(120,120,120)]",
      hint: "Could not parse update time",
    };
  }
  if (Number.isNaN(parsed.getTime())) {
    return {
      dot: "bg-[rgb(120,120,120)]",
      hint: "Could not parse update time",
    };
  }
  const ageMs = Date.now() - parsed.getTime();
  if (ageMs < 0) {
    return { dot: "bg-emerald-400", hint: "Updated within 24 hours" };
  }
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < day) {
    return { dot: "bg-emerald-400", hint: "Updated within 24 hours" };
  }
  if (ageMs < 7 * day) {
    return { dot: "bg-amber-400", hint: "Updated within the past week" };
  }
  return { dot: "bg-red-400", hint: "Older than one week" };
}

export default function DashboardClient({ data }: { data: Data }) {
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE);
  const [refreshState, setRefreshState] = useState<
    "idle" | "loading" | "ok" | "err"
  >("idle");

  const sessionsThisYear = useMemo(() => {
    if (typeof data.summary.total_sessions_current_year === "number") {
      return data.summary.total_sessions_current_year;
    }
    const y = new Date().getFullYear();
    return data.entries.filter((e) => {
      const yy = Number(e.date.slice(0, 4));
      return !Number.isNaN(yy) && yy === y;
    }).length;
  }, [data.entries, data.summary.total_sessions_current_year]);

  const fuse = useMemo(
    () =>
      new Fuse(data.entries, {
        keys: fuseKeys,
        /** ~0.35: typo-tolerant; lower = stricter */
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 1,
        shouldSort: true,
        isCaseSensitive: false,
      }),
    [data.entries]
  );

  const filteredEntries = useMemo(() => {
    const q = search.trim();
    if (!q) return data.entries;
    return fuse.search(q).map((r) => r.item);
  }, [data.entries, fuse, search]);

  const filteredTotalHours = useMemo(
    () => filteredEntries.reduce((s, e) => s + e.hours, 0),
    [filteredEntries]
  );

  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE);
  }, [search]);

  const totalFiltered = filteredEntries.length;
  const shown = Math.min(visibleLimit, totalFiltered);
  const visibleEntries = filteredEntries.slice(0, shown);
  const showExpandControls = totalFiltered > INITIAL_VISIBLE;

  const chartData = useMemo(() => {
    const validDates = data.entries
      .map((e) => parseISO(e.date))
      .filter((d) => !Number.isNaN(d.getTime()));

    const latestEntry = validDates.length > 0 ? max(validDates) : new Date();
    const endSource = min([latestEntry, new Date()]);
    const endMonth = startOfMonth(endSource);

    const startMonth = subMonths(endMonth, 11);
    const months = eachMonthOfInterval({
      start: startMonth,
      end: endMonth,
    });

    return months.map((monthStart) => {
      const monthEnd = endOfMonth(monthStart);
      let hours = 0;
      for (const e of data.entries) {
        const d = parseISO(e.date);
        if (Number.isNaN(d.getTime())) continue;
        if (d >= monthStart && d <= monthEnd) hours += e.hours;
      }
      return {
        month: format(monthStart, "LLL yy"),
        hours: Number(hours.toFixed(2)),
      };
    });
  }, [data.entries]);

  let scrapedDisplay = data.scraped_at;
  const { dot: dotClass, hint: freshnessHint } = freshnessMeta(data.scraped_at);
  try {
    const p = parseISO(data.scraped_at);
    if (!Number.isNaN(p.getTime())) {
      scrapedDisplay = format(p, "MMM d, yyyy · HH:mm");
    }
  } catch {
    /* keep raw */
  }

  async function handleRefresh() {
    setRefreshState("loading");
    try {
      const r = await fetch("/api/refresh-data", { method: "POST" });
      const body = (await r.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!r.ok) {
        throw new Error(body?.error ?? `Request failed (${r.status})`);
      }
      setRefreshState("ok");
      window.setTimeout(() => setRefreshState("idle"), 4000);
    } catch (e) {
      console.error(e);
      setRefreshState("err");
      window.setTimeout(() => setRefreshState("idle"), 5000);
    }
  }

  return (
    <div className="min-w-0 space-y-12">
      {/* ─── Stats ─── */}
      <section className="w-full">
        <div className="grid w-full grid-cols-1 gap-10 text-center sm:grid-cols-2 sm:gap-8">
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-medium uppercase tracking-widest text-[rgb(210,210,210)]">
              Hours this year
            </p>
            <p className="text-[clamp(2.75rem,10vw,5.5rem)] font-bold leading-none tracking-tight tabular-nums">
              {data.summary.total_hours_current_year}
            </p>
            <p className="text-base leading-snug text-[rgb(200,200,200)]">
              <span className="font-medium tabular-nums text-white">
                {data.summary.total_hours_completed}
              </span>{" "}
              h all time
            </p>
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-medium uppercase tracking-widest text-[rgb(210,210,210)]">
              Shifts this year
            </p>
            <p className="text-[clamp(2.75rem,10vw,5.5rem)] font-bold leading-none tracking-tight tabular-nums">
              {sessionsThisYear}
            </p>
            <p className="text-base leading-snug text-[rgb(200,200,200)]">
              <span className="font-medium tabular-nums text-white">
                {data.summary.total_sessions_approved}
              </span>{" "}
              shifts all time
            </p>
          </div>
        </div>
      </section>

      {/* ─── Shifts Table ─── */}
      <section>
        <style>{searchInputStyles}</style>
        <div className="group mb-3 flex items-center gap-3 border-b border-transparent pb-3 transition-[border-color] duration-300 ease-out hover:border-[rgb(60,60,60)] focus-within:border-[rgb(60,60,60)]">
          <Search
            className="h-4 w-4 shrink-0 text-[rgb(160,160,160)] transition-all duration-300 ease-out group-hover:text-white group-focus-within:text-white"
            aria-hidden
          />
          <div className="relative min-w-0 flex-1">
            <input
              type="search"
              spellCheck={false}
              placeholder="search shifts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-5 w-full border-none bg-transparent text-sm text-white caret-white outline-none ring-0 transition-all duration-300 ease-out placeholder:text-[rgb(100,100,100)] focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-[rgb(160,160,160)] transition-all duration-300 ease-out hover:text-white"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Summary (search / slice) — between search and table */}
        <div className="mb-3 min-h-[1.25rem] text-sm text-[rgb(120,120,120)]">
          {search ? (
            filteredEntries.length > 0 ? (
              <>
                {filteredEntries.length} result
                {filteredEntries.length !== 1 ? "s" : ""} ·{" "}
                <span className="font-medium text-white tabular-nums">
                  {filteredTotalHours.toFixed(2)} hours
                </span>
              </>
            ) : (
              <span>No matches.</span>
            )
          ) : totalFiltered > 0 ? (
            <>
              Showing {shown} of {totalFiltered} shifts
              {shown < totalFiltered ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="tabular-nums text-white">
                    {filteredEntries
                      .slice(0, shown)
                      .reduce((s, e) => s + e.hours, 0)
                      .toFixed(2)}{" "}
                    h
                  </span>{" "}
                  in view
                </>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-[1fr_110px_90px_60px] border-b border-[rgb(40,40,40)] py-3 text-xs uppercase tracking-widest text-[rgb(100,100,100)]">
          <span>Shift</span>
          <span>Date</span>
          <span>Day</span>
          <span className="text-right">Hours</span>
        </div>

        <div>
          {visibleEntries.length === 0 ? (
            <p className="py-6 text-sm text-[rgb(100,100,100)]">
              No matching shifts.
            </p>
          ) : (
            visibleEntries.map((entry, i) => (
              <div
                key={`${entry.date}-${entry.shift_name}-${i}`}
                className="grid grid-cols-[1fr_110px_90px_60px] border-b border-[rgb(30,30,30)] py-3 text-sm text-[rgb(160,160,160)] transition-colors duration-200 hover:text-white"
                style={{
                  animation: `fadeIn 0.3s ease-out ${i * 40}ms both`,
                }}
              >
                <span className="truncate pr-4 font-medium">
                  {entry.shift_name}
                </span>
                <span className="tabular-nums">{entry.date}</span>
                <span>{entry.day}</span>
                <span className="text-right font-medium tabular-nums">
                  {entry.hours}
                </span>
              </div>
            ))
          )}
        </div>

        {showExpandControls ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setVisibleLimit((n) =>
                    Math.max(INITIAL_VISIBLE, n - EXPAND_STEP)
                  )
                }
                disabled={shown <= INITIAL_VISIBLE}
                className="flex items-center gap-1 text-sm text-[rgb(120,120,120)] transition-colors duration-200 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                title={`Show ${Math.min(EXPAND_STEP, shown - INITIAL_VISIBLE)} fewer`}
                aria-label="Show five fewer shifts"
              >
                <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
                <span className="sr-only sm:not-sr-only">-5</span>
              </button>
              <span
                className="h-4 w-px shrink-0 bg-[rgb(55,55,55)]"
                aria-hidden
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleLimit((n) =>
                    Math.min(n + EXPAND_STEP, totalFiltered)
                  )
                }
                disabled={shown >= totalFiltered}
                className="flex items-center gap-1 text-sm text-[rgb(120,120,120)] transition-colors duration-200 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                title={`Show ${Math.min(EXPAND_STEP, totalFiltered - shown)} more`}
                aria-label="Show five more shifts"
              >
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                <span className="sr-only sm:not-sr-only">+5</span>
              </button>
            </div>
            <span className="text-xs text-[rgb(80,80,80)]">
              {shown} / {totalFiltered}
            </span>
            <button
              type="button"
              onClick={() => {
                if (shown >= totalFiltered) {
                  setVisibleLimit(INITIAL_VISIBLE);
                } else {
                  setVisibleLimit(totalFiltered);
                }
              }}
              className="flex items-center gap-1.5 text-sm text-[rgb(120,120,120)] transition-colors duration-200 hover:text-white"
              title={
                shown >= totalFiltered
                  ? "Show first shifts only"
                  : "Show all shifts"
              }
              aria-label={
                shown >= totalFiltered ? "Collapse list" : "Expand to all shifts"
              }
            >
              {shown >= totalFiltered ? (
                <ChevronsUp className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <ChevronsDown className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>
                {shown >= totalFiltered ? "Collapse" : "Expand"}
              </span>
            </button>
          </div>
        ) : null}
      </section>

      {/* ─── Monthly line chart (up to 12 mo, ends at latest data month) ─── */}
      <section>
        <h2 className="mb-5 text-base font-semibold uppercase tracking-widest text-[rgb(230,230,230)]">
          Monthly Hours
        </h2>
        <div
          className="h-[232px] w-full min-w-0 min-h-[232px] shrink-0 select-none outline-none [-webkit-tap-highlight-color:transparent] [&_.recharts-wrapper]:outline-none [&_svg]:outline-none"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={220}
            debounce={32}
          >
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 12, left: 4, bottom: 22 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="rgba(255,255,255,0.09)"
              />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                interval="preserveEnd"
                minTickGap={10}
                fontSize={12}
                tickMargin={8}
                tick={{
                  ...chartAxisTick,
                  fontFamily:
                    "var(--font-geist-mono), ui-monospace, monospace",
                }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{
                  ...chartAxisTick,
                  fontFamily:
                    "var(--font-geist-mono), ui-monospace, monospace",
                }}
                domain={[0, "auto"]}
              />
              <Tooltip
                cursor={false}
                contentStyle={{
                  backgroundColor: "rgb(24,24,24)",
                  border: "1px solid rgb(60,60,60)",
                  borderRadius: "6px",
                  color: "white",
                  fontSize: "13px",
                  fontFamily:
                    "var(--font-geist-mono), ui-monospace, monospace",
                }}
                itemStyle={{ color: "white" }}
                labelStyle={{ color: "rgb(200,200,200)", marginBottom: "4px" }}
              />
              <Line
                type="monotone"
                dataKey="hours"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={2}
                dot={{
                  fill: "rgba(255,255,255,0.75)",
                  r: 3,
                }}
                activeDot={{ r: 5, fill: "rgba(255,255,255,0.95)" }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <div className="flex flex-col gap-3 pb-8 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="flex items-center gap-2.5 text-base tracking-tight text-[rgb(190,190,190)]">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`}
            title={freshnessHint}
            aria-hidden
          />
          <span className="tabular-nums">
            Last updated{" "}
            <span className="text-white">{scrapedDisplay}</span>
          </span>
        </p>
        <div className="flex items-center gap-3">
          {refreshState === "ok" ? (
            <span className="text-xs text-emerald-400">Workflow started.</span>
          ) : null}
          {refreshState === "err" ? (
            <span className="text-xs text-red-400">
              Refresh failed. Check server config.
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshState === "loading"}
            className="group inline-flex items-center gap-2 border-0 border-b border-transparent bg-transparent px-0 pb-0.5 outline-none transition-[border-color] duration-300 ease-out hover:border-[rgb(60,60,60)] disabled:pointer-events-none disabled:opacity-40"
          >
            <RefreshCw
              className={`h-4 w-4 shrink-0 text-[rgb(160,160,160)] transition-all duration-300 ease-out group-hover:text-white ${refreshState === "loading" ? "animate-spin" : ""}`}
              aria-hidden
            />
            <span className="text-sm text-[rgb(160,160,160)] transition-colors duration-300 ease-out group-hover:text-white">
              Refresh data
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
