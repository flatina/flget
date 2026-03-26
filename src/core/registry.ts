import { join } from "node:path";
import { readFile, rename } from "node:fs/promises";
import type { FlgetConfig, RegistryOverride, RuntimeContext, SourceType } from "./types";
import { ensureDir, pathExists } from "../utils/fs";
import { getDirs } from "./dirs";
import { parseToml, readRuntimeText, scanGlob } from "../utils/runtime";
import { slugify } from "../utils/strings";
import { getGitHubHeaders, getDefaultBranchHead, getTarballUrl } from "./github";
import { parseGitHubRepoUrl } from "./github-url";
import { downloadToStore } from "./download";

function buildOverrideFileName(parts: string[]): string {
  return `${parts.map((part) => slugify(part)).join("--")}.toml`;
}

async function readOverride(path: string): Promise<RegistryOverride> {
  return parseToml(await readRuntimeText(path)) as RegistryOverride;
}

function registryTarballName(url: string): string {
  return `${slugify(url.replace(/^https?:\/\//i, "").replace(/\.git$/i, ""))}.tar.gz`;
}

// Load override from tarball by entry path
const registryTarballCache = new Map<string, Promise<Map<string, string>>>();

async function loadTarballEntries(tarballPath: string): Promise<Map<string, string>> {
  const cached = registryTarballCache.get(tarballPath);
  if (cached) return cached;

  const task = (async () => {
    const entries = new Map<string, string>();
    const bytes = await readFile(tarballPath);
    const archive = new Bun.Archive(bytes);
    const files: Map<string, Blob> = await archive.files();

    for (const [name, blob] of files) {
      if (!name.endsWith(".toml")) continue;
      const normalizedPath = name.replace(/\\/g, "/");
      const overridesIdx = normalizedPath.indexOf("overrides/");
      if (overridesIdx >= 0) {
        const relativePath = normalizedPath.slice(overridesIdx);
        entries.set(relativePath, await blob.text());
      }
    }
    return entries;
  })();

  registryTarballCache.set(tarballPath, task);
  return task;
}

async function readOverrideFromTarball(tarballPath: string, sourceType: SourceType, fileName: string): Promise<RegistryOverride | null> {
  const entries = await loadTarballEntries(tarballPath);
  const key = `overrides/${sourceType}/${fileName}`;
  const content = entries.get(key);
  if (!content) return null;
  return parseToml(content) as RegistryOverride;
}

async function findOverrideInRegistries(
  root: string,
  sourceType: SourceType,
  fileName: string,
  useLocalOverrides: boolean,
): Promise<RegistryOverride | null> {
  const dirs = getDirs(root);

  // 1. Local overrides (directory-based, user-editable)
  if (useLocalOverrides) {
    const localPath = join(dirs.compatLocal, "overrides", sourceType, fileName);
    if (await pathExists(localPath)) {
      return readOverride(localPath);
    }
  }

  // 2. Official registries (tarball-based)
  if (await pathExists(dirs.compatOfficial)) {
    for (const entry of await scanGlob("*.tar.gz", dirs.compatOfficial)) {
      const tarballPath = join(dirs.compatOfficial, entry);
      const result = await readOverrideFromTarball(tarballPath, sourceType, fileName);
      if (result) return result;
    }
  }

  // 3. Community registries (tarball-based)
  if (await pathExists(dirs.compatCommunity)) {
    for (const entry of await scanGlob("*.tar.gz", dirs.compatCommunity)) {
      const tarballPath = join(dirs.compatCommunity, entry);
      const result = await readOverrideFromTarball(tarballPath, sourceType, fileName);
      if (result) return result;
    }
  }

  return null;
}

export async function loadOverride(
  root: string,
  sourceType: SourceType,
  owner: string,
  repo: string,
  useLocalOverrides: boolean = true,
): Promise<RegistryOverride | null> {
  return findOverrideInRegistries(root, sourceType, buildOverrideFileName([owner, repo]), useLocalOverrides);
}

export async function loadNamedOverride(
  root: string,
  sourceType: SourceType,
  name: string,
  useLocalOverrides: boolean = true,
): Promise<RegistryOverride | null> {
  const normalized = name.startsWith("@") ? name.slice(1) : name;
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return findOverrideInRegistries(root, sourceType, buildOverrideFileName(parts), useLocalOverrides);
}

export function listConfiguredRegistries(config: FlgetConfig): Array<{ scope: "official" | "community"; url: string }> {
  return [
    ...config.compatRegistries.official.map((url) => ({ scope: "official" as const, url })),
    ...config.compatRegistries.community.map((url) => ({ scope: "community" as const, url })),
  ];
}

async function syncOneRegistry(context: RuntimeContext, scope: "official" | "community", url: string): Promise<void> {
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed) {
    throw new Error(`Unsupported compat registry URL (only GitHub repos supported): ${url}`);
  }

  const { owner, repo } = parsed;
  const head = await getDefaultBranchHead(context, owner, repo);
  const tarballUrl = getTarballUrl(owner, repo, head.sha);

  const downloaded = await downloadToStore(context, tarballUrl, {
    requestInit: { headers: await getGitHubHeaders(context) },
    filenameHint: `compat-${scope}.tar.gz`,
  });

  const targetDir = scope === "official" ? context.dirs.compatOfficial : context.dirs.compatCommunity;
  await ensureDir(targetDir);
  const tarballPath = join(targetDir, registryTarballName(url));
  await rename(downloaded.path, tarballPath);
  registryTarballCache.delete(tarballPath);
}

export async function syncRegistries(context: RuntimeContext): Promise<void> {
  const errors: string[] = [];
  for (const url of [...context.config.compatRegistries.official, ...context.config.compatRegistries.community]) {
    const scope = context.config.compatRegistries.official.includes(url) ? "official" : "community";
    try {
      await syncOneRegistry(context, scope, url);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Compat source sync failed:\n${errors.join("\n")}`);
  }
}
