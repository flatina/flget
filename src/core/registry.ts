import { join } from "node:path";
import type { FlgetConfig, RegistryOverride, RuntimeContext, SourceType } from "./types";
import { ensureDir, pathExists } from "../utils/fs";
import { getDirs } from "./dirs";
import { parseToml, readRuntimeText, scanGlob, spawnProcess } from "../utils/runtime";
import { slugify } from "../utils/strings";

interface RegistryLocation {
  scope: "local" | "official" | "community";
  path: string;
}

function buildOverrideFileName(parts: string[]): string {
  return `${parts.map((part) => slugify(part)).join("--")}.toml`;
}

async function readOverride(path: string): Promise<RegistryOverride> {
  return parseToml(await readRuntimeText(path)) as RegistryOverride;
}

async function findOverrideCandidates(root: string, sourceType: SourceType, fileName: string): Promise<RegistryLocation[]> {
  const dirs = getDirs(root);
  const locations: RegistryLocation[] = [];

  locations.push({
    scope: "local",
    path: join(dirs.compatLocal, "overrides", sourceType, fileName),
  });

  if (await pathExists(dirs.compatOfficial)) {
    for (const entry of await scanGlob("*", dirs.compatOfficial)) {
      locations.push({
        scope: "official",
        path: join(dirs.compatOfficial, entry, "overrides", sourceType, fileName),
      });
    }
  }

  if (await pathExists(dirs.compatCommunity)) {
    for (const entry of await scanGlob("*", dirs.compatCommunity)) {
      locations.push({
        scope: "community",
        path: join(dirs.compatCommunity, entry, "overrides", sourceType, fileName),
      });
    }
  }

  return locations;
}

export async function loadOverride(
  root: string,
  sourceType: SourceType,
  owner: string,
  repo: string,
  useLocalOverrides: boolean = true,
): Promise<RegistryOverride | null> {
  const locations = await findOverrideCandidates(root, sourceType, buildOverrideFileName([owner, repo]));
  for (const location of locations) {
    if (location.scope === "local" && !useLocalOverrides) {
      continue;
    }
    if (await pathExists(location.path)) {
      return readOverride(location.path);
    }
  }
  return null;
}

export async function loadNamedOverride(
  root: string,
  sourceType: SourceType,
  name: string,
  useLocalOverrides: boolean = true,
): Promise<RegistryOverride | null> {
  const normalized = name.startsWith("@") ? name.slice(1) : name;
  const parts = normalized.split("/").filter((part) => part.length > 0);
  const locations = await findOverrideCandidates(root, sourceType, buildOverrideFileName(parts));
  for (const location of locations) {
    if (location.scope === "local" && !useLocalOverrides) {
      continue;
    }
    if (await pathExists(location.path)) {
      return readOverride(location.path);
    }
  }
  return null;
}

export function listConfiguredRegistries(config: FlgetConfig): Array<{ scope: "official" | "community"; url: string }> {
  return [
    ...config.compatRegistries.official.map((url) => ({ scope: "official" as const, url })),
    ...config.compatRegistries.community.map((url) => ({ scope: "community" as const, url })),
  ];
}

async function commandExists(command: string): Promise<boolean> {
  const which = spawnProcess({
    cmd: ["where.exe", command],
    stdout: "pipe",
    stderr: "ignore",
  });
  return (await which.exited) === 0;
}

function getRegistryDir(context: RuntimeContext, scope: "official" | "community", url: string): string {
  const bucket = scope === "official" ? context.dirs.compatOfficial : context.dirs.compatCommunity;
  return join(bucket, slugify(url.replace(/^https?:\/\//i, "").replace(/\.git$/i, "")));
}

async function syncOneRegistry(context: RuntimeContext, scope: "official" | "community", url: string): Promise<void> {
  if (!await commandExists("git")) {
    throw new Error("git is required to sync compatibility sources");
  }

  const target = getRegistryDir(context, scope, url);
  const exists = await pathExists(target);
  if (!exists) {
    const bucket = scope === "official" ? context.dirs.compatOfficial : context.dirs.compatCommunity;
    await ensureDir(bucket);
  }
  const cmd = exists
    ? ["git", "-C", target, "pull", "--ff-only"]
    : ["git", "clone", "--depth", "1", url, target];

  const process = spawnProcess({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`Compat source sync failed for ${url}: ${stderr.trim() || "unknown error"}`);
  }
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
