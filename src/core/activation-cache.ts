import { join } from "node:path";
import type { PackageMeta } from "./types";
import { getDirs } from "./dirs";
import { listWinnerPackageMetas } from "./metadata";
import { getPackageBaseRelativePath } from "./package-layout";
import { writeText } from "../utils/fs";

function toWindowsPath(segment: string): string {
  return segment.replace(/\//g, "\\");
}

function packageCurrentPath(meta: PackageMeta): string {
  return `${getPackageBaseRelativePath(meta.sourceType, meta.id)}\\current`;
}

function replaceToken(value: string, token: string, replacement: string): string {
  return value.split(token).join(replacement);
}

function expandEnvValue(root: string, meta: PackageMeta, value: string): string {
  const currentPath = join(root, packageCurrentPath(meta));
  return replaceToken(
    replaceToken(value, "${FL_ROOT}", root),
    "${FL_CURRENT}",
    currentPath,
  );
}

function collectEnvPaths(metas: PackageMeta[]): string[] {
  const entries: string[] = [];
  for (const meta of metas) {
    for (const entry of meta.envAddPath ?? []) {
      entries.push(`${packageCurrentPath(meta)}\\${toWindowsPath(entry)}`);
    }
  }
  return Array.from(new Set(entries));
}

const RESERVED_XDG_KEYS = new Set([
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
]);

function collectEnvSets(root: string, metas: PackageMeta[]): Array<[string, string]> {
  const envSet = new Map<string, string>();
  for (const meta of metas) {
    for (const [key, value] of Object.entries(meta.envSet ?? {})) {
      if (RESERVED_XDG_KEYS.has(key)) {
        console.warn(`[warn] ${meta.id}: envSet key "${key}" is reserved for root XDG policy and will be ignored.`);
        continue;
      }
      envSet.set(key, expandEnvValue(root, meta, value));
    }
  }
  return Array.from(envSet.entries());
}

function buildPathsCache(metas: PackageMeta[]): string {
  const lines = collectEnvPaths(metas);
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function buildEnvSetCache(root: string, metas: PackageMeta[]): string {
  const lines = collectEnvSets(root, metas).map(([key, value]) => `${key}=${value}`);
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

export async function refreshActivationCache(root: string): Promise<void> {
  const dirs = getDirs(root);
  const metas = await listWinnerPackageMetas(root);

  try {
    await writeText(join(dirs.staging, "cache-env-paths.txt"), buildPathsCache(metas));
    await writeText(join(dirs.staging, "cache-env-sets.txt"), buildEnvSetCache(root, metas));
  } catch {
    // Read-only roots should still allow basic shim activation from static scripts.
  }
}
