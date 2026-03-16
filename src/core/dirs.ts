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
  const temp = join(resolvedRoot, "tmp");
  const registriesMeta = join(temp, "registries");
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
    temp,
    downloads: join(temp, "downloads"),
    transactions: join(temp, "transactions"),
    registriesMeta,
    localRegistries: join(registriesMeta, "local"),
    officialRegistries: join(registriesMeta, "official"),
    communityRegistries: join(registriesMeta, "community"),
    bunExe: join(resolvedRoot, "bun.exe"),
    cliJs: join(resolvedRoot, "flget.js"),
    cliMap: join(resolvedRoot, "flget.js.map"),
    activatePs1: join(resolvedRoot, "activate.ps1"),
    updatePs1: join(resolvedRoot, "update.ps1"),
    registerPathPs1: join(resolvedRoot, "REGISTER_PATH.ps1"),
    configFile: join(resolvedRoot, ROOT_CONFIG_NAME),
    envFile: join(resolvedRoot, ROOT_ENV_NAME),
    secretsDir,
    secretsFile: join(secretsDir, ROOT_SHARED_SECRETS_NAME),
  };
}

export async function ensureLayout(root: string): Promise<FlgetDirs> {
  const dirs = getDirs(root);
  await Promise.all([
    ensureDir(dirs.scoop),
    ensureDir(dirs.npm),
    ensureDir(dirs.ghr),
    ensureDir(dirs.npmgh),
    ensureDir(dirs.agents),
    ensureDir(dirs.skills),
    ensureDir(dirs.buckets),
    ensureDir(dirs.shims),
    ensureDir(join(dirs.root, ROOT_SECRETS_DIR_NAME)),
    ensureDir(dirs.temp),
    ensureDir(dirs.downloads),
    ensureDir(dirs.transactions),
    ensureDir(join(dirs.localRegistries, "overrides", "npm")),
    ensureDir(join(dirs.localRegistries, "overrides", "github-release")),
    ensureDir(join(dirs.localRegistries, "overrides", "npm-github")),
    ensureDir(dirs.officialRegistries),
    ensureDir(dirs.communityRegistries),
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
