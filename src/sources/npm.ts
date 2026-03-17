import { downloadToStore } from "../core/download";
import { extractInto } from "../core/extract";
import type { FundingInfo } from "../core/funding";
import { fetchNpmPackageMetadata } from "../core/npm-registry";
import { loadNamedOverride } from "../core/registry";
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
import { slugify } from "../utils/strings";
import { findExactNpmCatalog, searchNpmCatalog } from "./catalog-helpers";
import { resolveInstalledPackageJsonFunding } from "./funding-helpers";
import { finalizePackageJsonPrepare } from "./helpers";
import {
  installPackageJsonAppDependencies,
  readPackageJsonApp,
  runPackageJsonBuild,
} from "./package-json-app";

interface NpmResolvedExtra {
  packageName: string;
  tarballUrl: string;
}

function parseIdentifier(
  identifier: string,
): { sourceRef: SourceRef<"npm">; packageName: string; requestedVersion?: string } | null {
  if (!identifier.startsWith("npm:")) {
    return null;
  }
  const raw = identifier.slice("npm:".length);
  if (!raw) {
    return null;
  }
  if (raw.startsWith("@")) {
    const slashIndex = raw.indexOf("/");
    if (slashIndex < 0) {
      return null;
    }
    const versionIndex = raw.indexOf("@", slashIndex + 1);
    if (versionIndex < 0) {
      return {
        sourceRef: identifier as SourceRef<"npm">,
        packageName: raw,
      };
    }
    return {
      sourceRef: identifier as SourceRef<"npm">,
      packageName: raw.slice(0, versionIndex),
      requestedVersion: raw.slice(versionIndex + 1),
    };
  }
  const versionIndex = raw.indexOf("@");
  if (versionIndex < 0) {
    return {
      sourceRef: identifier as SourceRef<"npm">,
      packageName: raw,
    };
  }
  return {
    sourceRef: identifier as SourceRef<"npm">,
    packageName: raw.slice(0, versionIndex),
    requestedVersion: raw.slice(versionIndex + 1),
  };
}

export const npmSource: SourceResolver<"npm", NpmResolvedExtra> = {
  family: getSourceFamilyByType("npm"),

  canHandle(identifier: string): boolean {
    return parseIdentifier(identifier) !== null;
  },

  async resolve(_context: RuntimeContext, identifier: string): Promise<ResolvedSource<"npm", NpmResolvedExtra>> {
    const parsed = parseIdentifier(identifier);
    if (!parsed) {
      throw new Error(`Invalid npm identifier: ${identifier}`);
    }

    const metadata = await fetchNpmPackageMetadata(parsed.packageName);
    const version = parsed.requestedVersion ?? metadata["dist-tags"]?.latest;
    if (!version) {
      throw new Error(`Unable to resolve npm version for ${parsed.packageName}`);
    }

    const packageVersion = metadata.versions?.[version];
    const tarballUrl = packageVersion?.dist?.tarball;
    if (!tarballUrl) {
      throw new Error(`npm tarball not found for ${parsed.packageName}@${version}`);
    }

    return {
      id: slugify(parsed.packageName.split("/").pop() ?? parsed.packageName),
      displayName: parsed.packageName,
      sourceType: "npm",
      sourceRef: parsed.sourceRef,
      resolvedVersion: version,
      resolvedRef: version,
      installKind: "app",
      extra: {
        packageName: parsed.packageName,
        tarballUrl,
      },
    };
  },

  async search(_context: RuntimeContext, query: string) {
    return searchNpmCatalog(query);
  },

  async findExact(_context: RuntimeContext, query: string) {
    return findExactNpmCatalog(query);
  },

  async resolveFunding(
    context: RuntimeContext,
    meta: AppPackageMeta,
    cache: Map<string, Promise<FundingInfo>>,
  ) {
    return resolveInstalledPackageJsonFunding(context, meta, cache);
  },

  async prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<"npm", NpmResolvedExtra>,
    stagingDir: string,
    options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage> {
    const { packageName, tarballUrl } = resolved.extra;
    const override = await loadNamedOverride(context.root, "npm", packageName, context.config.useLocalOverrides);

    await reportPhase("downloading");
    const tarball = await downloadToStore(context, tarballUrl, {
      filenameHint: `${packageName.replace(/[\\/]/g, "-")}-${resolved.resolvedVersion}.tgz`,
    });

    await reportPhase("extracting");
    await extractInto(tarball.path, stagingDir);

    const packageJson = await readPackageJsonApp(stagingDir, `${packageName}@${resolved.resolvedVersion}`);
    await installPackageJsonAppDependencies(stagingDir, options.noScripts === true);
    await runPackageJsonBuild(stagingDir, packageJson, options.noScripts === true);

    return finalizePackageJsonPrepare(stagingDir, packageJson, override, resolved, packageName);
  },
};
