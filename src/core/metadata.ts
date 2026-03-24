import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { AppPackageMeta, PackageMeta, SkillPackageMeta } from "./types";
import { pathExists, readJson, removePath, withFileLock, writeJson, writeText } from "../utils/fs";
import { getDirs, PACKAGE_META_NAME } from "./dirs";
import { getMetaSearchRoots, getPackageBaseRelativePath } from "./package-layout";
import { inferPackageLocationFromRelativeParts } from "./source-family";
import { scanGlob } from "../utils/runtime";
import { detectShimType } from "../utils/strings";

type StoredPackageMeta = Omit<PackageMeta, "id" | "sourceType" | "installKind">;
const PACKAGE_WINNER_NAME = "flget.winner";

function normalizeStoredMeta(stored: StoredPackageMeta): { value: StoredPackageMeta; changed: boolean } {
  let changed = false;
  const bin = stored.bin.map((shim) => {
    if (shim.type !== "other") {
      return shim;
    }
    const detectedType = detectShimType(shim.target);
    if (detectedType !== "js" && detectedType !== "ts") {
      return shim;
    }
    changed = true;
    return {
      ...shim,
      type: detectedType,
    };
  });

  if (!changed) {
    return { value: stored, changed: false };
  }

  return {
    value: {
      ...stored,
      bin,
    },
    changed: true,
  };
}

function getPackageMetaPath(root: string, meta: Pick<PackageMeta, "sourceType" | "id">): string {
  return join(root, getPackageBaseRelativePath(meta.sourceType, meta.id), PACKAGE_META_NAME);
}

function getWinnerMarkerPath(root: string, meta: Pick<PackageMeta, "sourceType" | "id">): string {
  return join(root, getPackageBaseRelativePath(meta.sourceType, meta.id), PACKAGE_WINNER_NAME);
}

function parseMetaLocation(root: string, target: string): Pick<PackageMeta, "id" | "sourceType" | "installKind"> {
  const relative = target.slice(root.length).replace(/^[/\\]+/, "");
  const parts = relative.split(/[\\/]/);
  const inferred = inferPackageLocationFromRelativeParts(parts);
  if (inferred) {
    return inferred;
  }
  throw new Error(`Unable to infer package location from ${target}`);
}

async function loadMetaFile(root: string, target: string): Promise<PackageMeta> {
  const stored = await readJson<StoredPackageMeta>(target);
  const normalized = normalizeStoredMeta(stored);
  if (normalized.changed) {
    try {
      await writeJson(target, normalized.value);
    } catch {
      // Read-only roots should still be able to use the normalized metadata in-memory.
    }
  }
  const location = parseMetaLocation(root, target);
  if (location.installKind === "skill") {
    if (!normalized.value.skill) {
      throw new Error(`Skill metadata missing for ${target}`);
    }
    const skillLocation = location as Pick<SkillPackageMeta, "id" | "sourceType" | "installKind">;
    const skillValue = normalized.value as Omit<SkillPackageMeta, "id" | "sourceType" | "installKind">;
    return {
      ...skillLocation,
      ...skillValue,
      skill: skillValue.skill,
    };
  }

  const appLocation = location as Pick<AppPackageMeta, "id" | "sourceType" | "installKind">;
  const { skill: _ignoredSkill, ...appValue } = normalized.value as Omit<AppPackageMeta, "id" | "sourceType" | "installKind"> & {
    skill?: never;
  };
  return {
    ...appLocation,
    ...appValue,
  };
}

async function listMetaTargets(root: string): Promise<string[]> {
  const dirs = getDirs(root);
  const targets = getMetaSearchRoots(dirs);
  const allTargets: string[] = [];
  for (const base of targets) {
    if (!await pathExists(base)) {
      continue;
    }
    const entries = await scanGlob(`*/${PACKAGE_META_NAME}`, base);
    allTargets.push(...entries.map((entry) => join(base, entry)));
  }
  return allTargets;
}

async function listMetaCandidates(root: string, id?: string): Promise<Array<{
  id: string;
  sourceType: PackageMeta["sourceType"];
  installKind: PackageMeta["installKind"];
  target: string;
  mtimeMs: number;
  winner: boolean;
}>> {
  const candidates: Array<{
    id: string;
    sourceType: PackageMeta["sourceType"];
    installKind: PackageMeta["installKind"];
    target: string;
    mtimeMs: number;
    winner: boolean;
  }> = [];

  for (const target of await listMetaTargets(root)) {
    const location = parseMetaLocation(root, target);
    if (id && location.id !== id) {
      continue;
    }
    candidates.push({
      ...location,
      target,
      mtimeMs: (await stat(target)).mtimeMs,
      winner: await pathExists(getWinnerMarkerPath(root, location)),
    });
  }

  return candidates;
}

