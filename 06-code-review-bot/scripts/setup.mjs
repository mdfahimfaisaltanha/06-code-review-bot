// Idempotent schema + seed for ReviewBot.
// Usage: npm run setup  (then: npm run seed for demo data)

import { readFileSync } from "node:fs"
import { randomBytes, scryptSync } from "node:crypto"
import pg from "pg"

try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.")
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 16384 })
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`
}

console.log("Creating schema (idempotent)\u2026")

await client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS users_sessions (
    token TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS repositories (
    id SERIAL PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(owner, name)
  );

  CREATE TABLE IF NOT EXISTS pull_requests (
    id SERIAL PRIMARY KEY,
    repository_id INT NOT NULL REFERENCES repositories(id),
    pr_number INT NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    head_branch TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(repository_id, pr_number)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    pull_request_id INT NOT NULL REFERENCES pull_requests(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
    head_sha TEXT,
    summary TEXT,
    review_mode TEXT,  -- 'real' | 'mock' | 'fallback'
    total_findings INT NOT NULL DEFAULT 0,
    files_reviewed INT NOT NULL DEFAULT 0,
    files_skipped INT NOT NULL DEFAULT 0,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(pull_request_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_triggered ON reviews(triggered_at DESC);

  CREATE TABLE IF NOT EXISTS findings (
    id SERIAL PRIMARY KEY,
    review_id INT NOT NULL REFERENCES reviews(id),
    file_path TEXT NOT NULL,
    line_number INT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical','warning','suggestion','nitpick')),
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    suggestion TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
  CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
`)

// ---- users -----------------------------------------------------------------
const { rows: existingUsers } = await client.query(`SELECT count(*)::int AS n FROM users`)
if (existingUsers[0].n > 0) {
  console.log("Users already seeded \u2014 skipping.")
} else {
  const password = process.env.SEED_PASSWORD || "ChangeMe123!"
  const users = [
    { name: "Yusuf Al-Farsi", email: "admin@codeatlas.test", role: "admin" },
    { name: "Sara Mensah", email: "viewer@codeatlas.test", role: "viewer" },
  ]
  for (const u of users) {
    await client.query(
      `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)`,
      [u.name, u.email, u.role, hashPassword(password)],
    )
  }
  console.log(`Seeded ${users.length} users (password = SEED_PASSWORD, default ChangeMe123!):`)
  for (const u of users) console.log(`  ${u.email}  (${u.role})`)
}

console.log("\nDone. Next steps:")
console.log("  npm run seed   # optional: seed demo reviews + findings")
console.log("  npm run dev    # http://localhost:3000")
console.log("\nTo connect a real GitHub App:")
console.log("  1. Create an App at https://github.com/settings/apps/new")
console.log("  2. Set Webhook URL to https://your-domain.com/api/webhook")
console.log("  3. Subscribe to: pull_request events")
console.log("  4. Copy Webhook secret \u2192 GITHUB_WEBHOOK_SECRET in .env.local")
console.log("  5. Generate a PAT or installation token \u2192 GITHUB_TOKEN")

await client.end()
