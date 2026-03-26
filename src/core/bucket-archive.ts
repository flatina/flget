import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { pathExists } from "../utils/fs";
import { scanGlob } from "../utils/runtime";

interface BucketManifestSummary {
  bucket: string;
  app: string;
  version: string | null;
  bins: string[];
}

interface ManifestLike {
  version?: string;
  bin?: string | Array<string | [string, string]>;
  [key: string]: unknown;
}

const manifestCache = new Map<string, Promise<Map<string, ManifestLike>>>();

function extractBins(bin: ManifestLike["bin"]): string[] {
  if (!bin) return [];
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

function isLocalBucketUrl(url: string): boolean {
  return !url.startsWith("http://") && !url.startsWith("https://");
}

function getTarballPath(bucketsDir: string, bucketName: string): string {
  return join(bucketsDir, `${bucketName}.tar.gz`);
}

async function loadManifestsFromTarball(tarballPath: string): Promise<Map<string, ManifestLike>> {
  const bytes = await readFile(tarballPath);
  const archive = new Bun.Archive(bytes);
  const files: Map<string, Blob> = await archive.files();
  const manifests = new Map<string, ManifestLike>();

  for (const [name, blob] of files) {
    if (!name.endsWith(".json")) continue;
    const parts = name.replace(/\\/g, "/").split("/");

    // Only include manifests from bucket/ subdirectory or root level (skip deprecated/ etc)
    const bucketIdx = parts.indexOf("bucket");
    if (bucketIdx < 0 && parts.length > 2) continue; // skip non-bucket nested dirs

    const appName = basename(parts[parts.length - 1]!, ".json");
    if (manifests.has(appName)) continue;

    try {
      const text = await blob.text();
      manifests.set(appName, JSON.parse(text) as ManifestLike);
    } catch {
      // Skip invalid JSON
    }
  }
  return manifests;
}

async function findManifestDir(dir: string): Promise<string | null> {
  const candidate = join(dir, "bucket");
  if (await pathExists(candidate)) return candidate;
  if (await pathExists(dir)) return dir;
  return null;
}

async function loadManifestsFromDirectory(bucketDir: string): Promise<Map<string, ManifestLike>> {
  const manifests = new Map<string, ManifestLike>();
  const manifestDir = await findManifestDir(bucketDir);
  if (!manifestDir) return manifests;

  const jsonFiles = await scanGlob("*.json", manifestDir);
  for (const entry of jsonFiles) {
    const appName = basename(entry, ".json");
    try {
      const manifest = JSON.parse(await readFile(join(manifestDir, entry), "utf8")) as ManifestLike;
      manifests.set(appName, manifest);
    } catch {
      // Skip invalid JSON
    }
  }
  return manifests;
}

function getCacheKey(bucketsDir: string, bucketName: string): string {
  return `${bucketsDir}\0${bucketName}`;
}

async function getManifests(bucketsDir: string, bucketName: string, bucketUrl?: string): Promise<Map<string, ManifestLike>> {
  const cacheKey = getCacheKey(bucketsDir, bucketName);
  const cached = manifestCache.get(cacheKey);
  if (cached) return cached;

  const task = (async () => {
    const tarball = getTarballPath(bucketsDir, bucketName);
    if (await pathExists(tarball)) {
      return loadManifestsFromTarball(tarball);
    }

    if (bucketUrl && isLocalBucketUrl(bucketUrl)) {
      return loadManifestsFromDirectory(bucketUrl);
    }

    const dir = join(bucketsDir, bucketName);
    if (await pathExists(dir)) {
      return loadManifestsFromDirectory(dir);
    }

    return new Map<string, ManifestLike>();
  })();

  manifestCache.set(cacheKey, task);
  return task;
}

export function invalidateBucketCache(bucketsDir: string, bucketName: string): void {
  manifestCache.delete(getCacheKey(bucketsDir, bucketName));
}

export async function readBucketManifest(bucketsDir: string, bucketName: string, appName: string, bucketUrl?: string): Promise<ManifestLike | null> {
  const manifests = await getManifests(bucketsDir, bucketName, bucketUrl);
  return manifests.get(appName) ?? null;
}

export async function listBucketManifestSummaries(bucketsDir: string, bucketName: string, bucketUrl?: string): Promise<BucketManifestSummary[]> {
  const manifests = await getManifests(bucketsDir, bucketName, bucketUrl);
  const summaries: BucketManifestSummary[] = [];
  for (const [app, manifest] of manifests) {
    summaries.push({
      bucket: bucketName,
      app,
      version: typeof manifest.version === "string" ? manifest.version : null,
      bins: extractBins(manifest.bin),
    });
  }
  summaries.sort((a, b) => a.app.localeCompare(b.app));
  return summaries;
}

export function bucketTarballExists(bucketsDir: string, bucketName: string): Promise<boolean> {
  return pathExists(getTarballPath(bucketsDir, bucketName));
}

export { getTarballPath, isLocalBucketUrl };
export type { ManifestLike, BucketManifestSummary };
