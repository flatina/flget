import { runProcess } from "./process";

export async function runGit(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess(["git", ...args], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}
