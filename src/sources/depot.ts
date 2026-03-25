import { join } from "node:path";
import { cp } from "node:fs/promises";
import type {
  InstallOptions,
  PreparedPackage,
  ResolvedSource,
  RuntimeContext,
  SourceResolver,
  SourceSearchResult,
  TransactionPhase,
} from "../core/types";
import { getSourceFamilyByType, SOURCE_FAMILIES } from "../core/source-family";
import { PACKAGE_META_NAME } from "../core/dirs";
import { listPackageMetas } from "../core/metadata";
import { downloadToStore } from "../core/download";
import { extractInto } from "../core/extract";
import { ensureDir, pathExists } from "../utils/fs";
import { isRemoteDepot } from "../commands/depot";

interface DepotResolvedExtra {
  depotUri: string;
  packagePath: string;
  depotMeta: DepotPackageMeta;
}

interface DepotPackageMeta {
  sourceRef: string;
  resolvedVersion: string;
  resolvedRef: string;
  sourceType: string;
  [key: string]: unknown;
}

interface DepotIndexEntry {
  id: string;
  sourceType: string;
  resolvedVersion: string;
  path: string;
}

interface DepotIndex {
  version: number;
  packages: DepotIndexEntry[];
}

const depotFamily = SOURCE_FAMILIES.find((f) => f.sourceType === "depot")!;

