import { join } from "node:path";
import type { GitHubReleaseAsset } from "../core/github";
import { getLatestRelease, getReleaseByTag } from "../core/github";
import { resolveArch } from "../core/arch";
import { applyExtractDir, detectArchiveType, extractInto } from "../core/extract";
import { downloadToStore } from "../core/download";
import { getSourceFamilyByType } from "../core/source-family";
import type { FundingInfo } from "../core/funding";
import { loadOverride } from "../core/registry";
import type {
  AppPackageMeta,
  InstallOptions,
  PreparedPackage,
  ResolvedSource,
  RuntimeContext,
  SourceRef,
  SourceResolver,
  TransactionPhase,
} from "../core/types";
import { copyPath, ensureDir } from "../utils/fs";
import { findExactGitHubCatalog, searchGitHubCatalog } from "./catalog-helpers";
import { loadGitHubFundingInfo } from "./funding-helpers";
import {
  chooseAssetByPattern,
  chooseBestBinCandidate,
  collectExecutableCandidates,
  dedupeShimDefs,
  finalizePreparedPackage,
  inferRuntimeFromBins,
  normalizeOverrideBins,
  normalizeOverrideDaemonEntries,
  normalizeOverrideEnvSet,
  normalizeOverrideUiEntries,
  normalizeOverrideNotes,
  normalizeOverridePersist,
  normalizeOverridePersistType,
  normalizeOverrideWarnings,
} from "./helpers";

const IDENTIFIER = /^ghr:([^/]+)\/([^@]+?)(?:@(.+))?$/;

interface GitHubReleaseResolvedExtra {
  owner: string;
  repo: string;
  asset: GitHubReleaseAsset;
}

function parseIdentifier(identifier: string): { sourceRef: SourceRef<"github-release">; owner: string; repo: string; tag?: string } | null {
  const match = identifier.match(IDENTIFIER);
  if (!match) {
    return null;
  }
  const [, owner, repo, tag] = match;
  return {
    sourceRef: identifier as SourceRef<"github-release">,
    owner,
    repo,
    tag: tag || undefined,
  };
}

function scoreAsset(asset: GitHubReleaseAsset, arch: ReturnType<typeof resolveArch>): number {
  const name = asset.name.toLowerCase();
  if (/\.(sha\d+|sig|asc|txt)$/.test(name)) {
    return -1;
  }
  if (!/(win|windows|msvc|pc-windows)/.test(name) && !/\.(zip|7z|tar\.gz|tgz|exe|msi)$/.test(name)) {
    return -1;
  }

  let score = 10;
  if (arch === "64bit" && /(x86_64|x64|amd64|64bit)/.test(name)) {
    score += 5;
  }
  if (arch === "32bit" && /(x86|i386|i686|32bit)/.test(name)) {
    score += 5;
  }
  if (arch === "arm64" && /(arm64|aarch64)/.test(name)) {
    score += 5;
  }
  if (name.endsWith(".zip")) {
    score += 3;
  }
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
    score += 2;
  }
  if (name.endsWith(".exe")) {
    score += 2;
  }
  if (name.endsWith(".msi")) {
    score -= 4;
  }
  if (name.includes("debug") || name.includes("symbols")) {
    score -= 4;
  }
  return score;
}

