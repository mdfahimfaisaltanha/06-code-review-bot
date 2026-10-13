// AI code review engine.
//
// Two modes:
//   REAL_MODE  — calls GPT-4o-mini with a structured JSON prompt.
//   MOCK_MODE  — deterministic heuristic findings (no API key needed;
//                great for demos, CI, and offline development).
//
// Mock mode activates when:
//   - OPENAI_API_KEY is unset or the string "mock"
//   - MOCK_MODE=1 env var is set
//
// The review prompt asks the model for findings in a strict JSON schema.
// If the model returns malformed JSON or times out, we fall back to mock.
//
// .reviewbot.yml config schema (all optional):
//   enabled: true
//   severity_threshold: warning   # critical | warning | suggestion | nitpick
//   ignore_paths: ["*.lock", "dist/**"]
//   focus_areas: [security, performance, error_handling, style]
//   max_files: 20
//   comment_mode: inline          # inline | summary

import type { FileDiff } from "./diff"
import { renderForReview } from "./diff"

export type Severity = "critical" | "warning" | "suggestion" | "nitpick"

export type Finding = {
  file: string
  line: number  // line number in the new file (right side)
  severity: Severity
  category: string  // e.g. "security", "performance", "error_handling", "style", "correctness"
  message: string   // concise description of the issue
  suggestion: string  // concrete fix suggestion
}

export type ReviewbotConfig = {
  enabled?: boolean
  severity_threshold?: Severity
  ignore_paths?: string[]
  focus_areas?: string[]
  max_files?: number
  comment_mode?: "inline" | "summary"
}

export type ReviewResult = {
  findings: Finding[]
  summary: string
  mode: "real" | "mock" | "fallback"
  filesReviewed: number
  filesSkipped: number
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
  nitpick: 3,
}

function isMockMode(): boolean {
  if (process.env.MOCK_MODE === "1") return true
  const key = process.env.OPENAI_API_KEY
  return !key || key === "mock" || key.startsWith("sk-mock")
}

function matchesIgnorePattern(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob: * matches non-slash chars, ** matches anything
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "DOUBLESTAR")
          .replace(/\*/g, "[^/]*")
          .replace(/DOUBLESTAR/g, ".*") +
        "$",
    )
    if (regex.test(path)) return true
  }
  return false
}

// ---- Mock review (deterministic heuristics) ----------------------------------

const MOCK_PATTERNS: Array<{
  match: RegExp
  severity: Severity
  category: string
  message: string
  suggestion: string
}> = [
  {
    match: /password|secret|api_?key|token/i,
    severity: "critical",
    category: "security",
    message: "Possible sensitive value in code. Avoid hardcoding credentials.",
    suggestion: "Use environment variables and a secrets manager. Never commit credentials to source control.",
  },
  {
    match: /eval\s*\(/,
    severity: "critical",
    category: "security",
    message: "`eval()` is dangerous and can enable code injection attacks.",
    suggestion: "Replace with a safe alternative. If dynamic execution is needed, use a sandboxed VM or restrict input strictly.",
  },
  {
    match: /TODO|FIXME|HACK/,
    severity: "warning",
    category: "style",
    message: "TODO/FIXME comment left in code.",
    suggestion: "Resolve this before merging or convert to a tracked issue.",
  },
  {
    match: /console\.log/,
    severity: "suggestion",
    category: "style",
    message: "`console.log` left in production code.",
    suggestion: "Remove or replace with a structured logger that can be silenced in production.",
  },
  {
    match: /catch\s*\(.*\)\s*\{\s*\}/,
    severity: "warning",
    category: "error_handling",
    message: "Empty catch block silently swallows errors.",
    suggestion: "At minimum log the error. Consider whether this error should propagate to the caller.",
  },
  {
    match: /any\b/,
    severity: "suggestion",
    category: "style",
    message: "TypeScript `any` type disables type safety.",
    suggestion: "Replace with a specific type or `unknown` and narrow with type guards.",
  },
  {
    match: /setTimeout|setInterval/,
    severity: "nitpick",
    category: "correctness",
    message: "Timer-based code can introduce race conditions in concurrent environments.",
    suggestion: "Prefer event-driven or promise-based patterns. Ensure timers are cleaned up on component/module teardown.",
  },
  {
    match: /Math\.random/,
    severity: "suggestion",
    category: "security",
    message: "`Math.random()` is not cryptographically secure.",
    suggestion: "Use `crypto.randomBytes` or `crypto.getRandomValues` for security-sensitive randomness.",
  },
]

function mockReview(files: FileDiff[], config: ReviewbotConfig): ReviewResult {
  const findings: Finding[] = []
  const threshold = config.severity_threshold ?? "suggestion"
  const thresholdOrder = SEVERITY_ORDER[threshold]

  for (const fd of files) {
    for (const hunk of fd.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "add") continue // only review new/modified lines
        const lineNum = line.lineNumberNew ?? 0
        for (const pattern of MOCK_PATTERNS) {
          if (pattern.match.test(line.content)) {
            if (SEVERITY_ORDER[pattern.severity] <= thresholdOrder) {
              findings.push({
                file: fd.file,
                line: lineNum,
                severity: pattern.severity,
                category: pattern.category,
                message: pattern.message,
                suggestion: pattern.suggestion,
              })
            }
          }
        }
      }
    }
  }

  const criticals = findings.filter((f) => f.severity === "critical").length
  const warnings = findings.filter((f) => f.severity === "warning").length
  const summary =
    findings.length === 0
      ? "✅ No issues found in this pull request."
      : `ReviewBot found ${findings.length} issue(s): ${criticals} critical, ${warnings} warning(s). See inline comments for details.`

  return { findings, summary, mode: "mock", filesReviewed: files.length, filesSkipped: 0 }
}