async function fetchRemoteIndex(depotUri: string): Promise<DepotIndex> {
  const url = `${depotUri}/depot/index.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    throw new Error(`Depot index fetch failed: ${response.status} (${url})`);
  }
  return await response.json() as DepotIndex;
}

async function fetchRemoteMeta(depotUri: string, packagePath: string): Promise<DepotPackageMeta> {
  const url = `${depotUri}/depot/${packagePath}/meta.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Depot meta fetch failed: ${response.status} (${url})`);
  }
  return await response.json() as DepotPackageMeta;
}

async function searchLocalDepot(depotUri: string, query: string): Promise<Array<{ id: string; path: string; meta: DepotPackageMeta }>> {
  const results: Array<{ id: string; path: string; meta: DepotPackageMeta }> = [];
  const metas = await listPackageMetas(depotUri);
  const lowerQuery = query.toLowerCase();
  for (const meta of metas) {
    if (meta.installKind === "skill") continue;
    if (query === "" || meta.id.toLowerCase().includes(lowerQuery)) {
      const family = getSourceFamilyByType(meta.sourceType);
      const packagePath = [...family.rootDirSegments, meta.id].join("/");
      results.push({
        id: meta.id,
        path: packagePath,
        meta: meta as unknown as DepotPackageMeta,
      });
    }
  }
  return results;
}

async function searchRemoteDepot(depotUri: string, query: string): Promise<Array<{ id: string; path: string }>> {
  try {
    const index = await fetchRemoteIndex(depotUri);
    const lowerQuery = query.toLowerCase();
    return index.packages.filter((entry) =>
      query === "" || entry.id.toLowerCase().includes(lowerQuery),
    );
  } catch {
    return [];
  }
}

async function findInLocalDepot(depotUri: string, id: string): Promise<{ path: string; meta: DepotPackageMeta } | null> {
  const metas = await listPackageMetas(depotUri);
  for (const meta of metas) {
    if (meta.installKind === "skill") continue;
    if (meta.id === id) {
      const family = getSourceFamilyByType(meta.sourceType);
      const packagePath = [...family.rootDirSegments, meta.id].join("/");
      return {
        path: packagePath,
        meta: meta as unknown as DepotPackageMeta,
      };
    }
  }
  return null;
}

async function findInRemoteDepot(depotUri: string, id: string): Promise<{ path: string } | null> {
  const index = await fetchRemoteIndex(depotUri);
  const entry = index.packages.find((e) => e.id === id);
  return entry ? { path: entry.path } : null;
}

async function findInRemoteDepotSafe(depotUri: string, id: string): Promise<{ path: string } | null> {
  try {
    return await findInRemoteDepot(depotUri, id);
  } catch {
    return null;
  }
}

export const depotSource: SourceResolver<"depot", DepotResolvedExtra> = {
  family: depotFamily,

  canHandle(identifier: string): boolean {
    return identifier.startsWith("depot:");
  },

  async resolve(
    context: RuntimeContext,
    identifier: string,
    _options: InstallOptions,
  ): Promise<ResolvedSource<"depot", DepotResolvedExtra>> {
    const query = identifier.replace(/^depot:/, "");

    for (const depot of context.config.depots) {
      if (isRemoteDepot(depot.uri)) {
        const match = await findInRemoteDepot(depot.uri, query);
        if (match) {
          const meta = await fetchRemoteMeta(depot.uri, match.path);
          return {
            id: query,
            displayName: String(meta.displayName ?? query),
            sourceType: "depot",
            sourceRef: `depot:${query}`,
            resolvedVersion: meta.resolvedVersion,
            resolvedRef: meta.resolvedRef ?? meta.resolvedVersion,
            installKind: "app",
            extra: {
              depotUri: depot.uri,
              packagePath: match.path,
              depotMeta: meta,
            },
          };
        }
      } else {
        if (!await pathExists(depot.uri)) continue;
        const match = await findInLocalDepot(depot.uri, query);
        if (match) {
          return {
            id: query,
            displayName: String(match.meta.displayName ?? query),
            sourceType: "depot",
            sourceRef: `depot:${query}`,
            resolvedVersion: match.meta.resolvedVersion,
            resolvedRef: match.meta.resolvedRef ?? match.meta.resolvedVersion,
            installKind: "app",
            extra: {
              depotUri: depot.uri,
              packagePath: match.path,
              depotMeta: match.meta,
            },
          };
        }
      }
    }

    throw new Error(`Package not found in any configured depot: ${query}`);
  },

  async prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<"depot", DepotResolvedExtra>,
    stagingDir: string,
    _options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage> {
    const { depotUri, packagePath, depotMeta } = resolved.extra;

    await reportPhase("downloading");
    await ensureDir(stagingDir);

    if (isRemoteDepot(depotUri)) {
      const archiveUrl = `${depotUri}/depot/${packagePath}/current.tar.gz`;
      const downloaded = await downloadToStore(context, archiveUrl, {
        filenameHint: `${resolved.id}.tar.gz`,
      });
      await reportPhase("extracting");
      await extractInto(downloaded.path, stagingDir);
    } else {
      const currentDir = join(depotUri, packagePath, "current");
      if (!await pathExists(currentDir)) {
        throw new Error(`Depot package current directory not found: ${currentDir}`);
      }
      await cp(currentDir, stagingDir, { recursive: true });
    }

    const meta = depotMeta;
    return {
      displayName: resolved.displayName,
      portability: (meta.portability as PreparedPackage["portability"]) ?? "unverified",
      runtime: (meta.runtime as PreparedPackage["runtime"]) ?? "unverified",
      bin: Array.isArray(meta.bin) ? meta.bin : [],
      uiEntries: Array.isArray(meta.uiEntries) ? meta.uiEntries : undefined,
      daemonEntries: Array.isArray(meta.daemonEntries) ? meta.daemonEntries : undefined,
      persistType: meta.persistType as PreparedPackage["persistType"],
      persist: Array.isArray(meta.persist) ? meta.persist : [],
      envAddPath: Array.isArray(meta.envAddPath) ? meta.envAddPath : undefined,
      envSet: meta.envSet && typeof meta.envSet === "object" ? meta.envSet as Record<string, string> : undefined,
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
      notes: typeof meta.notes === "string" ? meta.notes : null,
      depotOrigin: {
        sourceType: String(meta.sourceType ?? "unknown"),
        sourceRef: String(meta.sourceRef ?? ""),
      },
    };
  },

  async search(context: RuntimeContext, query: string): Promise<SourceSearchResult[]> {
    const results: SourceSearchResult[] = [];

    const searches = context.config.depots.map(async (depot) => {
      if (isRemoteDepot(depot.uri)) {
        const matches = await searchRemoteDepot(depot.uri, query);
        for (const match of matches) {
          results.push({
            identifier: `depot:${match.id}`,
            line: `depot:${match.id} -> ${depot.uri}`,
            installable: true,
          });
        }
      } else {
        if (!await pathExists(depot.uri)) return;
        const matches = await searchLocalDepot(depot.uri, query);
        for (const match of matches) {
          results.push({
            identifier: `depot:${match.id}`,
            line: `depot:${match.id} -> ${depot.uri}`,
            installable: true,
          });
        }
      }
    });

    await Promise.all(searches);
    return results;
  },

  async findExact(context: RuntimeContext, query: string): Promise<SourceSearchResult[]> {
    const results: SourceSearchResult[] = [];

    for (const depot of context.config.depots) {
      let found: { id: string } | null = null;
      if (isRemoteDepot(depot.uri)) {
        found = await findInRemoteDepotSafe(depot.uri, query);
      } else {
        if (!await pathExists(depot.uri)) continue;
        found = await findInLocalDepot(depot.uri, query);
      }
      if (found) {
        results.push({
          identifier: `depot:${query}`,
          line: `depot:${query} -> ${depot.uri}`,
          installable: true,
        });
      }
    }

    return results;
  },
};