function selectAsset(assets: GitHubReleaseAsset[], arch: ReturnType<typeof resolveArch>, pattern?: string): GitHubReleaseAsset {
  const overridden = chooseAssetByPattern(assets, pattern);
  if (overridden) {
    return overridden;
  }

  const scored = assets
    .map((asset) => ({ asset, score: scoreAsset(asset, arch) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    throw new Error("No suitable Windows asset found in release");
  }

  return scored[0]!.asset;
}

export const githubReleaseSource: SourceResolver<"github-release", GitHubReleaseResolvedExtra> = {
  family: getSourceFamilyByType("github-release"),

  canHandle(identifier: string): boolean {
    return IDENTIFIER.test(identifier);
  },

  async resolve(
    context: RuntimeContext,
    identifier: string,
    options: InstallOptions,
  ): Promise<ResolvedSource<"github-release", GitHubReleaseResolvedExtra>> {
    const parsed = parseIdentifier(identifier);
    if (!parsed) {
      throw new Error(`Invalid GitHub release identifier: ${identifier}`);
    }

    const { sourceRef, owner, repo, tag } = parsed;
    const override = await loadOverride(context.root, "github-release", owner, repo, context.config.useLocalOverrides);
    const release = tag
      ? await getReleaseByTag(context, owner, repo, tag)
      : await getLatestRelease(context, owner, repo);

    if (!release) {
      throw new Error(`No release found for ${owner}/${repo}`);
    }

    const arch = resolveArch(options.arch ?? context.config.arch);
    const asset = selectAsset(release.assets, arch, override?.assetPattern);

    return {
      id: repo.toLowerCase(),
      displayName: repo,
      sourceType: "github-release",
      sourceRef,
      resolvedVersion: release.tag_name,
      resolvedRef: release.tag_name,
      installKind: "app",
      extra: {
        owner,
        repo,
        asset,
      },
    };
  },

  async search(context: RuntimeContext, query: string) {
    return searchGitHubCatalog(context, query, "ghr");
  },

  async findExact(context: RuntimeContext, query: string) {
    return findExactGitHubCatalog(context, query, "ghr");
  },

  async resolveFunding(
    context: RuntimeContext,
    meta: AppPackageMeta,
    cache: Map<string, Promise<FundingInfo>>,
  ) {
    const parsed = parseIdentifier(meta.sourceRef);
    if (!parsed) {
      return null;
    }
    return loadGitHubFundingInfo(context, parsed.owner, parsed.repo, true, cache);
  },

  async prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<"github-release", GitHubReleaseResolvedExtra>,
    stagingDir: string,
    _options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage> {
    const { owner, repo, asset } = resolved.extra;
    const override = await loadOverride(context.root, "github-release", owner, repo, context.config.useLocalOverrides);

    await reportPhase("downloading");
    const downloaded = await downloadToStore(context, asset.browser_download_url);

    await reportPhase("extracting");
    await ensureDir(stagingDir);
    let flattenedRootDir: string | null = null;
    if (detectArchiveType(downloaded.path) === "single") {
      await copyPath(downloaded.path, join(stagingDir, asset.name));
    } else {
      flattenedRootDir = await extractInto(downloaded.path, stagingDir);
    }

    if (override?.extractDir) {
      await applyExtractDir(stagingDir, override.extractDir, flattenedRootDir);
    }

    const overrideBin = normalizeOverrideBins(override?.bin);
    const effectiveBin = overrideBin.length > 0 ? overrideBin : chooseBestBinCandidate(repo, await collectExecutableCandidates(stagingDir));
    const overrideUiEntries = normalizeOverrideUiEntries(override?.ui);
    const uiEntries = dedupeShimDefs(overrideUiEntries.length > 0 ? overrideUiEntries : effectiveBin);
    const daemonEntries = normalizeOverrideDaemonEntries(override?.daemon);
    if (effectiveBin.length === 0) {
      throw new Error(`Unable to infer executable for ${owner}/${repo}; add a compatibility override.`);
    }

    return finalizePreparedPackage(stagingDir, {
      portability: override?.portability ?? (asset.name.toLowerCase().endsWith(".exe") ? "portable" : "unverified"),
      runtime: override?.runtime ?? inferRuntimeFromBins(effectiveBin),
      bin: effectiveBin,
      uiEntries,
      daemonEntries,
      persistType: normalizeOverridePersistType(override),
      persist: normalizeOverridePersist(override),
      envSet: normalizeOverrideEnvSet(override),
      warnings: [
        ...normalizeOverrideWarnings(override),
        ...(overrideBin.length === 0 ? ["Executable auto-detected from release asset contents."] : []),
      ],
      notes: normalizeOverrideNotes(override),
    });
  },
};
