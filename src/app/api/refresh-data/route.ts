import { NextResponse } from "next/server";

export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const ref = process.env.GITHUB_WORKFLOW_REF ?? "main";
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE ?? "scrape.yml";

  if (!token?.trim() || !repo?.trim()) {
    return NextResponse.json(
      {
        error:
          "Refresh is not configured. Set GITHUB_TOKEN and GITHUB_REPO on the server.",
      },
      { status: 503 },
    );
  }

  const url = `https://api.github.com/repos/${repo.trim()}/actions/workflows/${workflowFile.trim()}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.trim()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: ref.trim() }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: "GitHub refused the workflow dispatch.", detail },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
