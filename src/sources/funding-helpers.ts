import { join } from "node:path";
import { getFundingFileContent, getRepo } from "../core/github";
import {
  detectKnownSponsorLink,
  extractGitHubRepoRef,
  fundingInfo,
  parseGitHubFundingYaml,
  parsePackageFunding,
  readFundingFileLinks,
  type FundingInfo,
  type FundingLink,
} from "../core/funding";
import { getPackageBaseRelativePath } from "../core/package-layout";
import type { PackageMeta, RuntimeContext } from "../core/types";
import { pathExists } from "../utils/fs";
import { readRuntimeText } from "../utils/runtime";
import type { PackageJsonAppManifest } from "./package-json-app";

interface ScoopManifestLike {
  homepage?: unknown;
  description?: unknown;
}

export function getInstalledCurrentPath(root: string, meta: PackageMeta): string {
  return join(root, getPackageBaseRelativePath(meta.sourceType, meta.id), "current");
}

export function readFundingLinksFromContent(content: string): FundingLink[] {
  return fundingInfo(parseGitHubFundingYaml(content)).links;
}

export async function loadGitHubFundingInfo(
  context: RuntimeContext,
  owner: string,
  repo: string,
  includeDescription = false,
  cache?: Map<string, Promise<FundingInfo>>,
): Promise<FundingInfo> {
  const key = `${owner}/${repo}:${includeDescription ? "desc" : "links"}`;
  if (cache?.has(key)) {
    return cache.get(key)!;
  }

  const task = (async (): Promise<FundingInfo> => {
    const content = await getFundingFileContent(context, owner, repo).catch((error) => {
      if (error instanceof Error && (error.message.includes("resource not found") || error.message.includes("404"))) {
        return null;
      }
      throw error;
    });
    const links = content ? readFundingLinksFromContent(content) : [];
    if (links.length > 0 || !includeDescription) {
      return fundingInfo(links, null);
    }
    const repoInfo = await getRepo(context, owner, repo);
    return fundingInfo(links, repoInfo.description ?? null);
  })();

  cache?.set(key, task);
  return task;
}

export function getRepositoryUrl(repository: unknown): string | null {
  if (typeof repository === "string") {
    return repository;
  }
  if (!repository || typeof repository !== "object") {
    return null;
  }
  const value = repository as Record<string, unknown>;
  return typeof value.url === "string" ? value.url : null;
}

export function withHomepageSponsor(base: FundingInfo, homepage: unknown): FundingInfo {
  const links = [...base.links];
  if (typeof homepage === "string") {
    const sponsor = detectKnownSponsorLink(homepage);
    if (sponsor) {
      links.push(sponsor);
    }
  }
  return fundingInfo(links, base.message);
}

export async function resolveInstalledPackageJsonFunding(
  context: RuntimeContext,
  meta: PackageMeta,
  cache: Map<string, Promise<FundingInfo>>,
  fallbackRepo?: { owner: string; repo: string } | null,
): Promise<FundingInfo> {
  const currentPath = getInstalledCurrentPath(context.root, meta);
  const packageJson = JSON.parse(await readRuntimeText(join(currentPath, "package.json"))) as PackageJsonAppManifest;
  const localFundingLinks = await readFundingFileLinks(currentPath);
  const links = [
    ...parsePackageFunding(packageJson.funding),
    ...localFundingLinks,
  ];

  if (links.length > 0) {
    return withHomepageSponsor(fundingInfo(links, packageJson.description), packageJson.homepage);
  }

  const homepageLink = typeof packageJson.homepage === "string" ? detectKnownSponsorLink(packageJson.homepage) : null;
  if (homepageLink) {
    return fundingInfo([homepageLink], packageJson.description);
  }

  const repositoryUrl = getRepositoryUrl(packageJson.repository)
    ?? (typeof packageJson.homepage === "string" ? packageJson.homepage : null);
  const repo = repositoryUrl ? extractGitHubRepoRef(repositoryUrl) : null;
  if (!repo && !fallbackRepo) {
    return fundingInfo([], packageJson.description);
  }

  const githubInfo = await loadGitHubFundingInfo(
    context,
    (repo ?? fallbackRepo)!.owner,
    (repo ?? fallbackRepo)!.repo,
    false,
    cache,
  );
  return fundingInfo(githubInfo.links, packageJson.description);
}

export async function loadScoopManifest(root: string, bucket: string, app: string): Promise<ScoopManifestLike | null> {
  const bucketRoot = join(root, "buckets", bucket);
  for (const candidate of [
    join(bucketRoot, "bucket", `${app}.json`),
    join(bucketRoot, `${app}.json`),
  ]) {
    if (!await pathExists(candidate)) {
      continue;
    }
    return JSON.parse(await readRuntimeText(candidate)) as ScoopManifestLike;
  }
  return null;
}
