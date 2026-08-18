"""
Timecounts Volunteer Hours Scraper (API version)
==================================================
Hits Timecounts' OAuth token endpoint directly (password grant) and pulls
hours from the user_dashboard/track_time API. No browser automation.

Outputs:
  - data/volunteer_hours.json   (structured, dashboard-ready)
  - data/volunteer_hours.csv    (flat, human-readable)

Usage:
  Local:   python scraper.py
  CI/CD:   Set TIMECOUNTS_EMAIL and TIMECOUNTS_PASSWORD as env vars / secrets.
           Optionally override TIMECOUNTS_CLIENT_ID / TIMECOUNTS_CLIENT_SECRET
           (defaults below are the public values Timecounts' own web app uses).
"""

import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from curl_cffi import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

EMAIL = os.getenv("TIMECOUNTS_EMAIL")
PASSWORD = os.getenv("TIMECOUNTS_PASSWORD")

# Public client credentials embedded in Timecounts' own frontend bundle.
# Same for every user/session — not a per-account secret. Overridable via env
# in case they ever rotate.
CLIENT_ID = os.getenv("TIMECOUNTS_CLIENT_ID", "t31W3iIs7eZmRNuxXMEO0dwxIL2qGejPhlE_eoG-phY")
CLIENT_SECRET = os.getenv("TIMECOUNTS_CLIENT_SECRET", "")

API_BASE = "https://api.timecounts.app/api/v2"
TOKEN_URL = f"{API_BASE}/oauth/token"
# Path segment is ignored server-side (auth comes from bearer token), so any
# placeholder works here.
TRACK_TIME_URL = f"{API_BASE}/users/me/user_dashboard/track_time"
ORG_SLUG = os.getenv("TIMECOUNTS_ORG_SLUG", "unilife")
CURRENT_PERSON_URL = f"{API_BASE}/organizations/{ORG_SLUG}/volunteers/get_current_person"

DATA_DIR = Path(__file__).parent.parent / "data"

WEEKDAY_ABBR_EN = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def get_access_token() -> str:
    """Password-grant login. Returns access_token."""
    print("[1/3] Authenticating...")
    resp = requests.post(
        TOKEN_URL,
        json={
            "grant_type": "password",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "email": EMAIL,
            "password": PASSWORD,
        },
        impersonate="chrome",
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"      Auth failed: {resp.status_code} {resp.text}")
        resp.raise_for_status()

    data = resp.json()
    print(f"      Authenticated. Token expires in {data.get('expires_in')}s.")
    return data["access_token"]


def fetch_participations(access_token: str) -> list:
    """Pull raw participation records from the track_time endpoint."""
    print("[2/3] Fetching hours...")
    resp = requests.get(
        TRACK_TIME_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        impersonate="chrome",
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"      Fetch failed: {resp.status_code} {resp.text}")
        resp.raise_for_status()

    participations = resp.json().get("participations", [])
    print(f"      Found {len(participations)} participation records.")
    return participations


def fetch_verified_skills(access_token: str) -> list:
    """
    Pull the org-scoped verified skills list (get_current_person). This is
    account-level, not per-shift, so track_time has no skills field of its
    own to merge in.
    """
    print("      Fetching verified skills...")
    resp = requests.get(
        CURRENT_PERSON_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        impersonate="chrome",
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"      Skills fetch failed: {resp.status_code} {resp.text}")
        return []

    skills = resp.json().get("skills", [])
    names = sorted(s.get("name", "") for s in skills if s.get("name"))
    print(f"      Found {len(names)} verified skills.")
    return names


def enrich_entries(participations: list) -> list:
    """Map raw API records into the same shape the dashboard expects."""
    print("[3/3] Processing entries...")
    cleaned = []
    for p in participations:
        new_entry = {}
        new_entry["hours"] = float(p.get("hours_credited") or 0.0)

        date_str = p.get("date")
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            new_entry["date"] = dt.strftime("%Y-%m-%d")
            new_entry["day"] = WEEKDAY_ABBR_EN[dt.weekday()]
        except (ValueError, TypeError):
            new_entry["date"] = date_str
            new_entry["day"] = ""

        new_entry["shift_name"] = p.get("activity_name") or ""

        # No skills field in this API response (that lived in the org-scoped
        # get_current_person call, not track_time). Leave empty for schema
        # compatibility with existing JSON/CSV/Supabase consumers.
        new_entry["verified_skills"] = ""
        new_entry["verified_skills_list"] = []

        cleaned.append(new_entry)

    return cleaned


