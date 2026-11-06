// ===================================================================
// PROJECT VITAL SCAN — deterministic project health engine (SCAN-CORE v1)
//
// DESIGN CONTRACT
//  • Request-memory processing: files live in request memory only and are discarded.
//  • Deterministic: identical input bytes ⇒ identical findings & score.
//  • Evidenced: every finding cites path:line with a (redacted) snippet.
//  • Transparent: thresholds and weights are published here in code.
// ===================================================================

import crypto from "node:crypto";
import zlib from "node:zlib";

export const SCAN_VERSION = "1.0.0";
export const BENCHMARK = 100; // clean-bill benchmark; deltas are measured against it

const MAX_FILES = 300; //           hard intake caps — keep the free 24/7 service fast
const MAX_TOTAL_BYTES = 16 * 1024 * 1024; // decompressed
const MAX_FILE_BYTES = 512 * 1024; // per file
const EVIDENCE_CAP = 5; //            per finding — show worst offenders, avoid wall of noise

// -------------------------------------------------------------------
// minimal ZIP container reader (stored + deflate; node:zlib pure)
// -------------------------------------------------------------------
export interface ZipEntry {
  path: string;
  data: Buffer;
}

export function unzip(buf: Buffer, capBytes = MAX_TOTAL_BYTES): ZipEntry[] {
  // locate End Of Central Directory
  let eocd = -1;
  const from = Math.max(0, buf.length - (65536 + 22));
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive (EOCD missing)");

  const cdCount = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let total = 0;

  for (let k = 0; k < cdCount && cd < buf.length - 46; k++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const rawSize = buf.readUInt32LE(cd + 24);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString("utf8", cd + 46, cd + 46 + nameLen);
    cd += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (entries.length >= MAX_FILES) break;
    total += rawSize;
    if (total > capBytes) throw new Error("Archive exceeds the 16 MB scan budget");
    if (rawSize > MAX_FILE_BYTES) continue; // skip oversized payloads silently

    // local header → data slice
    const ln = buf.readUInt16LE(localOff + 26);
    const lx = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + ln + lx;
    const slice = buf.subarray(start, start + compSize);

    let data: Buffer | null = null;
    if (method === 0) data = Buffer.from(slice);
    else if (method === 8)
      try {
        data = zlib.inflateRawSync(slice);
      } catch {
        data = null;
      }
    if (data) entries.push({ path: name.replace(/\\/g, "/"), data });
  }
  return entries;
}

// -------------------------------------------------------------------
// language census
// -------------------------------------------------------------------
const LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", rb: "Ruby", php: "PHP", go: "Go", rs: "Rust",
  java: "Java", kt: "Kotlin", cs: "C#", c: "C", h: "C/C++ Header", cpp: "C++",
  hpp: "C++", swift: "Swift", scala: "Scala", sql: "SQL", sh: "Shell",
  bash: "Shell", ps1: "PowerShell", html: "HTML", css: "CSS", scss: "SCSS",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML",
  md: "Markdown", vue: "Vue", svelte: "Svelte", dart: "Dart", lua: "Lua",
  r: "R", lua5: "Lua", pl: "Perl", ex: "Elixir", hs: "Haskell", clj: "Clojure",
};

const CODE_EXTS = new Set([
  "ts", "tsx", "mts", "js", "jsx", "mjs", "cjs", "py", "rb", "php", "go", "rs",
  "java", "kt", "cs", "c", "h", "cpp", "hpp", "swift", "scala", "sql", "sh",
  "html", "css", "scss", "vue", "svelte", "dart", "lua", "ex", "hs", "clj",
]);

function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// -------------------------------------------------------------------
// pattern banks — every rule is plain, auditable Regular Expression
// -------------------------------------------------------------------
interface Pattern {
  id: string;
  re: RegExp;
  note: string;
  critical?: boolean;
}

