// CODE SANDBOX - run a script in a throwaway, locked-down container.
//
// Who may call it is decided by the route (operator or a signed project key); this module only
// decides HOW code runs. Every run is its own container:
//   no network, read-only filesystem, a small noexec tmpfs, all capabilities dropped, no privilege
//   gain, an unprivileged user, and hard caps on memory, CPU, processes, time and output.
// The code goes in on stdin, so nothing from the request ever becomes part of a command line.
// The images must already be on the host (`--pull never`): a run can never download anything.
// Off unless SG16_SANDBOX_ENABLED=1.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export type Language = "python" | "node";

export const LANGUAGES: Record<Language, { image: string; cmd: string[] }> = {
  python: { image: process.env.SG16_SANDBOX_PYTHON_IMAGE?.trim() || "python:3.12-alpine", cmd: ["python", "-I", "-"] },
  node: { image: process.env.SG16_SANDBOX_NODE_IMAGE?.trim() || "node:22-alpine", cmd: ["node", "-"] },
};

export const MAX_CODE_BYTES = 32 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 30_000;

export const sandboxEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.SG16_SANDBOX_ENABLED === "1";

export function isLanguage(x: unknown): x is Language {
  return x === "python" || x === "node";
}

/** The exact `docker` arguments for one run. Pure, so the safety flags can be tested. */
export function dockerArgs(language: Language, name: string): string[] {
  const { image, cmd } = LANGUAGES[language];
  return [
    "run", "--rm", "-i", "--pull", "never",
    "--name", name,
    "--network", "none",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "64",
    "--memory", "128m", "--memory-swap", "128m",
    "--cpus", "0.5",
    "--ulimit", "nofile=64:64",
    "--ulimit", "fsize=8388608",
    "--user", "65534:65534",
    "-e", "HOME=/tmp",
    "-w", "/tmp",
    image, ...cmd,
  ];
}

export type RunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  ms: number;
  error?: string;
};

export type RunDeps = {
  spawn?: (cmd: string, args: string[]) => ChildProcess;
  /** best-effort kill of the container by name (the docker client dying does not stop it) */
  kill?: (name: string) => void;
};

const defaultKill = (name: string) => {
  try {
    nodeSpawn("docker", ["kill", name], { stdio: "ignore" }).on("error", () => undefined);
  } catch {
    // docker missing: nothing was running
  }
};

export function validate(language: unknown, code: unknown): string | null {
  if (!isLanguage(language)) return 'language must be "python" or "node"';
  if (typeof code !== "string" || !code.trim()) return "code is required";
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) return `code is too large (${MAX_CODE_BYTES / 1024} KB limit)`;
  return null;
}

export async function runInSandbox(
  language: Language,
  code: string,
  opts: { timeoutMs?: number } = {},
  deps: RunDeps = {},
): Promise<RunResult> {
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const name = `sg16-run-${randomUUID()}`;
  const spawn = deps.spawn ?? ((c, a) => nodeSpawn(c, a, { stdio: ["pipe", "pipe", "pipe"] }));
  const kill = deps.kill ?? defaultKill;
  const started = Date.now();

  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn("docker", dockerArgs(language, name));
    } catch (err) {
      resolve({ ok: false, exitCode: null, stdout: "", stderr: "", timedOut: false, truncated: false, ms: 0, error: (err as Error).message });
      return;
    }
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const take = (current: string, chunk: Buffer): string => {
      const room = MAX_OUTPUT_BYTES - Buffer.byteLength(current);
      if (room <= 0) {
        truncated = true;
        return current;
      }
      const text = chunk.toString("utf8");
      if (Buffer.byteLength(text) > room) truncated = true;
      return current + text.slice(0, room);
    };
    const finish = (r: Partial<RunResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: r.exitCode === 0 && !timedOut && !r.error,
        exitCode: null,
        stdout, stderr, timedOut, truncated,
        ms: Date.now() - started,
        ...r,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill(name);
      child.kill("SIGKILL");
      finish({ exitCode: null });
    }, timeoutMs);

    child.stdout?.on("data", (c: Buffer) => {
      stdout = take(stdout, c);
      if (truncated) {
        kill(name);
        child.kill("SIGKILL");
        finish({ exitCode: null });
      }
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr = take(stderr, c);
    });
    child.on("error", (err) =>
      finish({ error: /ENOENT/.test(err.message) ? "docker is not installed on this host" : err.message }),
    );
    child.on("close", (code) => finish({ exitCode: code }));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(code);
  });
}
