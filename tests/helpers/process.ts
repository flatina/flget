export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function inheritedEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    ...extra,
  };
}

export async function runProcess(cmd: string[], cwd?: string, env?: Record<string, string>): Promise<ProcessResult> {
  const options: {
    cmd: string[];
    cwd?: string;
    env: Record<string, string>;
    stdout: "pipe";
    stderr: "pipe";
  } = {
    cmd,
    env: inheritedEnv(env),
    stdout: "pipe",
    stderr: "pipe",
  };
  if (cwd) {
    options.cwd = cwd;
  }

  const proc = Bun.spawn(options);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

export async function runChecked(cmd: string[], cwd?: string, env?: Record<string, string>): Promise<ProcessResult> {
  const result = await runProcess(cmd, cwd, env);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode})\ncmd: ${cmd.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result;
}
