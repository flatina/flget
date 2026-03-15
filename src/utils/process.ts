import { spawnProcess } from "./runtime";

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
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

  const process = spawnProcess(spawnOptions);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${exitCode}): ${stderr.trim() || stdout.trim() || "unknown error"}`);
  }

  return { stdout, stderr };
}
