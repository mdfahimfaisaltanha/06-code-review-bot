# ReviewBot — AI Code Review Bot

Automated AI-powered code review for GitHub pull requests for fictional engineering team
**CodeAtlas**. Receives GitHub App webhooks, parses unified diffs, runs GPT-4o-mini
analysis with **severity ranking** (critical/warning/suggestion/nitpick), posts **inline
PR comments** via the GitHub Reviews API, and persists findings for a team dashboard.

Next.js 14 (App Router) + TypeScript + PostgreSQL. Works fully offline in mock mode.

## Architecture

```
GitHub PR opened
      │
      ▼ HMAC-SHA256 verified
POST /api/webhook
      │
      ├─ fetch .reviewbot.yml from head branch
      ├─ fetch PR unified diff (GitHub REST API)
      ├─ parseDiff() → FileDiff[] with per-line metadata
      ├─ runReview():  REAL mode: GPT-4o-mini JSON prompt
      │             MOCK mode: heuristic pattern scan (8 rules)
      │             FALLBACK:  mock on any OpenAI error
      ├─ persist findings to Postgres
      └─ postPrReview() → GitHub Reviews API (inline comments per finding)

Dashboard: /  (Reviews | Stats | Repos | Demo review)
```

## Design

1. **HMAC-SHA256 webhook verification, timing-safe.** `crypto.timingSafeEqual` prevents
   timing attacks that could allow an attacker to forge the secret bit-by-bit. This is
   the same approach GitHub's own octokit library uses.

2. **Raw body must be read before JSON parsing.** The HMAC is computed over the raw bytes.
   Once you call `req.json()`, the body is consumed and you cannot re-read it. The webhook
   handler reads `req.text()` first, verifies, then parses — a common interview trap.

3. **Structured JSON prompt with a strict schema.** The system prompt specifies the exact
   output shape and says "return ONLY a valid JSON array, no markdown fences". Temperature
   is set to 0 for determinism. If the model deviates, `JSON.parse` throws and we fall
   back to mock mode — fail-closed, not fail-open.

4. **Two-tier review: GPT + heuristic mock.** Mock mode implements 8 pattern rules
   (hardcoded credentials, eval, empty catch, Math.random for tokens, etc.) that catch
   the most common issues without any API key. In production, mock is the fallback when
   OpenAI is unreachable. The bot is never completely down.

5. **`.reviewbot.yml` lives in the repo, versioned with code.** Teams control the bot's
   behaviour (severity threshold, ignored paths, focus areas, max files) via a PR, not a
   shared admin panel. Config is fetched from the PR's head branch so a PR can change
   its own review rules — which is both powerful and slightly dangerous (noted in
   the edge-case table).

6. **Inline comments via the Reviews API, not the Comments API.** The Reviews API accepts
   multiple inline comments in a single call, posts them as a batch review (not N separate
   notifications), and supports `COMMENT` event (non-blocking) vs `REQUEST_CHANGES`.
   Using single-comment POSTs would spam the PR author.

7. **One review per webhook event, idempotent upsert for PR and repo records.** `ON
   CONFLICT DO UPDATE` ensures that a `synchronize` event (new commits pushed) creates
   a fresh review without duplicating the PR row. Each review is its own Postgres row
   so review history is preserved per push.

## Getting started

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL (Neon/Supabase free tier)
npm run setup                # schema + 2 users
npm run seed                 # 6 demo reviews with findings (optional)
npm run dev                  # http://localhost:3000
```

Sign in on the dashboard: `admin@codeatlas.test` / `viewer@codeatlas.test` with
`SEED_PASSWORD` (default `ChangeMe123!`).

### Connecting a real GitHub App

1. Create a GitHub App at `https://github.com/settings/apps/new`
2. Set **Webhook URL** to `https://your-domain.com/api/webhook`
3. Subscribe to **pull_request** events (opened, synchronize, reopened)
4. Set a **Webhook secret** → `GITHUB_WEBHOOK_SECRET` in `.env.local`
5. Generate a fine-grained PAT or installation token → `GITHUB_TOKEN`
6. Required token permissions: `pull_requests: write`, `contents: read`
7. Add `OPENAI_API_KEY` to enable real AI review (leave blank for mock mode)

## API

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/webhook` | HMAC sig | GitHub pull_request webhook receiver |
| GET | `/api/reviews` | — | List reviews with severity breakdown + stats |
| GET | `/api/reviews?id=` | — | Single review detail with all findings |
| GET | `/api/repos` | — | List monitored repositories |
| PATCH | `/api/repos` | admin session | Update repo-level config override |
| GET/POST/DELETE | `/api/auth` | — | Session check / login / logout |

## Severity levels

| Level | Icon | When to use |
| --- | --- | --- |
| `critical` | 🚨 | Security vulnerabilities, data corruption, crashes |
| `warning` | ⚠️ | Error handling gaps, performance issues, subtle bugs |
| `suggestion` | 💡 | Best practice improvements, missing edge-case handling |
| `nitpick` | 📌 | Style, minor readability, optional cleanup |

## Edge cases handled

| # | Edge case | Behavior |
| --- | --- | --- |
| 1 | Invalid webhook signature | 401 immediately; timing-safe comparison |
| 2 | Unknown event type | 200 with `skipped: true` |
| 3 | OpenAI timeout / error | Fallback to mock mode; review still completes |
| 4 | Malformed model JSON | `JSON.parse` catch → fallback to mock |
| 5 | `.reviewbot.yml` absent | Uses defaults (enabled, threshold=suggestion) |
| 6 | `enabled: false` in config | Review marked `skipped`, no comment posted |
| 7 | PR has > `max_files` changes | Excess files skipped, noted in summary |
| 8 | Deleted files | Skipped (no added lines to review) |
| 9 | GitHub comment post fails | Non-fatal; findings still saved to DB |
| 10 | `synchronize` event (new push) | Fresh review row; PR row upserted |
| 11 | Config changes its own rules | New config fetched from head branch per event |

## Honesty notes

- **Mock heuristics are regex-based, not semantic.** A hardcoded string `const DB_PASSWORD`
  triggers the credential rule even if it's an empty string. Real GPT review is
  context-aware; mock mode is a safety net.
- **The Reviews API `line` field requires the line to exist in the diff.** If the model
  returns a line number outside the diff hunks, GitHub rejects that comment. Production
  hardening: validate `line` against parsed hunk ranges before posting.
- **Inline comment `line` references the right side (new file).** The webhook handler
  always uses `side: "RIGHT"`, which is correct for added lines but wrong for removed-line
  findings. Extended fix: detect the line type and set `side` accordingly.

## Deploying

- **App:** Vercel (Next.js defaults). Set all env vars in Vercel project settings.
- **Postgres:** Neon or Supabase free tier.
- **GitHub App:** One installation can monitor multiple repos in the same org.
