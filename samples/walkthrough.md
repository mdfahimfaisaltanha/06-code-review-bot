# ReviewBot — 6-step demo walkthrough

Scripted tour for interviews (~5 minutes).
Run `npm run setup && npm run seed && npm run dev` first.

## 1. Dashboard overview — Reviews tab

Open the Reviews tab. Six seeded PRs appear across 3 repos. Point out:
- PR #55 (SQL injection fix) has a single **critical** security finding
- PR #14 (RBAC middleware) has 2 criticals — open it
- PR #12 (argon2 migration) is a clean PR with 0 findings

Say: "A bot that never reports zero findings is a bot nobody trusts. Clean PRs
are just as important to surface as flagged ones."

## 2. Drill into a review — RBAC PR

Click PR #14. Walk the findings in severity order:
- 🚨 **Critical** `rbac.ts:29` — loose equality role check (== instead of ===, bypass risk)
- ⚠️ **Warning** `rbac.ts:52` — error body leaks required role name
- 💡 **Suggestion** `admin.ts:11` — console.log in route handler

Point out that each finding has a **concrete suggestion**, not just a complaint.
That's the difference between a linter and an AI reviewer.

## 3. Stats tab — patterns across repos

Open the Stats tab. The findings-by-severity chart shows the distribution.
"security" and "error_handling" should be the top categories — which matches
the `focus_areas` in `.reviewbot.yml`. Say: "the config lets teams tune signal
vs. noise per repo."

## 4. Repos tab — webhook setup

Open the Repos tab. Show the three seeded repos. Explain the webhook endpoint:
`POST /api/webhook` receives `pull_request` events from GitHub, verifies the
HMAC-SHA256 signature with `x-hub-signature-256`, fetches the PR diff via the
GitHub REST API, and runs the review. No polling, no cron — event-driven.

## 5. Demo review tab — live in-browser review

Open the 🧪 Demo review tab. The default diff has deliberate issues:
```
+const API_SECRET = 'sk-prod-abc123supersecret'  // hardcoded credential
+// TODO: add rate limiting                       // FIXME comment
+console.log('Login attempt for:', email)         // debug log
+const token = Math.random().toString(36)         // insecure RNG
+} catch (e) {                                    // empty catch
+const query = eval('db.find("' + email + '")')   // eval injection
```

Click **Run review**. The mock engine scans added lines against heuristic
patterns and flags each issue with severity, category, and a concrete suggestion.
Replace `OPENAI_API_KEY` in `.env.local` with a real key to see GPT-4o-mini
review the same diff.

## 6. .reviewbot.yml — the configuration story

Open `samples/.reviewbot.yml`. Walk through:
- `severity_threshold: warning` — nitpicks stay quiet in noisy repos
- `ignore_paths` — lock files and dist never reviewed
- `focus_areas` — guides the LLM's attention
- `max_files: 20` — prevents token cost explosion on giant PRs
- `comment_mode: inline` — findings attach to the exact diff line

Say: "this file lives in the repo, versioned with the code. The team controls
the bot's behaviour, not a shared admin panel."

## Curl quickies

```bash
# trigger a simulated webhook (no signature check needed in dev)
curl -X POST http://localhost:3000/api/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-github-event: pull_request' \
  -d '{"action":"opened","repository":{"owner":{"login":"codeatlas"},"name":"demo"},"pull_request":{"number":99,"title":"Test PR","user":{"login":"dev"},"base":{"ref":"main"},"head":{"ref":"feat/test","sha":"abc"}}}'

# list reviews
curl 'http://localhost:3000/api/reviews?limit=5'

# get a review with findings
curl 'http://localhost:3000/api/reviews?id=1'
```
