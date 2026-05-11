"""
Timecounts Volunteer Hours Scraper
===================================
Logs into timecounts.app, navigates to /track-time, and extracts all
volunteering records (hours, date, shift name, verified skills, status).

Outputs:
  - data/volunteer_hours.json   (structured, dashboard-ready)
  - data/volunteer_hours.csv    (flat, human-readable)

Usage:
  Local:   python scraper.py
  CI/CD:   Set TIMECOUNTS_EMAIL and TIMECOUNTS_PASSWORD as env vars / secrets.
"""

import csv
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

EMAIL = os.getenv("TIMECOUNTS_EMAIL")
PASSWORD = os.getenv("TIMECOUNTS_PASSWORD")
BASE_URL = "https://timecounts.app"
LOGIN_URL = f"{BASE_URL}/login"
TRACK_TIME_URL = f"{BASE_URL}/track-time"

DATA_DIR = Path(__file__).parent.parent / "data"
JSON_OUT = DATA_DIR / "volunteer_hours.json"
CSV_OUT = DATA_DIR / "volunteer_hours.csv"

# English three-letter weekdays (datetime.weekday(): Mon=0 … Sun=6)
WEEKDAY_ABBR_EN = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def login(page):
    """Navigate to the login page and authenticate."""
    print("[1/3] Logging in...")

    # Navigate and wait for DOM content loaded (the SPA's 'load' event never fires cleanly)
    response = page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
    print(f"      Response status: {response.status if response else 'None'}")
    page.wait_for_timeout(5000)  # generous wait for React SPA to hydrate

    # Debug: check what the page has
    has_email = page.evaluate("() => !!document.querySelector('#email')")
    has_inputs = page.evaluate("() => document.querySelectorAll('input').length")
    print(f"      Has #email: {has_email}, Total inputs: {has_inputs}")

    if not has_email:
        # Try waiting a bit more
        page.wait_for_timeout(5000)
        has_email = page.evaluate("() => !!document.querySelector('#email')")
        print(f"      After extra wait — Has #email: {has_email}")

    # Try filling with force=True to bypass visibility checks overlaying the input
    page.locator("#email").fill(EMAIL, force=True)
    page.locator("#password").fill(PASSWORD, force=True)
    
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Sign in", exact=True).click(force=True)

    # Wait for redirect away from /login
    try:
        page.wait_for_url(lambda url: "/login" not in url, timeout=15_000, wait_until="commit")
        page.wait_for_timeout(2000)
        print(f"      Logged in — redirected to {page.url}")
    except PlaywrightTimeout:
        print("      Login redirect timed out. Taking debug screenshot...")
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(DATA_DIR / "debug_failed_login.png"))
        raise


def navigate_to_track_time(page):
    """Go to the track-time page and ensure the time entries load."""
    print("[2/3] Navigating to /track-time...")
    
    # Wait for the Track Time page to load
    page.goto(TRACK_TIME_URL, wait_until="domcontentloaded", timeout=30_000)
    
    # Wait for the entries inside the tabpanel to load
    try:
        page.wait_for_selector('[role="tabpanel"] h6', timeout=20000)
        page.wait_for_timeout(2000)  # Extra stabilization time
    except Exception as e:
        print(f"      Warning: timeout waiting for entries: {e}")

    print("      Track-time page loaded.")

    # Click "My Time" tab if it exists (ensures the time log view is active)
    my_time_tab = page.get_by_role("tab", name="My Time")
    if my_time_tab.is_visible():
        my_time_tab.click()
        page.wait_for_timeout(1000)


def scrape_entries(page):
    """
    Parse all volunteering entries from the current page DOM.
    Extracts shift_name and verified_skills for entries with 'Approved' status.
    """
    print("[3/3] Scraping entries...")

    entries = page.evaluate("""() => {
        const results = [];
        const seen = new Set();
        // Find all headings that denote hours (e.g., "2.5 Hours", "0.5 Hour")
        const hoursHeadings = Array.from(document.querySelectorAll('h6'))
            .filter(h => /Hours?/i.test(h.textContent || ''));

        for (const h of hoursHeadings) {
            try {
                // Find the main container for this entry (e79)
                let entryWrapper = h.parentElement;
                for (let i = 0; i < 5; i++) {
                    if (entryWrapper && entryWrapper.parentElement && /Approved|Pending|Rejected|Declined/i.test(entryWrapper.textContent)) {
                        entryWrapper = entryWrapper.parentElement;
                        break;
                    }
                    if (entryWrapper) entryWrapper = entryWrapper.parentElement;
                }
                
                // Use innerText to get a clean array of text lines
                const textLines = (entryWrapper.innerText || '').split('\\n').map(l => l.trim()).filter(l => l);
                
                let hours = '';
                let date = '';
                let shiftName = '';
                let organisation = '';
                let status = '';
                let verifiedSkills = '';
                
                const statusIndex = textLines.findIndex(l => /(Approved|Pending|Rejected|Declined)/i.test(l));
                if (statusIndex !== -1) {
                    const match = textLines[statusIndex].match(/(Approved|Pending|Rejected|Declined)/i);
                    status = match ? match[1] : '';
                    if (/Hours?/i.test(textLines[0])) {
                        hours = textLines[0];
                        date = textLines[1] || '';
                        shiftName = textLines[2] || '';
                        organisation = textLines[3] || '';
                    }
                }
                
                const skillsLine = textLines.find(l => /^Verified Skills:/i.test(l));
                if (skillsLine) {
                    verifiedSkills = skillsLine.replace(/^Verified Skills:\\s*/i, '').trim();
                }

                // Only keep Approved entries
                if (status.toLowerCase() === 'approved') {
                    if (shiftName) {
                        // Deduplicate based on the entire text content so we retain all 36 distinct sessions
                        const key = textLines.join('|');
                        if (!seen.has(key)) {
                            seen.add(key);
                            results.push({
                                hours: hours,
                                date: date,
                                shift_name: shiftName,
                                organisation: organisation,
                                verified_skills: verifiedSkills,
                                status: status
                            });
                        }
                    }
                }
            } catch (e) {
                console.error("Error parsing an entry:", e);
            }
        }
        return results;
    }""")

    print(f"      Found {len(entries)} approved entries.")
    return entries


