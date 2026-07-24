// Seed demo reviews and findings so the dashboard looks populated
// without needing a real GitHub webhook.
// Usage: npm run seed

import { readFileSync } from "node:fs"
import pg from "pg"

try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.")
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const alreadySeeded = await client.query(`SELECT count(*)::int AS n FROM reviews`)
if (alreadySeeded.rows[0].n > 0) {
  console.log(`reviews table already has ${alreadySeeded.rows[0].n} row(s) \u2014 skipping demo seed.`)
  console.log("To reseed: DELETE FROM findings; DELETE FROM reviews; DELETE FROM pull_requests; DELETE FROM repositories;")
  await client.end()
  process.exit(0)
}

// Demo repositories
const repos = [
  { owner: "codeatlas", name: "api-gateway" },
  { owner: "codeatlas", name: "auth-service" },
  { owner: "codeatlas", name: "frontend" },
]
const repoIds = []
for (const r of repos) {
  const { rows } = await client.query(
    `INSERT INTO repositories (owner, name) VALUES ($1, $2) RETURNING id`,
    [r.owner, r.name],
  )
  repoIds.push(rows[0].id)
}

// Demo PRs and reviews
const demoPRs = [
  { repo: 0, num: 47, title: "feat: add JWT refresh token rotation", author: "amara-dev", base: "main", head: "feat/refresh-tokens", sha: "a1b2c3d4",
    findings: [
      { file: "src/auth/tokens.ts", line: 23, severity: "critical", category: "security", message: "Hardcoded JWT secret fallback. If SECRET_KEY is unset this will use a predictable value.", suggestion: "Throw at startup if SECRET_KEY is missing. Never provide a fallback for cryptographic secrets." },
      { file: "src/auth/tokens.ts", line: 41, severity: "warning", category: "error_handling", message: "Token verification errors are swallowed silently.", suggestion: "Log at warn level and return a typed error to the caller instead of null." },
      { file: "src/auth/refresh.ts", line: 17, severity: "suggestion", category: "correctness", message: "`Math.random()` used to generate the refresh token ID.", suggestion: "Use `crypto.randomBytes(32).toString('hex')` for a cryptographically secure token." },
    ]
  },
  { repo: 0, num: 51, title: "fix: rate limiting on /api/v2/ingest", author: "lucas-backend", base: "main", head: "fix/rate-limit", sha: "e5f6g7h8",
    findings: [
      { file: "src/middleware/ratelimit.ts", line: 8, severity: "warning", category: "performance", message: "Redis key expiry is set per-request inside the hot path.", suggestion: "Set TTL only on key creation (NX flag). This avoids a round-trip on every request." },
      { file: "src/middleware/ratelimit.ts", line: 34, severity: "nitpick", category: "style", message: "TODO comment left before merge.", suggestion: "Convert to a GitHub issue and remove the comment." },
    ]
  },
  { repo: 1, num: 12, title: "chore: migrate password hashing to argon2", author: "fatima-sec", base: "main", head: "chore/argon2", sha: "i9j0k1l2",
    findings: [] // clean PR
  },
  { repo: 1, num: 14, title: "feat: RBAC middleware for admin routes", author: "amara-dev", base: "main", head: "feat/rbac", sha: "m3n4o5p6",
    findings: [
      { file: "src/middleware/rbac.ts", line: 29, severity: "critical", category: "security", message: "Role check uses loose equality (==). A role value of 0 or '' could bypass admin check.", suggestion: "Use strict equality (===) and validate against an explicit allowlist of role strings." },
      { file: "src/middleware/rbac.ts", line: 52, severity: "warning", category: "error_handling", message: "Unauthorized responses leak the required role name in the error body.", suggestion: "Return a generic 403 message. Log the detail server-side only." },
      { file: "src/routes/admin.ts", line: 11, severity: "suggestion", category: "style", message: "`console.log` statements left in route handler.", suggestion: "Replace with structured logger. Remove debug logs before merging." },
    ]
  },
  { repo: 2, num: 88, title: "feat: dark mode toggle + theme persistence", author: "chen-frontend", base: "main", head: "feat/dark-mode", sha: "q7r8s9t0",
    findings: [
      { file: "src/hooks/useTheme.ts", line: 6, severity: "suggestion", category: "correctness", message: "Theme is read from localStorage synchronously on every render.", suggestion: "Cache in a ref or context to avoid reading localStorage on every render cycle." },
      { file: "src/components/ThemeToggle.tsx", line: 19, severity: "nitpick", category: "style", message: "Inline style object recreated on every render.", suggestion: "Extract to a constant outside the component or use a CSS class." },
    ]
  },
  { repo: 0, num: 55, title: "fix: SQL injection via unparameterised search query", author: "fatima-sec", base: "main", head: "fix/sqli", sha: "u1v2w3x4",
    findings: [
      { file: "src/search/query.ts", line: 44, severity: "critical", category: "security", message: "User input is interpolated directly into the SQL query string.", suggestion: "Use parameterised queries ($1, $2, ...) with your DB driver. Never concatenate user input into SQL." },
    ]
  },
]

let totalFindings = 0
for (const pr of demoPRs) {
  const repoId = repoIds[pr.repo]
  const { rows: prRows } = await client.query(
    `INSERT INTO pull_requests (repository_id, pr_number, title, author, base_branch, head_branch)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [repoId, pr.num, pr.title, pr.author, pr.base, pr.head],
  )
  const prId = prRows[0].id

  const summary = pr.findings.length === 0
    ? "\u2705 No issues found in this pull request."
    : `ReviewBot found ${pr.findings.length} issue(s): ${pr.findings.filter(f=>f.severity==='critical').length} critical. See inline comments.`

  const { rows: rvRows } = await client.query(
    `INSERT INTO reviews (pull_request_id, status, head_sha, summary, review_mode, total_findings, files_reviewed, completed_at)
     VALUES ($1, 'completed', $2, $3, 'mock', $4, $5, now() - interval '${Math.floor(Math.random()*72)} hours')
     RETURNING id`,
    [prId, pr.sha, summary, pr.findings.length, pr.findings.length > 0 ? Math.ceil(pr.findings.length * 1.5) : 1],
  )
  const reviewId = rvRows[0].id

  for (const f of pr.findings) {
    await client.query(
      `INSERT INTO findings (review_id, file_path, line_number, severity, category, message, suggestion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [reviewId, f.file, f.line, f.severity, f.category, f.message, f.suggestion],
    )
    totalFindings++
  }
}

console.log(`Seeded ${demoPRs.length} demo reviews across ${repos.length} repos (${totalFindings} total findings).`)
console.log("Open http://localhost:3000 to explore the dashboard.")

await client.end()
