import fs from "fs";
import path from "path";
import { ClipboardClock } from "lucide-react";
import DashboardClient from "@/components/dashboard-client";

export default function Page() {
  const dataPath = path.join(process.cwd(), "data", "volunteer_hours.json");
  let data = null;

  try {
    if (fs.existsSync(dataPath)) {
      const fileContents = fs.readFileSync(dataPath, "utf8");
      data = JSON.parse(fileContents);
    }
  } catch (error) {
    console.error("Failed to load data:", error);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="flex h-14 items-center px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <ClipboardClock
              className="h-4 w-4 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <h1 className="text-lg font-bold tracking-tight">timecounts</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
        {data ? (
          <DashboardClient data={data} />
        ) : (
          <p className="text-sm text-[rgb(100,100,100)]">
            No data found. Run the scraper first.
          </p>
        )}
      </main>
    </div>
  );
}
