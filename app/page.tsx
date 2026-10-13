"use client"

import { useEffect, useState, useCallback } from "react"

type ReviewRow = {
  id: number
  status: string
  summary: string
  review_mode: string
  total_findings: number
  triggered_at: string
  pr_number: number
  title: string
  author: string
  head_branch: string
  owner: string
  repo_name: string
  critical_count: number
  warning_count: number
  suggestion_count: number
  nitpick_count: number
}

type Stats = {
  total_reviews: number
  total_critical: number
  total_warnings: number
  total_suggestions: number
  total_nitpicks: number
  repos_monitored: number
}

type Finding = {
  id: number
  file_path: string
  line_number: number
  severity: string
  category: string
  message: string
  suggestion: string
}

type ReviewDetail = {
  review: {
    id: number; status: string; summary: string; review_mode: string
    total_findings: number; files_reviewed: number; files_skipped: number
    triggered_at: string; completed_at: string
    pr_number: number; title: string; author: string
    base_branch: string; head_branch: string
    owner: string; repo_name: string
    head_sha: string
  }
  findings: Finding[]
}

type Repo = {
  id: number; owner: string; name: string
  config: Record<string, unknown>; updated_at: string
  pr_count: number; review_count: number; critical_count: number
}

type User = { id: number; name: string; email: string; role: string }

const SEV_ICON: Record<string, string> = {
  critical: "🚨", warning: "⚠️", suggestion: "💡", nitpick: "📌"
}

function SevBadge({ sev }: { sev: string }) {
  return <span className={`badge ${sev}`}>{SEV_ICON[sev] ?? ""} {sev}</span>
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <span className="badge good">completed</span>
  if (status === "failed") return <span className="badge critical">failed</span>
  if (status === "in_progress") return <span className="badge accent">in progress</span>
  if (status === "skipped") return <span className="badge">skipped</span>
  return <span className="badge">{status}</span>
}

