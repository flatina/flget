import { join, resolve } from "node:path";
import type { FlgetDirs } from "./types";
import { ensureDir, pathExists } from "../utils/fs";

export const ROOT_CONFIG_NAME = "flget.root.toml";
export const PACKAGE_META_NAME = "flget.meta.json";
export const ROOT_ENV_NAME = ".env";
export const ROOT_SECRETS_DIR_NAME = ".secrets";
export const ROOT_SHARED_SECRETS_NAME = ".env";

export function getDirs(root: string): FlgetDirs {
  const resolvedRoot = resolve(root);
  const compat = join(resolvedRoot, "compat");
  const xdg = join(resolvedRoot, "xdg");
  const flgetState = join(xdg, ".local", "state", "flget");
  const flgetCache = join(xdg, ".cache", "flget");
  const secretsDir = join(resolvedRoot, ROOT_SECRETS_DIR_NAME);
  return {
    root: resolvedRoot,
    scoop: join(resolvedRoot, "scoop"),
    npm: join(resolvedRoot, "npm"),
    ghr: join(resolvedRoot, "ghr"),
    npmgh: join(resolvedRoot, "npmgh"),
    agents: join(resolvedRoot, "agents"),
    skills: join(resolvedRoot, "agents", "skills"),
    buckets: join(resolvedRoot, "buckets"),
    shims: join(resolvedRoot, "shims"),
    staging: flgetState,
    downloads: flgetCache,
    transactions: join(flgetState, "transactions"),
    compat,
    compatLocal: join(compat, "local"),
    compatOfficial: join(compat, "official"),
    compatCommunity: join(compat, "community"),
    bunExe: join(resolvedRoot, "bun.exe"),
    cliJs: join(resolvedRoot, "flget.js"),
    cliMap: join(resolvedRoot, "flget.js.map"),
    activatePs1: join(resolvedRoot, "activate.ps1"),
    updatePs1: join(resolvedRoot, "update.ps1"),
    configFile: join(resolvedRoot, ROOT_CONFIG_NAME),
    xdgConfig: join(xdg, ".config"),
    xdgData: join(xdg, ".local", "share"),
    xdgState: join(xdg, ".local", "state"),
    xdgCache: join(xdg, ".cache"),
    envFile: join(resolvedRoot, ROOT_ENV_NAME),
    secretsDir,
    secretsFile: join(secretsDir, ROOT_SHARED_SECRETS_NAME),
  };
}

export async function ensureLayout(root: string): Promise<FlgetDirs> {
  const dirs = getDirs(root);
  await Promise.all([
    ensureDir(dirs.shims),
    ensureDir(dirs.xdgConfig),
    ensureDir(dirs.xdgData),
    ensureDir(dirs.xdgState),
    ensureDir(dirs.xdgCache),
  ]);
  return dirs;
}

export async function findFlgetRoot(startDir: string = process.cwd()): Promise<string | null> {
  let current = resolve(startDir);
  for (;;) {
    if (await pathExists(join(current, ROOT_CONFIG_NAME))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
