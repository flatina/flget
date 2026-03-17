import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliPath } from "./paths";
import { runProcess, type ProcessResult } from "./process";

const staticRootSource = fileURLToPath(new URL("../../github-pages/", import.meta.url));

async function copyStaticRootScripts(root: string): Promise<void> {
  const rootFiles = ["activate.ps1", "update.ps1", "REGISTER_PATH.ps1"];
  for (const name of rootFiles) {
    await copyFile(join(staticRootSource, name), join(root, name));
  }
}

export async function runCli(args: string[], cwd?: string, env?: Record<string, string>): Promise<ProcessResult> {
  const result = await runProcess([process.execPath, cliPath, ...args], cwd, env);
  if (result.exitCode !== 0) {
    throw new Error(`CLI failed (${result.exitCode})\ncmd: ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result;
}

export async function bootstrapRoot(root: string, env?: Record<string, string>): Promise<ProcessResult> {
  await mkdir(root, { recursive: true });
  await copyStaticRootScripts(root);
  return runCli(["env"], root, env);
}
