import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reviewId = searchParams.get("id")
  const repoFilter = searchParams.get("repo") // "owner/name"
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200)

  // Single review detail with findings
  if (reviewId) {
    const { rows: review } = await pool.query(
      `SELECT r.id, r.status, r.head_sha, r.summary, r.review_mode, r.total_findings,
              r.files_reviewed, r.files_skipped,
              to_char(r.triggered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS triggered_at,
              to_char(r.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at,
              pr.pr_number, pr.title, pr.author, pr.base_branch, pr.head_branch,
              rep.owner, rep.name AS repo_name
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       JOIN repositories rep ON rep.id = pr.repository_id
       WHERE r.id = $1`,
      [reviewId],
    )
    if (!review[0]) return NextResponse.json({ error: "Review not found" }, { status: 404 })

    const { rows: findings } = await pool.query(
      `SELECT id, file_path, line_number, severity, category, message, suggestion
       FROM findings WHERE review_id = $1
       ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'suggestion' THEN 2 ELSE 3 END,
         file_path, line_number`,
      [reviewId],
    )

    return NextResponse.json({ review: review[0], findings })
  }

  // List mode
  const conditions: string[] = []
  const params: unknown[] = []
  if (repoFilter) {
    const [owner, name] = repoFilter.split("/")
    conditions.push(`rep.owner = $${params.length + 1} AND rep.name = $${params.length + 2}`)
    params.push(owner, name)
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.summary, r.review_mode, r.total_findings,
            to_char(r.triggered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS triggered_at,
            pr.pr_number, pr.title, pr.author, pr.head_branch,
            rep.owner, rep.name AS repo_name,
            count(f.id) FILTER (WHERE f.severity = 'critical')::int AS critical_count,
            count(f.id) FILTER (WHERE f.severity = 'warning')::int AS warning_count,
            count(f.id) FILTER (WHERE f.severity = 'suggestion')::int AS suggestion_count,
            count(f.id) FILTER (WHERE f.severity = 'nitpick')::int AS nitpick_count
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     JOIN repositories rep ON rep.id = pr.repository_id
     LEFT JOIN findings f ON f.review_id = r.id
     ${where}
     GROUP BY r.id, pr.pr_number, pr.title, pr.author, pr.head_branch, rep.owner, rep.name
     ORDER BY r.triggered_at DESC
     LIMIT $${params.length + 1}`,
    [...params, limit],
  )

  // Aggregate stats
  const { rows: stats } = await pool.query(
    `SELECT
       count(DISTINCT r.id)::int AS total_reviews,
       count(f.id) FILTER (WHERE f.severity = 'critical')::int AS total_critical,
       count(f.id) FILTER (WHERE f.severity = 'warning')::int AS total_warnings,
       count(f.id) FILTER (WHERE f.severity = 'suggestion')::int AS total_suggestions,
       count(f.id) FILTER (WHERE f.severity = 'nitpick')::int AS total_nitpicks,
       count(DISTINCT pr.repository_id)::int AS repos_monitored
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     LEFT JOIN findings f ON f.review_id = r.id`,
  )

  const { rows: topCategories } = await pool.query(
    `SELECT category, count(*)::int AS cnt FROM findings GROUP BY category ORDER BY cnt DESC LIMIT 8`,
  )

  return NextResponse.json({ reviews: rows, stats: stats[0], topCategories })
}
