// Unified diff parser.
//
// Parses GitHub's unified diff format (returned by the Pulls API with
// Accept: application/vnd.github.v3.diff) into structured hunks with
// per-line metadata. This is the input to the review engine.
//
// Output shape:
//   FileDiff[]
//     file: string            (e.g. "src/auth/login.ts")
//     oldFile: string | null  (null on new file)
//     status: "added" | "modified" | "deleted" | "renamed"
//     hunks: Hunk[]
//       header: string        (e.g. "@@ -10,6 +10,8 @@")
//       startLineOld: number
//       startLineNew: number
//       lines: DiffLine[]
//         type: "add" | "remove" | "context"
//         lineNumberNew: number | null
//         lineNumberOld: number | null
//         content: string

export type DiffLine = {
  type: "add" | "remove" | "context"
  lineNumberNew: number | null
  lineNumberOld: number | null
  content: string
}

export type Hunk = {
  header: string
  startLineOld: number
  startLineNew: number
  lines: DiffLine[]
}

export type FileDiff = {
  file: string
  oldFile: string | null
  status: "added" | "modified" | "deleted" | "renamed"
  hunks: Hunk[]
  addedLines: number
  removedLines: number
}

export function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  let currentHunk: Hunk | null = null
  let lineOld = 0
  let lineNew = 0

  for (const raw_line of raw.split("\n")) {
    // New file diff block
    if (raw_line.startsWith("diff --git ")) {
      if (current) files.push(current)
      current = { file: "", oldFile: null, status: "modified", hunks: [], addedLines: 0, removedLines: 0 }
      currentHunk = null
      continue
    }
    if (!current) continue

    if (raw_line.startsWith("--- ")) {
      const path = raw_line.slice(4).replace(/^a\//, "")
      current.oldFile = path === "/dev/null" ? null : path
      if (path === "/dev/null") current.status = "added"
      continue
    }
    if (raw_line.startsWith("+++ ")) {
      const path = raw_line.slice(4).replace(/^b\//, "")
      current.file = path === "/dev/null" ? (current.oldFile ?? "") : path
      if (path === "/dev/null") current.status = "deleted"
      else if (current.oldFile && current.oldFile !== path) current.status = "renamed"
      continue
    }

    // Hunk header: @@ -old_start,old_count +new_start,new_count @@
    const hunkMatch = raw_line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      lineOld = parseInt(hunkMatch[1], 10)
      lineNew = parseInt(hunkMatch[2], 10)
      currentHunk = { header: raw_line, startLineOld: lineOld, startLineNew: lineNew, lines: [] }
      current.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) continue

    if (raw_line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", lineNumberNew: lineNew++, lineNumberOld: null, content: raw_line.slice(1) })
      current.addedLines++
    } else if (raw_line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", lineNumberNew: null, lineNumberOld: lineOld++, content: raw_line.slice(1) })
      current.removedLines++
    } else if (raw_line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", lineNumberNew: lineNew++, lineNumberOld: lineOld++, content: raw_line.slice(1) })
    }
  }
  if (current) files.push(current)
  return files
}

// Render a FileDiff back to a compact string for the LLM prompt.
// Only adds/removes are sent — context is trimmed to 3 lines around changes.
export function renderForReview(fd: FileDiff, maxLines = 200): string {
  const lines: string[] = [`--- ${fd.file} (+${fd.addedLines}/-${fd.removedLines})`]
  let count = 0
  for (const hunk of fd.hunks) {
    lines.push(hunk.header)
    for (const line of hunk.lines) {
      if (count >= maxLines) { lines.push("... (truncated)"); break }
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "
      const lineNum = line.lineNumberNew ?? line.lineNumberOld ?? 0
      lines.push(`${prefix}${String(lineNum).padStart(4)} ${line.content}`)
      count++
    }
  }
  return lines.join("\n")
}