function compareMetaCandidates(
  left: { winner: boolean; mtimeMs: number; target: string },
  right: { winner: boolean; mtimeMs: number; target: string },
): number {
  if (left.winner !== right.winner) {
    return left.winner ? -1 : 1;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }
  return left.target.localeCompare(right.target);
}

async function findPackageMetaPath(root: string, id: string): Promise<string | null> {
  const candidates = await listMetaCandidates(root, id);
  candidates.sort(compareMetaCandidates);
  return candidates[0]?.target ?? null;
}

export async function loadPackageMeta(root: string, id: string): Promise<PackageMeta | null> {
  const target = await findPackageMetaPath(root, id);
  if (!target) {
    return null;
  }
  return loadMetaFile(root, target);
}

export async function savePackageMeta(root: string, meta: PackageMeta): Promise<void> {
  const target = getPackageMetaPath(root, meta);
  await withFileLock(target, async () => {
    const stored: StoredPackageMeta = {
      displayName: meta.displayName,
      sourceRef: meta.sourceRef,
      resolvedVersion: meta.resolvedVersion,
      resolvedRef: meta.resolvedRef,
      portability: meta.portability,
      runtime: meta.runtime,
      bin: meta.bin,
      uiEntries: meta.uiEntries,
      daemonEntries: meta.daemonEntries,
      persistType: meta.persistType,
      persist: meta.persist,
      envAddPath: meta.envAddPath,
      envSet: meta.envSet,
      warnings: meta.warnings,
      notes: meta.notes ?? null,
      tags: meta.tags?.length ? meta.tags : undefined,
      skill: meta.installKind === "skill" ? meta.skill : undefined,
    };
    await writeJson(target, stored);
  });
}

export async function setPackageWinner(root: string, meta: Pick<PackageMeta, "sourceType" | "id">): Promise<void> {
  const candidates = await listMetaCandidates(root, meta.id);
  for (const candidate of candidates) {
    const markerPath = getWinnerMarkerPath(root, candidate);
    if (candidate.sourceType === meta.sourceType) {
      await writeText(markerPath, `${candidate.sourceType}:${candidate.id}\n`);
    } else {
      await removePath(markerPath);
    }
  }
}

export async function promotePackageWinner(root: string, id: string): Promise<PackageMeta | null> {
  const candidates = await listMetaCandidates(root, id);
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort(compareMetaCandidates);
  const winner = candidates[0]!;
  await setPackageWinner(root, winner);
  return loadMetaFile(root, winner.target);
}

export async function loadPackageMetaBySource(root: string, sourceType: PackageMeta["sourceType"], id: string): Promise<PackageMeta | null> {
  const target = getPackageMetaPath(root, { sourceType, id });
  if (!await pathExists(target)) {
    return null;
  }
  return loadMetaFile(root, target);
}

export async function deletePackageMeta(root: string, id: string): Promise<void> {
  const target = await findPackageMetaPath(root, id);
  if (target) {
    await removePath(target);
  }
}

export async function deletePackageMetaBySource(root: string, sourceType: PackageMeta["sourceType"], id: string): Promise<void> {
  await removePath(getWinnerMarkerPath(root, { sourceType, id }));
  await removePath(getPackageMetaPath(root, { sourceType, id }));
}

export async function listPackageMetas(root: string): Promise<PackageMeta[]> {
  const metas = await Promise.all((await listMetaTargets(root)).map((target) => loadMetaFile(root, target)));
  return metas.sort((left, right) => left.id.localeCompare(right.id) || left.sourceType.localeCompare(right.sourceType));
}

export async function listWinnerPackageMetas(root: string): Promise<PackageMeta[]> {
  const winners = new Map<string, Array<{
    id: string;
    sourceType: PackageMeta["sourceType"];
    installKind: PackageMeta["installKind"];
    target: string;
    mtimeMs: number;
    winner: boolean;
  }>>();

  for (const candidate of await listMetaCandidates(root)) {
    const entries = winners.get(candidate.id) ?? [];
    entries.push(candidate);
    winners.set(candidate.id, entries);
  }

  const metas = await Promise.all(Array.from(winners.values(), async (entries) => {
    entries.sort(compareMetaCandidates);
    return loadMetaFile(root, entries[0]!.target);
  }));
  return metas.sort((left, right) => left.id.localeCompare(right.id));
}
