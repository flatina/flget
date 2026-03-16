import { getDefaultBranchHead, getGitHubHeaders, getLatestRelease, getTarballUrl } from "../core/github";
import { downloadToStore } from "../core/download";
import { extractInto } from "../core/extract";
import type { FundingInfo } from "../core/funding";
import { loadOverride } from "../core/registry";
import { getSourceFamilyByType } from "../core/source-family";
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
import { findExactGitHubCatalog, searchGitHubCatalog } from "./catalog-helpers";
import { resolveInstalledPackageJsonFunding } from "./funding-helpers";
import {
  dedupeShimDefs,
  finalizePreparedPackage,
  normalizeOverrideBins,
  normalizeOverrideDaemonEntries,
  normalizeOverrideEnvSet,
  normalizeOverrideInteractiveEntries,
  normalizeOverrideNotes,
  normalizeOverridePersist,
  normalizeOverrideWarnings,
} from "./helpers";
import {
  installPackageJsonAppDependencies,
  normalizePackageJsonBins,
  readPackageJsonApp,
  runPackageJsonBuild,
} from "./package-json-app";

const IDENTIFIER = /^npmgh:([^/]+)\/([^@]+?)(?:@(.+))?$/;

interface NpmGitHubResolvedExtra {
  owner: string;
  repo: string;
}

function parseIdentifier(
  identifier: string,
): { sourceRef: SourceRef<"npm-github">; owner: string; repo: string; requestedRef?: string } | null {
  const match = identifier.match(IDENTIFIER);
  if (!match) {
    return null;
  }
  const [, owner, repo, requestedRef] = match;
  return {
    sourceRef: identifier as SourceRef<"npm-github">,
    owner,
    repo,
    requestedRef: requestedRef || undefined,
  };
}

export const npmGithubSource: SourceResolver<"npm-github", NpmGitHubResolvedExtra> = {
  family: getSourceFamilyByType("npm-github"),

  canHandle(identifier: string): boolean {
    return IDENTIFIER.test(identifier);
  },

  async resolve(
    context: RuntimeContext,
    identifier: string,
  ): Promise<ResolvedSource<"npm-github", NpmGitHubResolvedExtra>> {
    const parsed = parseIdentifier(identifier);
    if (!parsed) {
      throw new Error(`Invalid npmgh identifier: ${identifier}`);
    }

    const { sourceRef, owner, repo, requestedRef } = parsed;
    if (requestedRef) {
      return {
        id: repo.toLowerCase(),
        displayName: repo,
        sourceType: "npm-github",
        sourceRef,
        resolvedVersion: requestedRef,
        resolvedRef: requestedRef,
        installKind: "app",
        extra: { owner, repo },
      };
    }

    const latestRelease = await getLatestRelease(context, owner, repo);
    if (latestRelease) {
      return {
        id: repo.toLowerCase(),
        displayName: repo,
        sourceType: "npm-github",
        sourceRef,
        resolvedVersion: latestRelease.tag_name,
        resolvedRef: latestRelease.tag_name,
        installKind: "app",
        extra: { owner, repo },
      };
    }

    const head = await getDefaultBranchHead(context, owner, repo);
    return {
      id: repo.toLowerCase(),
      displayName: repo,
      sourceType: "npm-github",
      sourceRef,
      resolvedVersion: head.sha.slice(0, 12),
      resolvedRef: head.sha,
      installKind: "app",
      extra: { owner, repo },
    };
  },

  async search(context: RuntimeContext, query: string) {
    return searchGitHubCatalog(context, query, "npmgh");
  },

  async findExact(context: RuntimeContext, query: string) {
    return findExactGitHubCatalog(context, query, "npmgh");
  },

  async resolveFunding(
    context: RuntimeContext,
    meta: AppPackageMeta,
    cache: Map<string, Promise<FundingInfo>>,
  ) {
    const parsed = parseIdentifier(meta.sourceRef);
    const fallbackRepo = parsed ? { owner: parsed.owner, repo: parsed.repo } : null;
    return resolveInstalledPackageJsonFunding(context, meta, cache, fallbackRepo);
  },

  async prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<"npm-github", NpmGitHubResolvedExtra>,
    stagingDir: string,
    options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage> {
    const { owner, repo } = resolved.extra;
    const override = await loadOverride(context.root, "npm-github", owner, repo, context.config.useLocalOverrides);

    await reportPhase("downloading");
    const tarball = await downloadToStore(context, getTarballUrl(owner, repo, resolved.resolvedRef), {
      filenameHint: `${repo}-${resolved.resolvedRef}.tar.gz`,
      requestInit: {
        headers: await getGitHubHeaders(context),
      },
    });

    await reportPhase("extracting");
    await extractInto(tarball.path, stagingDir);

    const packageJson = await readPackageJsonApp(stagingDir, `${owner}/${repo}`);
    await installPackageJsonAppDependencies(stagingDir, options.noScripts === true);
    await runPackageJsonBuild(stagingDir, packageJson, options.noScripts === true);

    const overrideBin = normalizeOverrideBins(override?.bin);
    const effectiveBin = overrideBin.length > 0 ? overrideBin : normalizePackageJsonBins(packageJson);
    const overrideInteractiveEntries = normalizeOverrideInteractiveEntries(override?.interactive);
    const interactiveEntries = dedupeShimDefs(overrideInteractiveEntries.length > 0 ? overrideInteractiveEntries : effectiveBin);
    const daemonEntries = normalizeOverrideDaemonEntries(override?.daemon);
    if (effectiveBin.length === 0) {
      throw new Error(`No runnable bin entry found in package.json for ${owner}/${repo}`);
    }

    return finalizePreparedPackage(stagingDir, {
      displayName: packageJson.name ?? resolved.displayName,
      portability: override?.portability ?? "portable",
      runtime: override?.runtime ?? "bun-native",
      bin: effectiveBin,
      interactiveEntries,
      daemonEntries,
      persist: normalizeOverridePersist(override),
      envSet: normalizeOverrideEnvSet(override),
      warnings: normalizeOverrideWarnings(override),
      notes: normalizeOverrideNotes(override),
    });
  },
};
