// GitHub API helpers.
//
// All functions accept an explicit `token` so they work with both
// GitHub App installation tokens and classic PATs (GITHUB_TOKEN env var).
//
// Webhook signature verification uses HMAC-SHA256 with the shared secret
// configured on the GitHub App settings page. The check is timing-safe.

import { createHmac, timingSafeEqual } from "node:crypto"
import yaml from "js-yaml"
import type { ReviewbotConfig } from "./review"

export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  if (!signature.startsWith("sha256=")) return false
  const expected = createHmac("sha256", secret).update(payload).digest("hex")
  const sig = signature.slice(7)
  if (sig.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
}

async function ghFetch(
  path: string,
  token: string,
  options: RequestInit = {},
  accept = "application/vnd.github.v3+json",
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  })
}

// Fetch the unified diff for a pull request.
export async function fetchPrDiff(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<string> {
  const res = await ghFetch(
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
    token,
    {},
    "application/vnd.github.v3.diff",
  )
  if (!res.ok) throw new Error(`GitHub diff fetch failed: ${res.status} ${await res.text()}`)
  return res.text()
}

// Fetch .reviewbot.yml from the head branch of the PR.
export async function fetchReviewbotConfig(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<ReviewbotConfig | null> {
  const res = await ghFetch(
    `/repos/${owner}/${repo}/contents/.reviewbot.yml?ref=${encodeURIComponent(ref)}`,
    token,
  )
  if (res.status === 404) return null
  if (!res.ok) return null
  const data = (await res.json()) as { content?: string }
  if (!data.content) return null
  try {
    const decoded = Buffer.from(data.content, "base64").toString("utf8")
    return yaml.load(decoded) as ReviewbotConfig
  } catch {
    return null
  }
}

export type ReviewComment = {
  path: string
  line: number
  body: string
  side?: "RIGHT"
}

// Post a pull request review with inline comments.
// Uses the Reviews API which supports multiple inline comments in one call.
export async function postPrReview(
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  summary: string,
  comments: ReviewComment[],
  token: string,
): Promise<void> {
  const res = await ghFetch(
    `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        commit_id: commitSha,
        body: summary,
        event: "COMMENT",
        comments: comments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side ?? "RIGHT",
          body: c.body,
        })),
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub review post failed: ${res.status} ${text}`)
  }
}
