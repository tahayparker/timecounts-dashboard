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
import { titleCase } from "title-case";

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
              placeholder="search shifts"
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
              showing {shown} of {totalFiltered} shifts
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

        <div className="grid grid-cols-[1fr_120px_30px_60px] border-b border-[rgb(40,40,40)] py-3 text-xs uppercase tracking-widest text-[rgb(100,100,100)]">
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
            visibleEntries.map((entry, i) => {
              // Check if the shift name starts with "Pulse " (case-insensitive)
              const isPulseShift = entry.shift_name.toLowerCase().startsWith("pulse ");
              // If it is, slice off the first 6 characters ("Pulse ") to leave just the location
              const displayName = isPulseShift ? entry.shift_name.substring(6) : entry.shift_name;

              return (
                <div
                  key={`${entry.date}-${entry.shift_name}-${i}`}
                  className="grid grid-cols-[1fr_120px_40px_50px] border-b border-[rgb(30,30,30)] py-3 text-sm text-[rgb(160,160,160)] transition-colors duration-200 hover:text-white"
                  style={{
                    animation: `fadeIn 0.3s ease-out ${i * 40}ms both`,
                  }}
                >
                  {/* Shift name column — shows Pulse logo inline when applicable */}
                  <div className="flex items-center gap-2 overflow-hidden pr-4">
                    {isPulseShift && (
                      <svg
                        viewBox="0 0 250 250"
                        className="h-[1.2em] w-auto shrink-0"
                        aria-hidden="true"
                      >
                        {/* Red paths */}
                        <path fill="#E00601" d="M160.947266,47.780823 C177.638016,51.440777 187.705338,63.664246 188.813354,79.285416 C189.985214,95.806374 190.077820,112.438576 189.850861,129.011353 C189.709106,139.363876 186.861008,149.623138 179.176086,156.877335 C174.450302,161.338257 167.618256,163.567871 160.966385,166.822250 C155.490738,167.291473 150.779190,167.723083 146.071136,168.189880 C143.360123,168.458679 140.654755,168.784393 137.496948,169.047073 C134.817093,169.009659 132.587097,169.009659 130.167801,169.009659 C130.167801,174.630493 130.167801,179.815475 130.044083,185.353287 C124.064880,189.875702 117.633781,189.057861 111.362968,187.347855 C109.279167,186.779633 107.662460,184.498489 105.907127,182.536743 C105.982048,143.779404 105.982048,105.485779 105.982048,67.072266 C103.699593,67.072266 101.882401,67.072266 99.685669,66.867142 C97.521095,66.539749 95.736076,66.417465 93.750069,66.281410 C93.750069,59.404327 93.750069,52.848431 93.750069,46.178242 C96.032967,46.051826 98.016243,45.942005 99.999512,45.832184 C112.357597,45.882149 124.715691,45.932117 137.998474,45.979588 C146.264542,46.578335 153.605911,47.179581 160.947266,47.780823 M137.078094,67.013969 C134.815536,67.013969 132.552979,67.013969 130.295013,67.013969 C130.295013,94.286743 130.295013,121.057289 130.295013,147.832535 C133.059296,147.832535 135.529724,147.832535 138.900757,147.977173 C143.308533,147.626831 147.903351,147.923569 152.064697,146.720688 C155.373322,145.764313 158.152084,142.974792 161.805710,140.673965 C163.203430,135.798065 165.577057,130.967697 165.807114,126.037323 C166.386414,113.622314 166.448685,101.137878 165.777954,88.732101 C165.508759,83.753136 162.777023,78.907310 160.992325,73.298340 C159.763794,72.049194 158.747070,70.395905 157.269684,69.621582 C151.192520,66.436424 144.679306,65.878189 137.078094,67.013969z" />
                        <path fill="#E00601" d="M106.115311,208.875275 C113.982819,208.478638 121.775970,208.499405 129.831512,208.782913 C130.093887,211.188782 130.093887,213.331924 130.093887,215.884277 C133.628357,215.884277 137.049194,215.884277 140.733002,215.884277 C140.733002,223.022232 140.733002,229.753784 140.733002,236.744614 C124.949295,236.744614 109.225853,236.744614 93.250031,236.744614 C93.250031,229.933212 93.250031,223.203873 93.250031,216.050140 C97.432838,216.050140 101.522919,216.050140 106.040962,216.050140 C106.040962,213.520966 106.040962,211.406815 106.115311,208.875275z" />
                        {/* Blue paths */}
                        <path fill="#0033CC" d="M105.832207,183.000458 C107.662460,184.498489 109.279167,186.779633 111.362968,187.347855 C117.633781,189.057861 124.064880,189.875702 130.396347,185.346771 C136.169861,180.994034 138.383530,175.628784 137.946838,169.084488 C140.654755,168.784393 143.360123,168.458679 146.071136,168.189880 C150.779190,167.723083 155.490738,167.291473 160.620178,166.973511 C160.376862,178.194244 158.862762,188.938736 151.079788,197.802170 C145.609116,204.032288 138.432114,206.722168 130.181030,208.627045 C121.775970,208.499405 113.982819,208.478638 106.189667,208.457855 C88.127365,205.564163 77.481743,191.603653 77.176376,175.490036 C76.332535,130.962860 76.332588,86.419678 76.001434,41.882812 C75.988083,40.086571 75.999741,38.290138 75.999741,36.052132 C72.916496,36.052132 70.182312,36.052132 67.228516,36.052132 C67.228516,28.878082 67.228516,22.150305 67.228516,15.210981 C81.374763,15.210981 95.309967,15.210981 109.623108,15.210981 C109.623108,21.820551 109.623108,28.548908 109.623108,35.738937 C106.799690,35.738937 103.732918,35.738937 100.000206,35.738937 C100.000206,39.088531 100.000206,42.011776 99.999863,45.383602 C98.016243,45.942005 96.032967,46.051826 93.750069,46.178242 C93.750069,52.848431 93.750069,59.404327 93.750069,66.281410 C95.736076,66.417465 97.521095,66.539749 99.656876,67.330124 C100.005173,100.549034 99.820023,133.101776 100.164406,165.648895 C100.228317,171.690247 99.980446,178.530731 105.832207,183.000458z" />
                        <path fill="#0033CC" d="M160.964935,47.331764 C153.605911,47.179581 146.264542,46.578335 138.461823,45.904640 C138.000473,42.709602 138.000473,39.587021 138.000473,36.029152 C134.902802,36.029152 132.160568,36.029152 129.220535,36.029152 C129.220535,28.988260 129.220535,22.380587 129.220535,15.385566 C142.799561,15.385566 156.512894,15.385566 170.614044,15.385566 C170.614044,21.800711 170.614044,28.525429 170.614044,35.705246 C167.827805,35.705246 164.761841,35.705246 160.982620,35.705246 C160.982620,39.719482 160.982620,43.301094 160.964935,47.331764z" />
                        <path fill="#0133CC" d="M161.166092,140.999115 C158.152084,142.974792 155.373322,145.764313 152.064697,146.720688 C147.903351,147.923569 143.308533,147.626831 138.450134,147.447235 C137.992554,120.320274 137.985611,93.723236 137.978653,67.126198 C144.679306,65.878189 151.192520,66.436424 157.269684,69.621582 C158.747070,70.395905 159.763794,72.049194 161.005859,74.113403 C161.068283,96.952019 161.117188,118.975563 161.166092,140.999115z" />
                      </svg>
                    )}
                    <span className="truncate font-medium">
                      {titleCase(displayName.toLowerCase())}
                    </span>
                  </div>

                  <span className="tabular-nums">{entry.date}</span>
                  <span>{entry.day}</span>
                  <span className="text-right font-medium tabular-nums">
                    {entry.hours}
                  </span>
                </div>
              );
            })
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
            last updated{" "}
            <span className="text-white">{scrapedDisplay.toLowerCase()}</span>
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
              refresh data
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
