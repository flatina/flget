import { join } from "node:path";
import type { PreparedPackage } from "../core/types";
import { runCommand } from "../utils/process";
import { readRuntimeText } from "../utils/runtime";
import { detectShimType } from "../utils/strings";

export interface PackageJsonAppManifest {
  name?: string;
  version?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  funding?: unknown;
  homepage?: unknown;
  repository?: unknown;
  description?: unknown;
}

export async function readPackageJsonApp(root: string, errorContext: string): Promise<PackageJsonAppManifest> {
  const packageJsonPath = join(root, "package.json");
  const packageJsonText = await readRuntimeText(packageJsonPath).catch(() => {
    throw new Error(`package.json not found in ${errorContext}`);
  });
  return JSON.parse(packageJsonText) as PackageJsonAppManifest;
}

export function normalizePackageJsonBins(pkg: PackageJsonAppManifest): PreparedPackage["bin"] {
  if (!pkg.bin) {
    return [];
  }
  if (typeof pkg.bin === "string") {
    const name = pkg.name?.split("/").pop() ?? "app";
    return [{
      name,
      target: pkg.bin,
      type: detectShimType(pkg.bin),
    }];
  }
  return Object.entries(pkg.bin).map(([name, target]) => ({
    name,
    target,
    type: detectShimType(target),
  }));
}

export async function installPackageJsonAppDependencies(root: string, noScripts: boolean): Promise<void> {
  const bunExecutable = process.execPath;
  const ignoreScriptsArgs = noScripts ? ["--ignore-scripts"] : [];
  try {
    await runCommand([bunExecutable, "install", "--frozen-lockfile", ...ignoreScriptsArgs], {
      cwd: root,
    });
  } catch {
    await runCommand([bunExecutable, "install", ...ignoreScriptsArgs], {
      cwd: root,
    });
  }
}

export async function runPackageJsonBuild(root: string, pkg: PackageJsonAppManifest, noScripts: boolean): Promise<void> {
  if (noScripts || !pkg.scripts?.build) {
    return;
  }
  await runCommand([process.execPath, "run", "build"], { cwd: root });
}