def save_json(entries: list, verified_skills: list):
    """Write structured JSON output."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    current_year = datetime.now(ZoneInfo("Australia/Sydney")).year

    total_hours = 0.0
    total_hours_current_year = 0.0
    total_sessions_current_year = 0

    for e in entries:
        hours = e.get("hours", 0.0)
        total_hours += hours

        date_str = e.get("date")
        if date_str:
            try:
                year = int(date_str.split("-")[0])
                if year == current_year:
                    total_hours_current_year += hours
                    total_sessions_current_year += 1
            except (ValueError, TypeError, IndexError):
                pass

    data = {
        "scraped_at": datetime.now(ZoneInfo("Australia/Sydney")).isoformat(),
        "summary": {
            "total_sessions_approved": len(entries),
            "total_sessions_current_year": total_sessions_current_year,
            "total_hours_completed": total_hours,
            "total_hours_current_year": total_hours_current_year,
            "unique_skills": verified_skills,
        },
        "entries": entries,
    }

    json_path = DATA_DIR / "volunteer_hours.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"      JSON saved -> {json_path}")


def save_csv(entries: list):
    """Write flat CSV output for Excel/Google Sheets."""
    if not entries:
        return

    csv_path = DATA_DIR / "volunteer_hours.csv"
    keys = ["date", "day", "hours", "shift_name", "verified_skills"]

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(entries)
    print(f"      CSV  saved -> {csv_path}")


def export_to_supabase(entries: list):
    """Export the scraped data to Supabase using a direct PostgreSQL connection."""
    database_url = os.environ.get("DATABASE_URL")

    if not database_url:
        print("      Skipping database export: DATABASE_URL not set.")
        return

    try:
        import psycopg2
        from psycopg2.extras import execute_values

        print("      Syncing with Supabase table 'timecounts'...")

        conn = psycopg2.connect(database_url)
        cur = conn.cursor()

        # Wipe and re-insert since there's no stable PK from the API to
        # dedupe against across runs.
        cur.execute("TRUNCATE TABLE public.timecounts;")

        insert_query = """
            INSERT INTO public.timecounts (date, day, hours, shift_name, verified_skills)
            VALUES %s
        """

        values = [
            (
                e.get("date"),
                e.get("day"),
                e.get("hours"),
                e.get("shift_name"),
                e.get("verified_skills"),
            )
            for e in entries
        ]

        if values:
            execute_values(cur, insert_query, values)

        conn.commit()
        cur.close()
        conn.close()

        print(f"      Supabase sync complete! Uploaded {len(values)} records.")
    except Exception as e:
        print(f"      ERROR exporting to database: {e}")


def export_data(entries: list, verified_skills: list):
    """Export the scraped data to file formats."""
    save_json(entries, verified_skills)
    save_csv(entries)
    export_to_supabase(entries)


def main():
    if not EMAIL or not PASSWORD:
        print("ERROR: TIMECOUNTS_EMAIL and TIMECOUNTS_PASSWORD must be set.")
        sys.exit(1)
    if not CLIENT_SECRET:
        print("ERROR: TIMECOUNTS_CLIENT_SECRET must be set.")
        sys.exit(1)

    print("Starting Timecounts Scraper (API mode)...")

    try:
        access_token = get_access_token()
        participations = fetch_participations(access_token)

        if not participations:
            print("WARNING: No participation records returned.")
            sys.exit(1)

        entries = enrich_entries(participations)
        verified_skills = fetch_verified_skills(access_token)
        export_data(entries, verified_skills)

        print(f"\nDone! Scraped {len(entries)} sessions.")

    except requests.exceptions.RequestException as e:
        print(f"REQUEST ERROR: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        raise


if __name__ == "__main__":
    main()
