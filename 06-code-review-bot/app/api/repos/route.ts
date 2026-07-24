import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET() {
  const { rows } = await pool.query(
    `SELECT r.id, r.owner, r.name, r.config, r.updated_at,
            count(DISTINCT pr.id)::int AS pr_count,
            count(DISTINCT rv.id)::int AS review_count,
            count(f.id) FILTER (WHERE f.severity = 'critical')::int AS critical_count
     FROM repositories r
     LEFT JOIN pull_requests pr ON pr.repository_id = r.id
     LEFT JOIN reviews rv ON rv.pull_request_id = pr.id
     LEFT JOIN findings f ON f.review_id = rv.id
     GROUP BY r.id
     ORDER BY r.updated_at DESC`,
  )
  return NextResponse.json({ repositories: rows })
}

export async function PATCH(req: NextRequest) {
  const user = await getSession()
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const { id, config } = await req.json()
  if (!id) return NextResponse.json({ error: "Repository id is required" }, { status: 400 })

  const { rows } = await pool.query(
    `UPDATE repositories SET config = $1, updated_at = now() WHERE id = $2 RETURNING id, owner, name, config`,
    [JSON.stringify(config ?? {}), id],
  )
  if (!rows[0]) return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  return NextResponse.json({ repository: rows[0] })
}
