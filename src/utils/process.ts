import { spawnProcess } from "./runtime";

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

function currentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export async function runCommand(cmd: string[], options: RunCommandOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const spawnOptions: {
    cmd: string[];
    cwd?: string;
    env: Record<string, string>;
    stdout: "pipe";
    stderr: "pipe";
  } = {
    cmd,
    env: {
      ...currentEnv(),
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  };
  if (options.cwd) {
    spawnOptions.cwd = options.cwd;
  }

  const proc = spawnProcess(spawnOptions);

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeout) {
    timer = setTimeout(() => { timedOut = true; proc.kill(); }, options.timeout);
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (timer) clearTimeout(timer);

  if (timedOut) {
    throw new Error(`Command timed out after ${options.timeout}ms: ${cmd[0]}`);
  }

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${exitCode}): ${stderr.trim() || stdout.trim() || "unknown error"}`);
  }

  return { stdout, stderr };
}
