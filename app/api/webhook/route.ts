import { NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { verifyWebhookSignature, fetchPrDiff, fetchReviewbotConfig, postPrReview } from "@/lib/github"
import { runReview } from "@/lib/review"
import type { ReviewComment } from "@/lib/github"

// Raw body reading is required for HMAC verification.
// Next.js App Router provides the raw Request body directly.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get("x-hub-signature-256") ?? ""
  const event = req.headers.get("x-github-event") ?? ""

  // Verify webhook signature (skip if secret not configured, e.g. local dev)
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (secret && secret !== "dev") {
    if (!verifyWebhookSignature(secret, rawBody, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
    }
  }

  // We only care about pull_request events
  if (event !== "pull_request") {
    return NextResponse.json({ ok: true, skipped: true, reason: `event '${event}' not handled` })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
  }

  const action = payload.action as string
  // Only review on opened or synchronize (new commits pushed)
  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    return NextResponse.json({ ok: true, skipped: true, reason: `action '${action}' not handled` })
  }

  const pr = payload.pull_request as Record<string, unknown>
  const repo = payload.repository as Record<string, unknown>
  const owner = (repo.owner as Record<string, unknown>).login as string
  const repoName = repo.name as string
  const prNumber = pr.number as number
  const prTitle = pr.title as string
  const prAuthor = (pr.user as Record<string, unknown>).login as string
  const baseBranch = (pr.base as Record<string, unknown>).ref as string
  const headBranch = (pr.head as Record<string, unknown>).ref as string
  const headSha = (pr.head as Record<string, unknown>).sha as string

  const token = process.env.GITHUB_TOKEN ?? ""

  // Upsert repository record
  const { rows: repoRows } = await pool.query(
    `INSERT INTO repositories (owner, name)
     VALUES ($1, $2)
     ON CONFLICT (owner, name) DO UPDATE SET updated_at = now()
     RETURNING id, config`,
    [owner, repoName],
  )
  const repoId = repoRows[0].id as number
  let repoConfig = (repoRows[0].config as Record<string, unknown>) ?? {}

  // Upsert PR record
  const { rows: prRows } = await pool.query(
    `INSERT INTO pull_requests (repository_id, pr_number, title, author, base_branch, head_branch, state)
     VALUES ($1, $2, $3, $4, $5, $6, 'open')
     ON CONFLICT (repository_id, pr_number)
     DO UPDATE SET title = $3, head_branch = $6, state = 'open', updated_at = now()
     RETURNING id`,
    [repoId, prNumber, prTitle, prAuthor, baseBranch, headBranch],
  )
  const prId = prRows[0].id as number

  // Create a pending review record
  const { rows: reviewRows } = await pool.query(
    `INSERT INTO reviews (pull_request_id, status, head_sha)
     VALUES ($1, 'in_progress', $2)
     RETURNING id`,
    [prId, headSha],
  )
  const reviewId = reviewRows[0].id as number

  try {
    // Fetch .reviewbot.yml from repo (may not exist — that's fine)
    let fileConfig = {}
    if (token) {
      const cfg = await fetchReviewbotConfig(owner, repoName, headBranch, token).catch(() => null)
      if (cfg) fileConfig = cfg
    }
    const config = { ...repoConfig, ...fileConfig }

    // Bail if disabled in config
    if (config.enabled === false) {
      await pool.query(`UPDATE reviews SET status = 'skipped', completed_at = now() WHERE id = $1`, [reviewId])
      return NextResponse.json({ ok: true, skipped: true, reason: ".reviewbot.yml has enabled: false" })
    }

    // Fetch the PR diff
    let rawDiff = ""
    if (token) {
      rawDiff = await fetchPrDiff(owner, repoName, prNumber, token)
    }

    // Run the review
    const result = await runReview(rawDiff, config)

    // Persist findings
    for (const finding of result.findings) {
      await pool.query(
        `INSERT INTO findings (review_id, file_path, line_number, severity, category, message, suggestion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reviewId, finding.file, finding.line, finding.severity, finding.category, finding.message, finding.suggestion],
      )
    }

    // Update review record
    await pool.query(
      `UPDATE reviews
       SET status = 'completed', completed_at = now(),
           total_findings = $1, summary = $2, review_mode = $3,
           files_reviewed = $4, files_skipped = $5
       WHERE id = $6`,
      [result.findings.length, result.summary, result.mode, result.filesReviewed, result.filesSkipped, reviewId],
    )

    // Post GitHub review with inline comments (if token available)
    if (token && result.findings.length > 0) {
      const comments: ReviewComment[] = result.findings
        .filter((f) => f.line > 0)
        .map((f) => ({
          path: f.file,
          line: f.line,
          body: formatFindingComment(f),
        }))
      await postPrReview(owner, repoName, prNumber, headSha, result.summary, comments, token).catch(() => {
        // Non-fatal: review is saved even if GitHub post fails
      })
    } else if (token && result.findings.length === 0) {
      await postPrReview(owner, repoName, prNumber, headSha, result.summary, [], token).catch(() => {})
    }

    return NextResponse.json({ ok: true, reviewId, findings: result.findings.length, mode: result.mode })
  } catch (err) {
    await pool.query(
      `UPDATE reviews SET status = 'failed', completed_at = now(), summary = $1 WHERE id = $2`,
      [err instanceof Error ? err.message : "Unknown error", reviewId],
    )
    return NextResponse.json({ error: "Review failed", detail: String(err) }, { status: 500 })
  }
}

function formatFindingComment(f: { severity: string; category: string; message: string; suggestion: string }): string {
  const icons: Record<string, string> = {
    critical: "\u{1F6A8}",
    warning: "\u26A0\uFE0F",
    suggestion: "\u{1F4A1}",
    nitpick: "\u{1F4CC}",
  }
  const icon = icons[f.severity] ?? "\u{1F4AC}"
  return [
    `${icon} **ReviewBot** \u2014 \`${f.severity.toUpperCase()}\` [${f.category}]`,
    "",
    f.message,
    "",
    `**Suggestion:** ${f.suggestion}`,
  ].join("\n")
}
