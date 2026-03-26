import type { RuntimeContext, SourceSearchResult } from "../core/types";
import { listBucketManifestSummaries, type BucketManifestSummary } from "../core/bucket-archive";

function toLine(summary: BucketManifestSummary, matchedBin?: string): string {
  const version = summary.version ? ` (${summary.version})` : "";
  return matchedBin
    ? `scoop:${summary.bucket}/${summary.app}${version} -> ${matchedBin}`
    : `scoop:${summary.bucket}/${summary.app}${version}`;
}

async function listAllManifestSummaries(context: RuntimeContext): Promise<BucketManifestSummary[]> {
  const all = await Promise.all(
    context.config.buckets.map((bucket) =>
      listBucketManifestSummaries(context.dirs.buckets, bucket.name, bucket.url),
    ),
  );
  return all.flat();
}

export async function searchScoopCatalog(context: RuntimeContext, query: string): Promise<SourceSearchResult[]> {
  const summaries = await listAllManifestSummaries(context);

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
  const summaries = await listAllManifestSummaries(context);
  return summaries
    .filter((entry) => entry.app.toLowerCase() === normalized)
    .map((entry) => ({
      identifier: `scoop:${entry.bucket}/${entry.app}`,
      line: toLine(entry),
      installable: true,
    }));
}
