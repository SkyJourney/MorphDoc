import { spawn } from "node:child_process";

export type PandocProcessOutcome =
  | "completed"
  | "not-found"
  | "not-executable"
  | "timeout"
  | "aborted"
  | "output-limit";

export interface PandocProcessResult {
  outcome: PandocProcessOutcome;
  exitCode: number | null;
  stdout: Uint8Array;
  stderr: string;
}

export interface PandocProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
}

export type PandocProcessRunner = (
  executablePath: string,
  arguments_: readonly string[],
  options: PandocProcessOptions
) => Promise<PandocProcessResult>;

function decodeStderr(chunks: Buffer[]) {
  return Buffer.concat(chunks).toString("utf8");
}

export const runPandocProcess: PandocProcessRunner = (
  executablePath,
  arguments_,
  options
) =>
  new Promise((resolve) => {
    const child = spawn(executablePath, [...arguments_], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let forcedOutcome: PandocProcessOutcome | undefined;

    const settle = (
      outcome: PandocProcessOutcome,
      exitCode: number | null
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        outcome,
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: decodeStderr(stderr)
      });
    };
    const stop = (outcome: PandocProcessOutcome) => {
      if (settled || forcedOutcome) {
        return;
      }
      forcedOutcome = outcome;
      child.kill();
    };
    const abort = () => stop("aborted");
    const timeout = setTimeout(
      () => stop("timeout"),
      options.timeoutMs
    );
    timeout.unref();

    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, {
        once: true
      });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maxStdoutBytes) {
        stop("output-limit");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > options.maxStderrBytes) {
        stop("output-limit");
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      const outcome =
        error.code === "ENOENT"
          ? "not-found"
          : error.code === "EACCES" || error.code === "EPERM"
            ? "not-executable"
            : "not-executable";
      settle(outcome, null);
    });
    child.on("close", (exitCode) => {
      settle(forcedOutcome ?? "completed", exitCode);
    });
  });
