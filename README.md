# timecounts dashboard

A small [Next.js](https://nextjs.org/) dashboard for volunteer hours exported from **Timecounts**. The UI reads committed JSON under `data/`, supports fuzzy search and filters, and can trigger a GitHub Actions scrape via `POST /api/refresh-data`.

## Stack

- **Next.js 16** (App Router), React 19, TypeScript
- **Tailwind CSS 4** and shadcn-style UI primitives
- **Fuse.js** for search, **Recharts** for a monthly hours chart
- **Python 3.12** + **Playwright** for the scraper (`script/scraper.py`)

## Prerequisites

- Node.js 20+ (matches typical Next.js tooling)
- Python 3.12+ if you run the scraper locally
- A Timecounts account for login (see scraper env vars)

## Run the app locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The home page loads `data/volunteer_hours.json` at build/render time. If that file is missing, you’ll see a short message to run the scraper first.

Other scripts:

```bash
npm run build   # production build
npm run start   # run production server (after build)
npm run lint    # ESLint
```

## Data and scraper

CSV and JSON exports are written to `data/` (e.g. `volunteer_hours.json`). The dashboard expects the JSON shape produced by `script/scraper.py`.

### Local scraper run

1. Copy `.env.example` to `.env` in the repo root (or export variables in your shell).
2. Install Python deps and Chromium for Playwright:

   ```bash
   pip install -r script/requirements.txt
   playwright install chromium
   ```

3. Run:

   ```bash
   python script/scraper.py
   ```

**Required environment variables**

| Variable | Purpose |
|----------|---------|
| `TIMECOUNTS_EMAIL` | Timecounts login email |
| `TIMECOUNTS_PASSWORD` | Timecounts login password |

**Optional**

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | If set, the scraper can also export to your database (see `script/scraper.py`); otherwise that step is skipped. |

Do not commit `.env`. Use `.env.example` as a template for local use only.

## GitHub Actions

Workflow: [`.github/workflows/scrape.yml`](.github/workflows/scrape.yml).

- Runs on a **daily schedule** (cron in UTC) and via **workflow_dispatch** (manual run).
- Needs repository **secrets** (at minimum `TIMECOUNTS_EMAIL`, `TIMECOUNTS_PASSWORD`; optionally `DATABASE_URL` if you use DB export).
- After a successful run, the job **commits and pushes** updates under `data/` so the site can serve fresh JSON on the next deploy.

Ensure the workflow’s `git config` user matches an account allowed to push to the default branch, or adjust the step to your org’s bot/commit policy.

## “Refresh data” in the dashboard

The UI can call **`POST /api/refresh-data`**, which dispatches the scrape workflow through the [GitHub REST API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

Configure these on the **server** (e.g. Vercel project settings), not in public client env:

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Fine-grained or classic PAT with `actions:write` (or sufficient scope to trigger workflows) on the repo |
| `GITHUB_REPO` | `owner/name` (e.g. `you/timecounts-dashboard`) |
| `GITHUB_WORKFLOW_REF` | (optional) Branch or tag to dispatch; defaults to `main` (set to your default branch, e.g. `master`, if different) |
| `GITHUB_WORKFLOW_FILE` | (optional) Workflow filename; defaults to `scrape.yml` |

If `GITHUB_TOKEN` or `GITHUB_REPO` is missing, the route responds with **503** and a JSON error.

## Project layout (high level)

| Path | Role |
|------|------|
| `src/app/page.tsx` | Loads `data/volunteer_hours.json`, renders the dashboard shell |
| `src/components/dashboard-client.tsx` | Search, filters, table, chart, refresh control |
| `src/app/api/refresh-data/route.ts` | GitHub workflow dispatch |
| `script/scraper.py` | Playwright-based export to `data/` (and optional DB) |
| `data/` | Committed exports consumed by the app |

## Deploy

You can deploy like any Next.js app (e.g. [Vercel](https://vercel.com/docs)). Ensure production **environment variables** include the GitHub pair above if you rely on in-app refresh; scrape credentials stay in **GitHub Actions secrets**, not in the frontend env.