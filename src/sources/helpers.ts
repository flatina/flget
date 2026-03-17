import { basename, extname, join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import type { DaemonEntry, PersistDef, PreparedPackage, RegistryOverride, RuntimeKind, ShimDef } from "../core/types";
import { ensureRelativePathInsideRoot } from "../utils/fs";
import { detectShimType, deriveShimName, inferShimRunner, wildcardToRegExp } from "../utils/strings";
import type { PackageJsonAppManifest } from "./package-json-app";
import { normalizePackageJsonBins } from "./package-json-app";

function normalizeShimOverride(
  item: Partial<ShimDef> | undefined,
  fallbackName?: string,
): ShimDef | null {
  if (!item?.target) {
    return null;
  }
  return {
    name: item.name ?? fallbackName ?? deriveShimName(item.target),
    target: item.target,
    args: item.args,
    type: item.type ?? detectShimType(item.target),
    runner: item.runner,
  };
}

export function normalizeOverrideBins(bins: RegistryOverride["bin"]): ShimDef[] {
  if (!bins) {
    return [];
  }
  return bins.flatMap((item) => {
    const normalized = normalizeShimOverride(item);
    return normalized ? [normalized] : [];
  });
}

export function normalizeOverrideUiEntries(entries: RegistryOverride["ui"]): ShimDef[] {
  if (!entries) {
    return [];
  }
  return entries.flatMap((item) => {
    const normalized = normalizeShimOverride(item);
    return normalized ? [normalized] : [];
  });
}

export function normalizeOverrideDaemonEntries(entries: RegistryOverride["daemon"]): DaemonEntry[] {
  if (!entries) {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!entry?.name) {
      return [];
    }
    const run = normalizeShimOverride(entry.run, entry.name);
    if (!run) {
      return [];
    }
    const stop = normalizeShimOverride(entry.stop, `${entry.name}-stop`) ?? undefined;
    const status = normalizeShimOverride(entry.status, `${entry.name}-status`) ?? undefined;
    return [{
      name: entry.name,
      run,
      stop,
      status,
      restartPolicy: entry.restartPolicy,
      dependsOn: Array.isArray(entry.dependsOn) ? entry.dependsOn.filter((value): value is string => typeof value === "string") : undefined,
      autoStart: entry.autoStart === true ? true : undefined,
    }];
  });
}

export function normalizeOverridePersist(override: RegistryOverride | null): PersistDef[] {
  if (!override?.persist) {
    return [];
  }
  return override.persist.flatMap((entry) => {
    if (!entry?.source) {
      return [];
    }
    return [{
      source: entry.source,
      target: entry.target ?? entry.source,
    }];
  });
}