// ---- Real review (GPT-4o-mini) -----------------------------------------------

const SYSTEM_PROMPT = `You are ReviewBot, an expert code reviewer. Analyze the provided unified diff and return a JSON array of findings.

Rules:
- Only review ADDED lines (prefixed with +).
- Focus on: security vulnerabilities, bugs, error handling gaps, performance issues, and code quality.
- Do NOT flag style preferences unless they are significant.
- Each finding must reference a specific line number (the number shown in the diff).
- Return ONLY a valid JSON array of objects matching this schema exactly:
  [{"file": string, "line": number, "severity": "critical"|"warning"|"suggestion"|"nitpick", "category": string, "message": string, "suggestion": string}]
- If there are no findings, return an empty array: []
- Do not include markdown fences or any other text outside the JSON array.`

async function realReview(
  files: FileDiff[],
  config: ReviewbotConfig,
): Promise<ReviewResult> {
  // Lazy import so mock mode never needs the openai package to be configured
  const { default: OpenAI } = await import("openai")
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const threshold = config.severity_threshold ?? "suggestion"
  const thresholdOrder = SEVERITY_ORDER[threshold]
  const focusNote =
    config.focus_areas?.length
      ? `Focus especially on: ${config.focus_areas.join(", ")}.`
      : ""

  const allFindings: Finding[] = []
  let filesReviewed = 0

  for (const fd of files) {
    if (fd.addedLines === 0 && fd.removedLines === 0) continue
    const diffText = renderForReview(fd)
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + (focusNote ? "\n" + focusNote : "") },
          { role: "user", content: diffText },
        ],
      })
      const raw = completion.choices[0]?.message?.content?.trim() ?? "[]"
      const parsed = JSON.parse(raw) as Finding[]
      const filtered = parsed.filter(
        (f) => SEVERITY_ORDER[f.severity] <= thresholdOrder,
      )
      allFindings.push(...filtered)
      filesReviewed++
    } catch {
      // If one file fails, continue with the rest
    }
  }

  const criticals = allFindings.filter((f) => f.severity === "critical").length
  const warnings = allFindings.filter((f) => f.severity === "warning").length
  const summary =
    allFindings.length === 0
      ? "✅ No issues found in this pull request."
      : `ReviewBot found ${allFindings.length} issue(s): ${criticals} critical, ${warnings} warning(s). See inline comments for details.`

  return { findings: allFindings, summary, mode: "real", filesReviewed, filesSkipped: files.length - filesReviewed }
}

// ---- Public entry point -------------------------------------------------------

export async function runReview(
  rawDiff: string,
  config: ReviewbotConfig = {},
): Promise<ReviewResult> {
  const { parseDiff } = await import("./diff")
  let files = parseDiff(rawDiff)

  // Apply ignore_paths filter
  if (config.ignore_paths?.length) {
    files = files.filter((fd) => !matchesIgnorePattern(fd.file, config.ignore_paths!))
  }

  // Apply max_files cap
  const maxFiles = config.max_files ?? 20
  const skipped = Math.max(0, files.length - maxFiles)
  files = files.slice(0, maxFiles)

  // Skip deleted-only files
  files = files.filter((fd) => fd.status !== "deleted" || fd.addedLines > 0)

  if (isMockMode()) {
    const result = mockReview(files, config)
    result.filesSkipped += skipped
    return result
  }

  try {
    const result = await realReview(files, config)
    result.filesSkipped += skipped
    return result
  } catch {
    // Fallback to mock on any OpenAI error
    const result = mockReview(files, config)
    result.mode = "fallback"
    result.filesSkipped += skipped
    return result
  }
}
