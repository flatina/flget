import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { RuntimeContext, SourceSearchResult } from "../core/types";
import { pathExists } from "../utils/fs";
import { scanGlob } from "../utils/runtime";

interface ScoopManifestSummary {
  bucket: string;
  app: string;
  version: string | null;
  bins: string[];
}

interface ScoopManifestLike {
  version?: string;
  bin?: string | Array<string | [string, string]>;
}

const bucketManifestCache = new Map<string, Promise<ScoopManifestSummary[]>>();

function extractManifestBins(bin: ScoopManifestLike["bin"]): string[] {
  if (!bin) {
    return [];
  }
  const entries = Array.isArray(bin) ? bin : [bin];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") {
      return [basename(entry), basename(entry).replace(/\.[^.]+$/, "")];
    }
    if (Array.isArray(entry) && typeof entry[0] === "string") {
      return [
        ...(typeof entry[1] === "string" ? [entry[1]] : []),
        basename(entry[0]),
        basename(entry[0]).replace(/\.[^.]+$/, ""),
      ];
    }
    return [];
  });
}

export async function getBucketManifestDir(context: RuntimeContext, bucketName: string): Promise<string | null> {
  const configured = context.config.buckets.find((entry) => entry.name === bucketName);
  const bucketDir = join(context.dirs.buckets, bucketName);
  for (const candidate of [
    join(bucketDir, "bucket"),
    bucketDir,
    ...(configured ? [join(configured.url, "bucket"), configured.url] : []),
  ]) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function loadBucketManifestSummaries(context: RuntimeContext, bucketName: string): Promise<ScoopManifestSummary[]> {
  const manifestDir = await getBucketManifestDir(context, bucketName);
  if (!manifestDir) {
    return [];
  }

  const cacheKey = `${context.root}\u0000${manifestDir}`;
  const existing = bucketManifestCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const task = (async (): Promise<ScoopManifestSummary[]> => {
    const entries = await scanGlob("*.json", manifestDir);
    const summaries = await Promise.all(entries.sort((left, right) => left.localeCompare(right)).map(async (entry) => {
      const app = basename(entry, ".json");
      const manifest = JSON.parse(await readFile(join(manifestDir, entry), "utf8")) as ScoopManifestLike;
      return {
        bucket: bucketName,
        app,
        version: typeof manifest.version === "string" ? manifest.version : null,
        bins: extractManifestBins(manifest.bin),
      } satisfies ScoopManifestSummary;
    }));
    return summaries;
  })();

  bucketManifestCache.set(cacheKey, task);
  return task;
}

async function listScoopCatalogSummaries(context: RuntimeContext): Promise<ScoopManifestSummary[]> {
  const all = await Promise.all(context.config.buckets.map((bucket) => loadBucketManifestSummaries(context, bucket.name)));
  return all.flat();
}

function toLine(summary: ScoopManifestSummary, matchedBin?: string): string {
  const version = summary.version ? ` (${summary.version})` : "";
  return matchedBin
    ? `scoop:${summary.bucket}/${summary.app}${version} -> ${matchedBin}`
    : `scoop:${summary.bucket}/${summary.app}${version}`;
}

export async function searchScoopCatalog(context: RuntimeContext, query: string): Promise<SourceSearchResult[]> {
  const summaries = await listScoopCatalogSummaries(context);

  const nameMatches = summaries
    .filter((entry) => entry.app.toLowerCase().includes(query))
    .map((entry) => ({
      identifier: `scoop:${entry.bucket}/${entry.app}`,
      line: toLine(entry),
      installable: true,
    }));
  if (nameMatches.length > 0) {
    return nameMatches;
  }

  return summaries.flatMap((entry) => {
    const matchedBin = entry.bins.find((value) => value.toLowerCase().includes(query));
    if (!matchedBin) {
      return [];
    }
    return [{
      identifier: `scoop:${entry.bucket}/${entry.app}`,
      line: toLine(entry, matchedBin),
      installable: true,
    }];
  });
}

export async function findExactScoopCatalog(context: RuntimeContext, query: string): Promise<SourceSearchResult[]> {
  const normalized = query.toLowerCase();
  const summaries = await listScoopCatalogSummaries(context);
  return summaries
    .filter((entry) => entry.app.toLowerCase() === normalized)
    .map((entry) => ({
      identifier: `scoop:${entry.bucket}/${entry.app}`,
      line: toLine(entry),
      installable: true,
    }));
}