export function normalizeOverrideEnvSet(override: RegistryOverride | null): Record<string, string> | undefined {
  if (!override?.env) {
    return undefined;
  }

  const entries = Object.entries(override.env).filter((entry): entry is [string, string] => (
    entry[0].length > 0 && typeof entry[1] === "string"
  ));
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

export function normalizeOverrideWarnings(override: RegistryOverride | null): string[] {
  if (!Array.isArray(override?.warnings)) {
    return [];
  }
  return override.warnings.filter((warning): warning is string => typeof warning === "string");
}

export function normalizeOverrideNotes(override: RegistryOverride | null): string | null {
  if (typeof override?.notes !== "string" || override.notes.length === 0) {
    return null;
  }
  return override.notes;
}

export function dedupeShimDefs(entries: ShimDef[]): ShimDef[] {
  const seen = new Set<string>();
  const results: ShimDef[] = [];
  for (const entry of entries) {
    const key = `${entry.name}\u0000${entry.target}\u0000${entry.args ?? ""}\u0000${entry.type}\u0000${entry.runner ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(entry);
  }
  return results;
}

function normalizeRelativeEntryPath(root: string, value: string): string {
  return ensureRelativePathInsideRoot(root, value).replace(/\\/g, "/");
}

function validateShimDefs(root: string, entries: ShimDef[]): ShimDef[] {
  return entries.map((entry) => ({
    ...entry,
    target: normalizeRelativeEntryPath(root, entry.target),
  }));
}

function validateDaemonEntries(root: string, entries: DaemonEntry[]): DaemonEntry[] {
  return entries.map((entry) => ({
    ...entry,
    run: {
      ...entry.run,
      target: normalizeRelativeEntryPath(root, entry.run.target),
    },
    stop: entry.stop ? {
      ...entry.stop,
      target: normalizeRelativeEntryPath(root, entry.stop.target),
    } : undefined,
    status: entry.status ? {
      ...entry.status,
      target: normalizeRelativeEntryPath(root, entry.status.target),
    } : undefined,
  }));
}

function validatePersistDefs(root: string, entries: PersistDef[]): PersistDef[] {
  return entries.map((entry) => ({
    source: normalizeRelativeEntryPath(root, entry.source),
    target: normalizeRelativeEntryPath(root, entry.target),
  }));
}

export function finalizePreparedPackage(stagingDir: string, prepared: PreparedPackage): PreparedPackage {
  return {
    ...prepared,
    bin: validateShimDefs(stagingDir, prepared.bin),
    uiEntries: prepared.uiEntries ? validateShimDefs(stagingDir, prepared.uiEntries) : undefined,
    daemonEntries: prepared.daemonEntries ? validateDaemonEntries(stagingDir, prepared.daemonEntries) : undefined,
    persist: validatePersistDefs(stagingDir, prepared.persist),
    envAddPath: prepared.envAddPath?.map((entry) => normalizeRelativeEntryPath(stagingDir, entry)),
  };
}

export function chooseAssetByPattern<T extends { name: string }>(assets: T[], pattern?: string): T | null {
  if (!pattern) {
    return null;
  }
  const matcher = wildcardToRegExp(pattern);
  return assets.find((asset) => matcher.test(asset.name)) ?? null;
}

export async function collectExecutableCandidates(root: string, maxDepth: number = 3): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if ([".exe", ".cmd", ".bat", ".ps1", ".jar", ".py", ".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"].includes(extension)) {
        results.push(relative(root, fullPath).replace(/\\/g, "/"));
      }
    }
  }

  await walk(root, 0);
  return results;
}

export function chooseBestBinCandidate(repoName: string, candidates: string[]): ShimDef[] {
  if (candidates.length === 0) {
    return [];
  }

  const repo = repoName.toLowerCase();
  const scored = candidates.map((candidate) => {
    const name = basename(candidate, extname(candidate)).toLowerCase();
    let score = 0;
    if (name === repo) {
      score += 100;
    }
    if (name.includes(repo)) {
      score += 60;
    }
    score -= candidate.split("/").length * 2;
    const type = detectShimType(candidate);
    if (type === "exe") {
      score += 10;
    }
    return { candidate, score, type };
  }).sort((left, right) => right.score - left.score);

  const winner = scored[0]!;
  return [{
    name: deriveShimName(winner.candidate),
    target: winner.candidate,
    type: winner.type,
  }];
}

export function finalizePackageJsonPrepare(
  stagingDir: string,
  packageJson: PackageJsonAppManifest,
  override: RegistryOverride | null,
  resolved: { displayName: string },
  label: string,
): PreparedPackage {
  const overrideBin = normalizeOverrideBins(override?.bin);
  const effectiveBin = overrideBin.length > 0 ? overrideBin : normalizePackageJsonBins(packageJson);
  const overrideUiEntries = normalizeOverrideUiEntries(override?.ui);
  const uiEntries = dedupeShimDefs(overrideUiEntries.length > 0 ? overrideUiEntries : effectiveBin);
  const daemonEntries = normalizeOverrideDaemonEntries(override?.daemon);
  if (effectiveBin.length === 0) {
    throw new Error(`No runnable bin entry found in package.json for ${label}`);
  }
  return finalizePreparedPackage(stagingDir, {
    displayName: packageJson.name ?? resolved.displayName,
    portability: override?.portability ?? "portable",
    runtime: override?.runtime ?? "bun-native",
    bin: effectiveBin,
    uiEntries,
    daemonEntries,
    persist: normalizeOverridePersist(override),
    envSet: normalizeOverrideEnvSet(override),
    warnings: normalizeOverrideWarnings(override),
    notes: normalizeOverrideNotes(override),
  });
}

export function inferRuntimeFromBins(bin: ShimDef[], fallback: RuntimeKind = "unverified"): RuntimeKind {
  if (bin.length === 0) {
    return fallback;
  }

  const runners = bin.map((entry) => entry.runner ?? inferShimRunner(entry.target));
  if (runners.every((runner, index) => runner === "direct" || runner === "cmd" || runner === "powershell" || (
    runner === undefined && (bin[index]!.type === "exe" || bin[index]!.type === "cmd" || bin[index]!.type === "ps1")
  ))) {
    return "standalone";
  }

  if (runners.every((runner, index) => runner === "bun" || (
    runner === undefined && (bin[index]!.type === "js" || bin[index]!.type === "ts")
  ))) {
    return "bun-native";
  }

  if (bin.some((entry, index) => {
    const runner = runners[index];
    return runner === "python"
      || runner === "java"
      || runner === "bash"
      || (runner === undefined && (entry.type === "jar" || entry.type === "py" || entry.type === "other"));
  })) {
    return "runtime-dependent";
  }
  return fallback;
}