def parse_hours_float(hours_text: str) -> float:
    """Extract numeric hours from text like '2.5 Hours' or '0.5 Hour'."""
    match = re.search(r"([\d.]+)", hours_text)
    return float(match.group(1)) if match else 0.0


def enrich_entries(entries: list) -> list:
    """Add parsed/computed fields useful for a dashboard."""
    cleaned = []
    for entry in entries:
        new_entry = {}
        # Numeric hours
        new_entry["hours"] = parse_hours_float(entry.get("hours", ""))

        # Parse date into ISO format for easier dashboard consumption
        try:
            # Example: "Fri, May 01, 2026"
            dt = datetime.strptime(entry["date"], "%a, %b %d, %Y")
            new_entry["date"] = dt.strftime("%Y-%m-%d")
            # Three-letter English weekday (Mon … Sun), matches datetime.weekday() order
            new_entry["day"] = WEEKDAY_ABBR_EN[dt.weekday()]
        except (ValueError, KeyError):
            new_entry["date"] = None
            new_entry["day"] = ""

        new_entry["shift_name"] = entry.get("shift_name", "")
        new_entry["verified_skills"] = entry.get("verified_skills", "")

        # Split skills into a list for JSON output, but we will ignore it in Supabase/CSV
        if new_entry["verified_skills"]:
            new_entry["verified_skills_list"] = [
                s.strip() for s in new_entry["verified_skills"].split(",")
            ]
        else:
            new_entry["verified_skills_list"] = []
            
        cleaned.append(new_entry)

    return cleaned


def save_json(entries: list):
    """Write structured JSON output."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    from zoneinfo import ZoneInfo
    current_year = datetime.now(ZoneInfo("Australia/Sydney")).year
    
    # Unique skills
    all_skills = set()
    total_hours = 0.0
    total_hours_current_year = 0.0
    total_sessions_current_year = 0
    
    for e in entries:
        all_skills.update(e.get("verified_skills_list", []))
        
        hours = e.get("hours", 0.0)
        total_hours += hours
        
        # Parse year from "YYYY-MM-DD"
        date_str = e.get("date")
        if date_str:
            try:
                year = int(date_str.split("-")[0])
                if year == current_year:
                    total_hours_current_year += hours
                    total_sessions_current_year += 1
            except (ValueError, TypeError, IndexError):
                pass

    from zoneinfo import ZoneInfo
    data = {
        "scraped_at": datetime.now(ZoneInfo("Australia/Sydney")).isoformat(),
        "summary": {
            "total_sessions_approved": len(entries),
            "total_sessions_current_year": total_sessions_current_year,
            "total_hours_completed": total_hours,
            "total_hours_current_year": total_hours_current_year,
            "unique_skills": sorted(all_skills) if all_skills else [],
        },
        "entries": entries,
    }

    json_path = DATA_DIR / "volunteer_hours.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"      JSON saved → {json_path}")


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
    print(f"      CSV  saved → {csv_path}")


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
        
        # Connect to the database
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        
        # We wipe the table and re-insert to avoid tracking duplicates since we lack a true PK from timecounts
        cur.execute("TRUNCATE TABLE public.timecounts;")
        
        # Prepare data tuples matching the columns
        # Columns: date, day, hours, shift_name, verified_skills
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
                e.get("verified_skills")
            ) for e in entries
        ]
        
        if values:
            execute_values(cur, insert_query, values)
        
        conn.commit()
        cur.close()
        conn.close()
        
        print(f"      Supabase sync complete! Uploaded {len(values)} records.")
    except Exception as e:
        print(f"      ERROR exporting to database: {e}")

def export_data(entries: list):
    """Export the scraped data to file formats."""
    save_json(entries)
    save_csv(entries)
    export_to_supabase(entries)


def main():
    if not EMAIL or not PASSWORD:
        print("ERROR: TIMECOUNTS_EMAIL and TIMECOUNTS_PASSWORD must be set.")
        sys.exit(1)

    print("Starting Timecounts Scraper...")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox"
            ]
        )
        
        # Adding realistic user agent prevents some SPA bot detections
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720}
        )
        
        page = context.new_page()

        try:
            login(page)
            navigate_to_track_time(page)
            
            raw_entries = scrape_entries(page)
            if not raw_entries:
                print("WARNING: No entries found. Taking a debug screenshot...")
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(DATA_DIR / "debug_screenshot.png"))
                sys.exit(1)

            entries = enrich_entries(raw_entries)
            export_data(entries)

            print(f"\\nDone! Scraped {len(entries)} approved sessions.")

        except PlaywrightTimeout as e:
            print(f"TIMEOUT ERROR: {e}")
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(DATA_DIR / "timeout_screenshot.png"))
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: {e}")
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(DATA_DIR / "error_screenshot.png"))
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