const SECRET_PATTERNS: Pattern[] = [
  { id: "stripe-live", re: /\bsk_live_[A-Za-z0-9]{16,}/, note: "Stripe live secret key", critical: true },
  { id: "stripe-test", re: /\bsk_test_[A-Za-z0-9]{16,}/, note: "Stripe test key" },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/, note: "AWS access key ID", critical: true },
  { id: "google-api", re: /\bAIza[0-9A-Za-z_\-]{35}\b/, note: "Google API key", critical: true },
  { id: "github-token", re: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{22,}/, note: "GitHub token", critical: true },
  { id: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, note: "Embedded private key", critical: true },
  { id: "generic-secret", re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'`][A-Za-z0-9_\-\.]{16,}["'`]/i, note: "Hardcoded credential literal", critical: true },
  { id: "password-literal", re: /\b(password|passwd|pwd)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i, note: "Hardcoded password literal", critical: true },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/, note: "Embedded JWT" },
];

const DANGER_PATTERNS: Pattern[] = [
  { id: "eval", re: /\beval\s*\(/, note: "eval() dynamic code execution" },
  { id: "new-function", re: /new\s+Function\s*\(/, note: "Function constructor — eval equivalent" },
  { id: "innerhtml", re: /\.innerHTML\s*=/, note: "Unsanitised innerHTML assignment (XSS surface)" },
  { id: "document-write", re: /\bdocument\.write\s*\(/, note: "document.write (injection surface)" },
  { id: "os-system", re: /\bos\.system\s*\(/, note: "os.system shell call" },
  { id: "shell-true", re: /subprocess\.[a-z]+\([^)]*shell\s*=\s*True/, note: "subprocess with shell=True" },
  { id: "pickle", re: /\bpickle\.loads?\s*\(/, note: "pickle.load on untrusted bytes (RCE risk)" },
  { id: "exec-js", re: /require\(\s*["']child_process["']\s*\)\.exec\s*\(/, note: "child_process.exec shell call" },
  { id: "sql-concat", re: /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b[^\n]*?\+\s*\w/i, note: "SQL string concatenation (injection risk)" },
  { id: "yaml-load", re: /\byaml\.load\s*\((?![^)]*SafeLoader)/, note: "yaml.load without SafeLoader" },
];

const DEBUG_RES: Record<string, RegExp> = {
  js: /\bconsole\.(log|debug|info)\s*\(/g,
  py: /^\s*print\s*\(/gm,
  go: /\bfmt\.Print(ln|f)?\s*\(/g,
  rb: /\bputs\s+/g,
};

// -------------------------------------------------------------------
// measurement primitives (pure, deterministic)
// -------------------------------------------------------------------
export interface ScannedFile {
  path: string;
  lang: string;
  bytes: number;
  lines: number;
  text: string;
  maxLine: number;
  longLines: number; //        > 120 chars
  todos: { line: number; tag: string }[];
  maxNesting: number;
  avgNesting: number;
  longestFunction: number; //  lines in longest function body (brace languages)
  comments: number;
  codeLines: number;
  debugCount: number;
  findings: { rule: string; line: number; snippet: string }[];
}

const commentRe: Record<string, RegExp> = {
  slash: /^\s*(\/\/|\/\*|\*|<!--)/,
  hash: /^\s*#/,
};

export function measureFile(path: string, data: Buffer): ScannedFile {
  const ext = extOf(path);
  const language = LANG_BY_EXT[ext] ?? (ext ? ext.toUpperCase() : "Text");
  const text = data.toString("utf8").replace(/\r\n/g, "\n");
  const rawLines = text.split("\n");

  let maxLine = 0;
  let longLines = 0;
  let comments = 0;
  let codeLines = 0;
  const todos: { line: number; tag: string }[] = [];
  const findings: ScannedFile["findings"] = [];

  const slash = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "swift", "kt", "scala", "dart", "html", "css", "scss", "vue", "svelte"].includes(ext);
  const hash = ["py", "rb", "sh", "bash", "yaml", "yml", "toml", "pl", "r"].includes(ext);
  const cRe = slash ? commentRe.slash : hash ? commentRe.hash : null;
  const indentBased = ext === "py";

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const n = idx + 1;
    maxLine = Math.max(maxLine, line.length);
    if (line.length > 120) longLines++;
    if (cRe?.test(line)) comments++;
    if (line.trim()) codeLines++;

    const todo = /\b(TODO|FIXME|HACK|XXX)\b/.exec(line);
    if (todo && todos.length < 200) todos.push({ line: n, tag: todo[1] });
  }

  // nesting depth: indentation for Python, running brace depth otherwise
  let maxNesting = 0;
  let avgNesting = 0;
  if (CODE_EXTS.has(ext)) {
    const depths: number[] = [];
    if (indentBased) {
      for (const line of rawLines) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const d = Math.floor(/^\s*/.exec(line)![0].replace(/\t/g, "    ").length / 4);
        depths.push(d);
      }
    } else {
      let depth = 0;
      for (const line of rawLines) {
        for (const ch of line) {
          if (ch === "{") depth++;
          if (ch === "}") depth = Math.max(0, depth - 1);
        }
        if (line.trim()) depths.push(depth);
      }
    }
    maxNesting = depths.length ? Math.max(...depths) : 0;
    avgNesting = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
  }

  // pattern sweeps (secrets + dangerous APIs)
  const sweeps = [...SECRET_PATTERNS, ...DANGER_PATTERNS];
  rawLines.forEach((line, idx) => {
    for (const p of sweeps) {
      if (p.re.test(line)) {
        findings.push({
          rule: `${p.critical ? "[CRITICAL] " : ""}${p.note}`,
          line: idx + 1,
          snippet: redact(line.trim()),
        });
      }
    }
  });

  // debug leftovers
  const dbg = DEBUG_RES[ext === "tsx" || ext === "jsx" || ext === "mts" || ext === "cjs" || ext === "mjs" ? "js" : ext];
  let debugCount = 0;
  if (dbg) debugCount = (text.match(dbg) || []).length;

  // longest function-ish block (brace languages only, cheap heuristic):
  let longestFunction = 0;
  if (!indentBased && CODE_EXTS.has(ext)) {
    let start = -1, startDepth = 0, depth = 0;
    rawLines.forEach((line, idx) => {
      const fnHead = /(function\s+\w+|\w+\s*\([^)]*\)\s*(:\s*[\w<>\[\]| ]+)?\s*\{|=>|def\s+\w+|fn\s+\w+|func\s+\w+|void\s+\w+|public\s+\w+|private\s+\w+)/.test(line);
      let opened = false;
      for (const ch of line) {
        if (ch === "{") { depth++; if (fnHead && start < 0) { start = idx; startDepth = depth; opened = true; } }
        if (ch === "}") {
          depth = Math.max(0, depth - 1);
          if (start >= 0 && depth < startDepth) {
            longestFunction = Math.max(longestFunction, idx - start + 1);
            start = -1; startDepth = 0;
          }
        }
      }
      void opened;
    });
  } else if (indentBased) {
    // python: def-block length via indentation
    let defStart = -1, defIndent = 0;
    rawLines.forEach((line, idx) => {
      const m = /^(\s*)def\s+/.exec(line);
      if (m) {
        if (defStart >= 0) longestFunction = Math.max(longestFunction, idx - defStart);
        defStart = idx; defIndent = m[1].length;
      } else if (defStart >= 0 && line.trim() && /^\s*/.exec(line)![0].length <= defIndent && !/^\s*(#|$)/.test(line)) {
        longestFunction = Math.max(longestFunction, idx - defStart);
        defStart = -1;
      }
    });
    if (defStart >= 0) longestFunction = Math.max(longestFunction, rawLines.length - defStart);
  }

  return {
    path, lang: language, bytes: data.length, lines: rawLines.length, text, maxLine, longLines,
    todos, maxNesting, avgNesting, longestFunction, comments, codeLines, debugCount, findings,
  };
}

function redact(s: string): string {
  // never echo a secret — show shape + suffix only
  return s
    .replace(/(sk_live_|sk_test_|AKIA|AIza|ghp_|gho_|ghs_|ghr_|github_pat_|eyJ)[A-Za-z0-9_\-\.]{6,}/g, "$1•••REDACTED")
    .replace(/(["'`])[A-Za-z0-9_\-\.]{12,}(["'`])/g, "$1•••REDACTED$2")
    .slice(0, 90);
}

// -------------------------------------------------------------------
// duplication — 5-line normalised shingles, hashed
// -------------------------------------------------------------------
export function duplicationRatio(files: ScannedFile[]): { ratio: number; dupBlocks: number; totalBlocks: number } {
  const seen = new Map<string, string>(); // hash → first path
  let dup = 0, total = 0;
  for (const f of files) {
    if (!CODE_EXTS.has(extOf(f.path))) continue;
    const norm = f.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 8 && !/^(\/\/|#|\/\*|\*)/.test(l));
    for (let i = 0; i + 5 <= norm.length; i++) {
      total++;
      const shingle = norm.slice(i, i + 5).join("\n");
      const h = crypto.createHash("sha1").update(shingle).digest("hex");
      if (seen.has(h) && seen.get(h) !== f.path) dup++;
      else seen.set(h, f.path);
    }
  }
  return { ratio: total ? dup / total : 0, dupBlocks: dup, totalBlocks: total };
}

// -------------------------------------------------------------------
// report model + scoring
// -------------------------------------------------------------------
export interface Finding {
  severity: "critical" | "warning" | "note";
  rule: string;
  where: string; // path:line
  snippet: string;
  suggestion: string;
}

export interface CheckResult {
  key: string;
  title: string;
  weight: number;
  measured: string;
  threshold: string;
  ratio: number; // 1 pass · 0.5 warn · 0 fail
  status: "pass" | "warn" | "fail";
  suggestion?: string;
}

export interface ScanReport {
  scanId: string;
  version: string;
  timestampUtc: string;
  durationMs: number;
  sha256: string;
  retention: "zero — analyzed in memory, nothing persisted";
  stats: {
    files: number; analyzedFiles: number; skippedBinary: number;
    totalBytes: number; totalLines: number;
    languages: { lang: string; files: number; bytes: number }[];
  };
  checks: CheckResult[];
  findings: Finding[];
  score: number;
  benchmark: number;
  benchmarkDelta: number; // negative = below benchmark
  grade: "A" | "B" | "C" | "D" | "F";
  verdict: string;
}

function gradeOf(score: number): ScanReport["grade"] {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
}

export function buildReport(labelFiles: { path: string; data: Buffer }[]): ScanReport {
  const t0 = Date.now();

  // fingerprint the exact byte set scanned (path + bytes, order-independent)
  const fp = crypto
    .createHash("sha256")
    .update(labelFiles.map((f) => f.path + "\0" + crypto.createHash("sha256").update(f.data).digest("hex")).sort().join("\n"))
    .digest("hex");

  const measured: ScannedFile[] = [];
  let skippedBinary = 0, totalBytes = 0, totalLines = 0;

  for (const f of labelFiles) {
    if (measured.length >= MAX_FILES) break;
    if (f.data.length > MAX_FILE_BYTES) continue;
    if (isBinary(f.data)) { skippedBinary++; continue; }
    totalBytes += f.data.length;
    if (totalBytes > MAX_TOTAL_BYTES) break;
    const m = measureFile(f.path, f.data);
    measured.push(m);
    totalLines += m.lines;
  }

  const langMap = new Map<string, { files: number; bytes: number }>();
  for (const m of measured) {
    const row = langMap.get(m.lang) ?? { files: 0, bytes: 0 };
    row.files++; row.bytes += m.bytes;
    langMap.set(m.lang, row);
  }
  const languages = [...langMap.entries()]
    .map(([lang, v]) => ({ lang, ...v }))
    .sort((a, b) => b.bytes - a.bytes);

  // aggregate measurements
  const codeFiles = measured.filter((m) => CODE_EXTS.has(extOf(m.path)));
  const findings: Finding[] = [];
  for (const m of measured) {
    for (const f of m.findings) {
      const critical = f.rule.startsWith("[CRITICAL]");
      findings.push({
        severity: critical ? "critical" : "warning",
        rule: f.rule.replace(/^\[CRITICAL\] /, ""),
        where: `${m.path}:${f.line}`,
        snippet: f.snippet,
        suggestion: critical
          ? "Rotate this credential immediately, remove it from source, move it to environment/secret storage, and purge it from version history. Consult your developer or security advisor before redeploying."
          : "Refactor away from this pattern — prefer safe APIs (parsers, template encoding, parameterised calls). Your developer can swap this in minutes.",
      });
    }
  }
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  const secretCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.length - secretCount;
  const debugCount = measured.reduce((a, m) => a + m.debugCount, 0);
  const todoCount = measured.reduce((a, m) => a + m.todos.length, 0);
  const longLineTotal = measured.reduce((a, m) => a + m.longLines, 0);
  const commentTotal = measured.reduce((a, m) => a + m.comments, 0);
  const codeLineTotal = measured.reduce((a, m) => a + m.codeLines, 0);
  const maxNesting = Math.max(0, ...codeFiles.map((m) => m.maxNesting));
  const avgNesting = codeFiles.length ? codeFiles.reduce((a, m) => a + m.avgNesting * m.codeLines, 0) / Math.max(1, codeLineTotal) : 0;
  const longestFunction = Math.max(0, ...codeFiles.map((m) => m.longestFunction));
  const dup = duplicationRatio(measured);

  const lc = measured.map((m) => m.path.toLowerCase());
  const hasReadme = lc.some((p) => /(^|\/)readme(\.[a-z]+)?$/.test(p));
  const hasLicense = lc.some((p) => /(^|\/)(licen[cs]e|copying)(\.[a-z]+)?$/.test(p));
  const hasGitignore = lc.some((p) => /(^|\/)\.gitignore$/.test(p));
  const hasManifest = lc.some((p) => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle|composer\.json)$/.test(p));
  const hasTests = lc.some((p) => /(__tests__|\/tests?\/|\.(test|spec)\.[a-z]+$|test_[a-z0-9_]+\.py$|_test\.go$)/.test(p));
  const hasLockfile = lc.some((p) => /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|cargo\.lock|go\.sum)/.test(p));

  const hygieneHits = [hasReadme, hasLicense, hasGitignore, hasManifest, hasLockfile].filter(Boolean).length;

  const debugRate = codeLineTotal ? debugCount / (codeLineCount(codeFiles)) : 0;
  const todoRate = codeLineTotal ? todoCount / (codeLineCount(codeFiles)) : 0;
  const longLineRate = totalLines ? longLineTotal / totalLines : 0;
  const commentRate = codeLineTotal ? commentTotal / codeLineTotal : 0;

  const checks: CheckResult[] = [
    {
      key: "secret-exposure",
      title: "Secret & credential exposure",
      weight: 20,
      measured: secretCount === 0 ? "0 exposed credentials" : `${secretCount} exposed credential(s)`,
      threshold: "0 credential literals",
      ratio: secretCount === 0 ? 1 : 0,
      status: secretCount === 0 ? "pass" : "fail",
      suggestion: secretCount
        ? "Rotate every exposed key today — treat them as compromised. Move secrets to environment variables or a vault; scrub history. Consult your developer/security advisor immediately."
        : undefined,
    },
    {
      key: "dangerous-apis",
      title: "Dangerous API usage",
      weight: 10,
      measured: `${warningCount} risky call site(s)`,
      threshold: "0 risky calls",
      ratio: warningCount === 0 ? 1 : warningCount <= 2 ? 0.5 : 0,
      status: warningCount === 0 ? "pass" : warningCount <= 2 ? "warn" : "fail",
      suggestion: warningCount ? "Replace with safe equivalents (JSON.parse, textContent, parameterised queries, safe-deserializers)." : undefined,
    },
    {
      key: "debug-leftovers",
      title: "Debug leftovers (console/print)",
      weight: 8,
      measured: `${debugCount} call(s) · ${(debugRate * 100).toFixed(2)}% of code lines`,
      threshold: "≤ 0.5% of code lines",
      ratio: debugRate <= 0.005 ? 1 : debugRate <= 0.02 ? 0.5 : 0,
      status: debugRate <= 0.005 ? "pass" : debugRate <= 0.02 ? "warn" : "fail",
      suggestion: debugRate > 0.005 ? "Gate logging behind a logger with levels; strip console/print before ship." : undefined,
    },
    {
      key: "todo-debt",
      title: "TODO/FIXME debt",
      weight: 7,
      measured: `${todoCount} marker(s) · ${(todoRate * 100).toFixed(2)}% of code lines`,
      threshold: "≤ 0.5% of code lines",
      ratio: todoRate <= 0.005 ? 1 : todoRate <= 0.015 ? 0.5 : 0,
      status: todoRate <= 0.005 ? "pass" : todoRate <= 0.015 ? "warn" : "fail",
      suggestion: todoRate > 0.005 ? "Convert markers into tracked issues or resolve them before release." : undefined,
    },
    {
      key: "duplication",
      title: "Copy-paste duplication",
      weight: 10,
      measured: `${(dup.ratio * 100).toFixed(2)}% of ${dup.totalBlocks} 5-line blocks repeat across files`,
      threshold: "≤ 3% repeated blocks",
      ratio: dup.ratio <= 0.03 ? 1 : dup.ratio <= 0.08 ? 0.5 : 0,
      status: dup.ratio <= 0.03 ? "pass" : dup.ratio <= 0.08 ? "warn" : "fail",
      suggestion: dup.ratio > 0.03 ? "Extract shared logic into common modules/functions; duplication ages badly under change." : undefined,
    },
    {
      key: "nesting-complexity",
      title: "Nesting complexity",
      weight: 10,
      measured: `avg ${fmt(avgNesting)} · max ${maxNesting} levels`,
      threshold: "avg ≤ 2.5 · max ≤ 6",
      ratio: avgNesting <= 2.5 && maxNesting <= 6 ? 1 : avgNesting <= 3.5 && maxNesting <= 8 ? 0.5 : 0,
      status: avgNesting <= 2.5 && maxNesting <= 6 ? "pass" : avgNesting <= 3.5 && maxNesting <= 8 ? "warn" : "fail",
      suggestion: avgNesting > 2.5 ? "Flatten with early returns, guard clauses and extraction — deep nesting hides bugs." : undefined,
    },
    {
      key: "function-length",
      title: "Longest function body",
      weight: 8,
      measured: longestFunction ? `${longestFunction} lines` : "none detected",
      threshold: "≤ 80 lines (warn ≥ 60)",
      ratio: longestFunction <= 60 ? 1 : longestFunction <= 80 ? 0.5 : 0,
      status: longestFunction <= 60 ? "pass" : longestFunction <= 80 ? "warn" : "fail",
      suggestion: longestFunction > 60 ? "Split long functions by responsibility; aim for single-idea units." : undefined,
    },
    {
      key: "line-length",
      title: "Line length discipline",
      weight: 4,
      measured: `${longLineTotal} line(s) > 120 chars (${(longLineRate * 100).toFixed(2)}%)`,
      threshold: "≤ 2% of lines",
      ratio: longLineRate <= 0.02 ? 1 : longLineRate <= 0.06 ? 0.5 : 0,
      status: longLineRate <= 0.02 ? "pass" : longLineRate <= 0.06 ? "warn" : "fail",
      suggestion: longLineRate > 0.02 ? "Wrap long lines — readability is maintainability." : undefined,
    },
    {
      key: "comment-density",
      title: "Comment density",
      weight: 4,
      measured: `${(commentRate * 100).toFixed(1)}% of code lines`,
      threshold: "5% – 30%",
      ratio: commentRate >= 0.05 && commentRate <= 0.3 ? 1 : commentRate > 0.02 ? 0.5 : 0,
      status: commentRate >= 0.05 && commentRate <= 0.3 ? "pass" : commentRate > 0.02 ? "warn" : "fail",
      suggestion: commentRate < 0.05 ? "Document intent at hard seams; future-you is the first user." : undefined,
    },
    {
      key: "project-hygiene",
      title: "Project hygiene files",
      weight: 10,
      measured: `${hygieneHits}/5 present · ${[hasReadme, hasLicense, hasGitignore, hasManifest, hasLockfile]
        .map((v, i) => `${["README", "LICENSE", ".gitignore", "manifest", "lockfile"][i]}:${v ? "✓" : "✗"}`)
        .join(", ")}`,
      threshold: "README · LICENSE · .gitignore · manifest · lockfile",
      ratio: hygieneHits >= 4 ? 1 : hygieneHits >= 2 ? 0.5 : 0,
      status: hygieneHits >= 4 ? "pass" : hygieneHits >= 2 ? "warn" : "fail",
      suggestion: hygieneHits < 4 ? "Add the missing hygiene files — README explains the project, LICENSE makes it legal, lockfile makes it reproducible." : undefined,
    },
    {
      key: "tests",
      title: "Automated test presence",
      weight: 9,
      measured: hasTests ? "test files detected" : "no test files detected",
      threshold: "test suite present",
      ratio: hasTests ? 1 : 0,
      status: hasTests ? "pass" : "fail",
      suggestion: hasTests ? undefined : "Introduce a minimal test suite (happy path + one edge case) — ask your developer to start with the riskiest module.",
    },
  ];

  const finalScore = Math.round(checks.reduce((a, c) => a + c.weight * c.ratio, 0) * 10) / 10;
  const delta = Math.round((finalScore - BENCHMARK) * 10) / 10;

  const verdict =
    finalScore >= 90
      ? "Production-grade discipline. Maintained, guarded, and ship-ready."
      : finalScore >= 70
      ? "Healthy core with fixable surface issues. Work the WARN rows top-down."
      : finalScore >= 50
      ? "Material risks found. Resolve CRITICAL findings before any deployment."
      : "Critical remediation required. Do not deploy; treat exposed secrets as compromised now.";

  return {
    scanId: fp.slice(0, 12),
    version: SCAN_VERSION,
    timestampUtc: new Date().toISOString(),
    durationMs: Date.now() - t0,
    sha256: fp,
    retention: "zero — analyzed in memory, nothing persisted",
    stats: {
      files: labelFiles.length,
      analyzedFiles: measured.length,
      skippedBinary,
      totalBytes,
      totalLines,
      languages,
    },
    // evidence-limited findings (worst first)
    findings: findings.slice(0, 60),
    checks: checks.map((c) => ({ ...c })),
    score: finalScore,
    benchmark: BENCHMARK,
    benchmarkDelta: delta,
    grade: gradeOf(finalScore),
    verdict,
  };
}

function codeLineCount(files: ScannedFile[]): number {
  return Math.max(1, files.reduce((a, m) => a + m.codeLines, 0));
}
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}