export default function Home() {
  const [tab, setTab] = useState<"reviews" | "stats" | "repos" | "demo">("reviews")
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    fetch("/api/auth").then(r => r.json()).then(d => setUser(d.user)).catch(() => {})
  }, [])

  return (
    <main>
      <h1>🤖 ReviewBot</h1>
      <p className="subtitle">
        AI-powered GitHub PR code review — GPT-4o-mini analysis, inline comments, severity ranking,
        .reviewbot.yml per-repo config, and HMAC-verified webhooks.
      </p>
      <div className="tabs">
        <button className={tab==="reviews" ? "active" : ""} onClick={() => setTab("reviews")}>📋 Reviews</button>
        <button className={tab==="stats" ? "active" : ""} onClick={() => setTab("stats")}>📊 Stats</button>
        <button className={tab==="repos" ? "active" : ""} onClick={() => setTab("repos")}>🗂 Repos</button>
        <button className={tab==="demo" ? "active" : ""} onClick={() => setTab("demo")}>🧪 Demo review</button>
      </div>
      {tab === "reviews" && <ReviewsTab />}
      {tab === "stats" && <StatsTab />}
      {tab === "repos" && <ReposTab user={user} setUser={setUser} />}
      {tab === "demo" && <DemoTab user={user} setUser={setUser} />}
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Reviews tab                                                          */
/* ------------------------------------------------------------------ */
function ReviewsTab() {
  const [data, setData] = useState<{ reviews: ReviewRow[]; stats: Stats } | null>(null)
  const [selected, setSelected] = useState<ReviewDetail | null>(null)

  useEffect(() => {
    fetch("/api/reviews?limit=50").then(r => r.json()).then(setData)
  }, [])

  const openDetail = async (id: number) => {
    const d = await fetch(`/api/reviews?id=${id}`).then(r => r.json())
    setSelected(d)
  }

  if (!data) return <div className="card"><p className="muted">Loading…</p></div>

  if (selected) return <ReviewDetailView detail={selected} onBack={() => setSelected(null)} />

  const { reviews, stats } = data
  return (
    <>
      <div className="stat-grid">
        <div className="stat"><div className="v">{stats.total_reviews}</div><div className="k">total reviews</div></div>
        <div className="stat bad"><div className="v">{stats.total_critical}</div><div className="k">critical findings</div></div>
        <div className="stat warn"><div className="v">{stats.total_warnings}</div><div className="k">warnings</div></div>
        <div className="stat info"><div className="v">{stats.total_suggestions}</div><div className="k">suggestions</div></div>
        <div className="stat"><div className="v">{stats.repos_monitored}</div><div className="k">repos monitored</div></div>
      </div>
      <div className="card">
        <h2>Recent reviews</h2>
        {reviews.length === 0 ? (
          <p className="muted">No reviews yet. Trigger a webhook from GitHub or use the 🧪 Demo review tab.</p>
        ) : (
          <table>
            <thead><tr>
              <th>PR</th><th>Repo</th><th>Branch</th><th>Status</th>
              <th>🚨</th><th>⚠️</th><th>💡</th><th>Mode</th><th>Triggered</th>
            </tr></thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r.id} className="clickable" onClick={() => openDetail(r.id)}>
                  <td>
                    <div className="mono">#{r.pr_number}</div>
                    <div style={{fontSize:12,color:"var(--muted)"}}>{r.title.slice(0,50)}</div>
                  </td>
                  <td className="mono">{r.owner}/{r.repo_name}</td>
                  <td className="mono" style={{fontSize:11}}>{r.head_branch}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td style={{color: r.critical_count > 0 ? "var(--bad)" : "var(--muted)"}}><strong>{r.critical_count}</strong></td>
                  <td style={{color: r.warning_count > 0 ? "var(--warn)" : "var(--muted)"}}>{r.warning_count}</td>
                  <td style={{color:"var(--muted)"}}>{r.suggestion_count}</td>
                  <td><span className={`badge ${r.review_mode === "mock" ? "mock" : r.review_mode === "real" ? "good" : ""}`}>{r.review_mode ?? "—"}</span></td>
                  <td className="muted" style={{fontSize:12}}>{r.triggered_at?.slice(0,16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function ReviewDetailView({ detail, onBack }: { detail: ReviewDetail; onBack: () => void }) {
  const { review: r, findings } = detail
  const grouped = findings.reduce<Record<string, Finding[]>>((acc, f) => {
    acc[f.severity] = [...(acc[f.severity] ?? []), f]
    return acc
  }, {})

  return (
    <div>
      <button className="ghost" onClick={onBack} style={{marginBottom:16}}>← Back to reviews</button>
      <div className="card">
        <h2>#{r.pr_number} {r.title}</h2>
        <p className="muted">{r.owner}/{r.repo_name} • {r.head_branch} • by {r.author} • {r.triggered_at?.slice(0,16)}</p>
        <div style={{marginTop:12,padding:"10px 14px",background:"var(--panel-2)",borderRadius:6,fontStyle:"italic"}}>
          {r.summary}
        </div>
        <div className="stat-grid" style={{marginTop:12}}>
          <div className="stat"><div className="v">{r.total_findings}</div><div className="k">total findings</div></div>
          <div className="stat"><div className="v">{r.files_reviewed}</div><div className="k">files reviewed</div></div>
          <div className="stat"><div className="v">{r.files_skipped}</div><div className="k">files skipped</div></div>
          <div className="stat"><div className="v"><StatusBadge status={r.status} /></div><div className="k">status</div></div>
        </div>
      </div>

      {["critical","warning","suggestion","nitpick"].map(sev => {
        const list = grouped[sev] ?? []
        if (list.length === 0) return null
        return (
          <div key={sev} className="card">
            <h3>{SEV_ICON[sev]} {sev.charAt(0).toUpperCase()+sev.slice(1)}s ({list.length})</h3>
            {list.map(f => (
              <div key={f.id} className={`finding-block ${sev}`}>
                <div className="finding-header">
                  <SevBadge sev={f.severity} />
                  <span className="badge">{f.category}</span>
                  <span className="mono" style={{fontSize:11,color:"var(--muted)",marginLeft:"auto"}}>{f.file_path}:{f.line_number}</span>
                </div>
                <div className="finding-body">
                  <p style={{marginBottom:6}}>{f.message}</p>
                  <p className="muted">💬 <em>{f.suggestion}</em></p>
                </div>
              </div>
            ))}
          </div>
        )
      })}

      {findings.length === 0 && (
        <div className="card"><p className="muted">✅ No findings — clean PR!</p></div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stats tab                                                           */
/* ------------------------------------------------------------------ */
function StatsTab() {
  const [data, setData] = useState<{ stats: Stats; topCategories: Array<{category: string; cnt: number}> } | null>(null)

  useEffect(() => {
    fetch("/api/reviews?limit=1").then(r => r.json()).then(setData)
  }, [])

  if (!data?.stats) return <div className="card"><p className="muted">Loading…</p></div>
  const { stats: s, topCategories } = data
  const totalFindings = s.total_critical + s.total_warnings + s.total_suggestions + s.total_nitpicks
  const maxCat = Math.max(...topCategories.map(c => c.cnt), 1)

  return (
    <>
      <div className="stat-grid">
        <div className="stat accent"><div className="v">{s.total_reviews}</div><div className="k">total reviews</div></div>
        <div className="stat"><div className="v">{s.repos_monitored}</div><div className="k">repos monitored</div></div>
        <div className="stat"><div className="v">{totalFindings}</div><div className="k">total findings</div></div>
        <div className="stat bad"><div className="v">{s.total_critical}</div><div className="k">critical</div></div>
        <div className="stat warn"><div className="v">{s.total_warnings}</div><div className="k">warnings</div></div>
        <div className="stat info"><div className="v">{s.total_suggestions}</div><div className="k">suggestions</div></div>
      </div>

      <div className="card">
        <h2>Findings by severity</h2>
        {(["critical","warning","suggestion","nitpick"] as const).map(sev => {
          const cnt = sev === "critical" ? s.total_critical : sev === "warning" ? s.total_warnings : sev === "suggestion" ? s.total_suggestions : s.total_nitpicks
          const cls = sev === "critical" ? "bad" : sev === "warning" ? "warn" : sev === "suggestion" ? "info" : ""
          return (
            <div key={sev} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span>{SEV_ICON[sev]} {sev}</span>
                <span className="muted">{cnt}</span>
              </div>
              <div className="bar-wrap">
                <div className="bar-track"><div className={`bar-fill ${cls}`} style={{width:`${totalFindings>0?(cnt/totalFindings)*100:0}%`}} /></div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h2>Top finding categories</h2>
        {topCategories.map(c => (
          <div key={c.category} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span>{c.category}</span>
              <span className="muted">{c.cnt}</span>
            </div>
            <div className="bar-wrap">
              <div className="bar-track"><div className="bar-fill" style={{width:`${(c.cnt/maxCat)*100}%`}} /></div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Repos tab                                                           */
/* ------------------------------------------------------------------ */
function ReposTab({ user, setUser }: { user: User | null; setUser: (u: User | null) => void }) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loginError, setLoginError] = useState("")

  const load = useCallback(() => {
    fetch("/api/repos").then(r => r.json()).then(d => setRepos(d.repositories ?? []))
  }, [])

  useEffect(() => { load() }, [load])

  const login = async () => {
    setLoginError("")
    const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })
    const d = await res.json()
    if (!res.ok) { setLoginError(d.error ?? "Login failed"); return }
    setUser(d.user)
  }

  return (
    <>
      {repos.length === 0 ? (
        <div className="card"><p className="muted">No repositories yet. ReviewBot registers repos automatically when it receives a webhook from GitHub.</p></div>
      ) : (
        <div className="card">
          <h2>Monitored repositories</h2>
          <table>
            <thead><tr><th>Repository</th><th>PRs</th><th>Reviews</th><th>Critical findings</th></tr></thead>
            <tbody>
              {repos.map(r => (
                <tr key={r.id}>
                  <td className="mono">{r.owner}/{r.name}</td>
                  <td>{r.pr_count}</td>
                  <td>{r.review_count}</td>
                  <td style={{color: r.critical_count > 0 ? "var(--bad)" : "var(--muted)"}}>{r.critical_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Webhook endpoint</h2>
        <p className="muted" style={{marginBottom:10}}>Point your GitHub App's webhook at this URL. Set the secret to <code>GITHUB_WEBHOOK_SECRET</code>.</p>
        <code style={{display:"block",padding:"10px 14px",background:"var(--panel-2)",borderRadius:6,fontSize:13}}>
          POST https://your-domain.com/api/webhook
        </code>
        <p className="muted" style={{marginTop:10}}>Subscribe to events: <code>pull_request</code>. Signature algorithm: <code>HMAC-SHA256</code> via <code>x-hub-signature-256</code> header.</p>
      </div>

      {!user && (
        <div className="card">
          <h2>Admin sign-in</h2>
          <p className="muted" style={{marginBottom:10}}>Seeded accounts: <code>admin@codeatlas.test</code> / <code>viewer@codeatlas.test</code> with <code>SEED_PASSWORD</code>.</p>
          <label>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@codeatlas.test" style={{marginBottom:10}} />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{marginBottom:10}} />
          {loginError && <p className="err-text">{loginError}</p>}
          <button className="primary" onClick={login}>Sign in</button>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Demo review tab                                                     */
/* ------------------------------------------------------------------ */
const DEMO_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abc1234..def5678 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,10 +1,22 @@
 import { db } from '../db'
 
+const API_SECRET = 'sk-prod-abc123supersecret'
+
 export async function loginUser(email: string, password: string) {
+  // TODO: add rate limiting before launch
   try {
     const user = await db.users.findOne({ email })
+    console.log('Login attempt for:', email)
     if (!user) return null
+    const token = Math.random().toString(36).slice(2)
+    return { user, token }
   } catch (e) {
+    // swallow error silently
   }
+  const query = eval('db.find("' + email + '")')
+  return query
 }
`.trim()

function DemoTab({ user, setUser }: { user: User | null; setUser: (u: User | null) => void }) {
  const [diff, setDiff] = useState(DEMO_DIFF)
  const [result, setResult] = useState<{findings: Finding[]; summary: string; mode: string} | null>(null)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loginError, setLoginError] = useState("")

  const login = async () => {
    setLoginError("")
    const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })
    const d = await res.json()
    if (!res.ok) { setLoginError(d.error ?? "Login failed"); return }
    setUser(d.user)
  }

  const runDemo = async () => {
    setLoading(true); setResult(null)
    const res = await fetch("/api/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-github-event": "pull_request" },
      body: JSON.stringify({
        action: "opened",
        repository: { owner: { login: "codeatlas" }, name: "demo-repo" },
        pull_request: {
          number: Math.floor(Math.random() * 900) + 100,
          title: "Demo: auth login refactor",
          user: { login: "demo-user" },
          base: { ref: "main" },
          head: { ref: "feature/auth-refactor", sha: "abc123demo" },
        },
        // Pass the diff directly in body for demo mode (webhook handler checks this)
        _demo_diff: diff,
      }),
    })
    const d = await res.json()
    setLoading(false)
    if (d.reviewId) {
      const detail = await fetch(`/api/reviews?id=${d.reviewId}`).then(r => r.json())
      setResult({ findings: detail.findings ?? [], summary: detail.review?.summary ?? "", mode: detail.review?.review_mode ?? "mock" })
    }
  }

  if (!user) return (
    <div className="card">
      <h2>Sign in to run a demo review</h2>
      <p className="muted" style={{marginBottom:10}}>Seeded accounts: <code>admin@codeatlas.test</code> / <code>viewer@codeatlas.test</code> with <code>SEED_PASSWORD</code>.</p>
      <label>Email</label>
      <input value={email} onChange={e => setEmail(e.target.value)} style={{marginBottom:10}} />
      <label>Password</label>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{marginBottom:10}} />
      {loginError && <p className="err-text">{loginError}</p>}
      <button className="primary" onClick={login}>Sign in</button>
    </div>
  )

  return (
    <div className="card">
      <h2>Demo review</h2>
      <p className="muted" style={{marginBottom:12}}>Paste a unified diff below and click Run. This simulates a GitHub webhook — the bot parses the diff, runs the review engine (mock mode if no OpenAI key), and shows findings inline. The default diff has intentional issues: hardcoded secret, eval injection, empty catch, TODO, console.log, and Math.random for a token.</p>
      <label>Unified diff (paste any real diff here)</label>
      <textarea value={diff} onChange={e => setDiff(e.target.value)} style={{marginBottom:12}} />
      <button className="primary" onClick={runDemo} disabled={loading}>
        {loading ? "Running…" : "▶ Run review"}
      </button>

      {result && (
        <>
          <div style={{marginTop:16,padding:"10px 14px",background:"var(--panel-2)",borderRadius:6,fontStyle:"italic"}}>
            {result.summary}
            <span className={`badge ${result.mode === "mock" ? "mock" : "good"}`} style={{marginLeft:8}}>{result.mode} mode</span>
          </div>
          <div style={{marginTop:12}}>
            {result.findings.length === 0 && <p className="muted">✅ No findings.</p>}
            {result.findings.map((f, i) => (
              <div key={i} className={`finding-block ${f.severity}`}>
                <div className="finding-header">
                  <SevBadge sev={f.severity} />
                  <span className="badge">{f.category}</span>
                  <span className="mono" style={{fontSize:11,color:"var(--muted)",marginLeft:"auto"}}>{f.file_path}:{f.line_number}</span>
                </div>
                <div className="finding-body">
                  <p style={{marginBottom:6}}>{f.message}</p>
                  <p className="muted">💬 <em>{f.suggestion}</em></p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
