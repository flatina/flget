import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveArch } from "../core/arch";
import { downloadToStore } from "../core/download";
import { applyExtractDir, detectArchiveType, extractInto } from "../core/extract";
import type { FundingInfo } from "../core/funding";
import { verifyFileHash } from "../core/hash";
import { normalizePersistEntries } from "../core/persist";
import { fundingInfo, detectKnownSponsorLink, extractGitHubRepoRef } from "../core/funding";
import { getSourceFamilyByType } from "../core/source-family";
import type {
  AppPackageMeta,
  Arch,
  InstallOptions,
  PreparedPackage,
  ResolvedSource,
  RuntimeContext,
  ShimDef,
  SourceRef,
  SourceResolver,
  TransactionPhase,
} from "../core/types";
import { copyPath, pathExists, removePath, writeText } from "../utils/fs";
import { detectShimType, ensureArray } from "../utils/strings";
import { runCommand } from "../utils/process";
import { syncBucketIfNeeded } from "../commands/bucket";
import { loadGitHubFundingInfo, loadScoopManifest } from "./funding-helpers";
import { dedupeShimDefs, finalizePreparedPackage } from "./helpers";
import { findExactScoopCatalog, searchScoopCatalog } from "./scoop-catalog";

const IDENTIFIER = /^scoop:([^/]+)\/(.+)$/;

interface ScoopResolvedExtra {
  bucketName: string;
  app: string;
  manifest: ScoopManifest;
}

interface ScoopManifest {
  version: string;
  url?: string | string[];
  hash?: string | string[];
  architecture?: Record<string, Partial<ScoopManifest>>;
  extract_dir?: string;
  bin?: string | Array<string | [string, string]>;
  notes?: string | string[];
  persist?: string | Array<string | [string, string]>;
  env_add_path?: string | string[];
  env_set?: Record<string, string>;
  pre_install?: string | string[];
  post_install?: string | string[];
  installer?: {
    script?: string | string[];
    file?: string;
  };
  shortcuts?: Array<[string, string?, string?, string?]> | [string, string?, string?, string?];
}

function mergeManifestForArch(manifest: ScoopManifest, arch: Arch): ScoopManifest {
  const archManifest = manifest.architecture?.[arch];
  return archManifest ? { ...manifest, ...archManifest } : manifest;
}

async function findManifestPath(bucketDir: string, app: string): Promise<string> {
  const candidates = [
    join(bucketDir, "bucket", `${app}.json`),
    join(bucketDir, `${app}.json`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Manifest not found for ${app} in ${bucketDir}`);
}

function normalizeBins(bin: ScoopManifest["bin"]): ShimDef[] {
  if (!bin) {
    return [];
  }
  const entries = Array.isArray(bin) ? bin : [bin];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") {
      const name = basename(entry).replace(/\.[^.]+$/, "");
      return [{
        name,
        target: entry.replace(/\\/g, "/"),
        type: detectShimType(entry),
      }];
    }
    if (Array.isArray(entry) && typeof entry[0] === "string") {
      const target = entry[0].replace(/\\/g, "/");
      const name = typeof entry[1] === "string" ? entry[1] : basename(target).replace(/\.[^.]+$/, "");
      return [{
        name,
        target,
        type: detectShimType(target),
      }];
    }
    return [];
  });
}


function renderNotes(notes: ScoopManifest["notes"]): string | null {
  if (!notes) {
    return null;
  }
  return Array.isArray(notes) ? notes.join("\n") : notes;
}

function normalizeShortcuts(shortcuts: ScoopManifest["shortcuts"]): ShimDef[] {
  if (!shortcuts) {
    return [];
  }
  const entries = Array.isArray(shortcuts) && Array.isArray(shortcuts[0])
    ? shortcuts as Array<[string, string?, string?, string?]>
    : [shortcuts as [string, string?, string?, string?]];

  return entries.flatMap((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") {
      return [];
    }
    const target = entry[0].replace(/\\/g, "/");
    const name = typeof entry[1] === "string" && entry[1].trim().length > 0
      ? entry[1]
      : basename(target).replace(/\.[^.]+$/, "");
    const args = typeof entry[2] === "string" && entry[2].trim().length > 0 ? entry[2] : undefined;
    return [{
      name,
      target,
      args,
      type: detectShimType(target),
    }];
  });
}

function substituteVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, (token) => variables[token] ?? token);
}

async function runPowerShellScript(
  script: string | string[] | undefined,
  variables: Record<string, string>,
  cwd: string,
): Promise<void> {
  if (!script) {
    return;
  }

  const lines = Array.isArray(script) ? script : [script];
  const variableBlock = Object.entries(variables)
    .map(([key, value]) => `${key} = @'\n${value}\n'@`)
    .join("\n");
  const fullScript = `${variableBlock}\n${lines.join("\n")}`;
  const tempScript = join(cwd, `.flget-hook-${Date.now()}.ps1`);
  await writeText(tempScript, fullScript);
  try {
    await runCommand(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScript], { cwd });
  } finally {
    await removePath(tempScript);
  }
}

function detectPortability(manifest: ScoopManifest): PreparedPackage["portability"] {
  const scripts = [
    ...ensureArray(manifest.pre_install),
    ...ensureArray(manifest.post_install),
    ...ensureArray(manifest.installer?.script),
  ].join("\n").toLowerCase();

  if (manifest.installer?.file) {
    return "host-integrated";
  }

  if (/(registry|new-service|sc\.exe|setx|schtasks|msiexec|reg\.exe)/.test(scripts)) {
    return "host-integrated";
  }

  return "unverified";
}

function detectRuntime(bin: ShimDef[]): PreparedPackage["runtime"] {
  if (bin.length > 0 && bin.every((entry) => entry.type === "exe" || entry.type === "cmd" || entry.type === "ps1")) {
    return "standalone";
  }
  if (bin.some((entry) => entry.type === "jar" || entry.type === "py" || entry.type === "js" || entry.type === "ts")) {
    return "runtime-dependent";
  }
  return "unverified";
}

function parseIdentifier(identifier: string): { sourceRef: SourceRef<"scoop">; bucketName: string; app: string } | null {
  const match = identifier.match(IDENTIFIER);
  if (!match) {
    return null;
  }
  const [, bucketName, app] = match;
  return {
    sourceRef: identifier as SourceRef<"scoop">,
    bucketName,
    app,
  };
}

export const scoopSource: SourceResolver<"scoop", ScoopResolvedExtra> = {
  family: getSourceFamilyByType("scoop"),

  canHandle(identifier: string): boolean {
    return IDENTIFIER.test(identifier);
  },

  async resolve(
    context: RuntimeContext,
    identifier: string,
    options: InstallOptions,
  ): Promise<ResolvedSource<"scoop", ScoopResolvedExtra>> {
    const parsed = parseIdentifier(identifier);
    if (!parsed) {
      throw new Error(`Invalid scoop identifier: ${identifier}`);
    }

    const { sourceRef, bucketName, app } = parsed;
    await syncBucketIfNeeded(context, bucketName);
    const manifestPath = await findManifestPath(join(context.dirs.buckets, bucketName), app);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ScoopManifest;
    const effectiveManifest = mergeManifestForArch(manifest, resolveArch(options.arch ?? context.config.arch));

    return {
      id: app.toLowerCase(),
      displayName: app,
      sourceType: "scoop",
      sourceRef,
      resolvedVersion: effectiveManifest.version,
      resolvedRef: effectiveManifest.version,
      installKind: "app",
      extra: {
        bucketName,
        app,
        manifest: effectiveManifest,
      },
    };
  },

  async search(context: RuntimeContext, query: string) {
    return searchScoopCatalog(context, query);
  },

  async findExact(context: RuntimeContext, query: string) {
    return findExactScoopCatalog(context, query);
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

    const manifest = await loadScoopManifest(context.root, parsed.bucketName, parsed.app);
    if (!manifest) {
      return null;
    }

    if (typeof manifest.homepage === "string") {
      const sponsor = detectKnownSponsorLink(manifest.homepage);
      if (sponsor) {
        return fundingInfo([sponsor], manifest.description);
      }

      const repo = extractGitHubRepoRef(manifest.homepage);
      if (repo) {
        const githubInfo = await loadGitHubFundingInfo(context, repo.owner, repo.repo, false, cache);
        return fundingInfo(githubInfo.links, manifest.description);
      }
    }

    return fundingInfo([], manifest.description);
  },

  async prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<"scoop", ScoopResolvedExtra>,
    stagingDir: string,
    options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage> {
    const { manifest, bucketName, app, installPath } = resolved.extra;
    const urls = ensureArray(manifest.url);
    const hashes = ensureArray(manifest.hash);
    const downloadedFiles: Array<{ path: string; originalName: string }> = [];
    const warnings: string[] = [];

    const shortcutEntries = normalizeShortcuts(manifest.shortcuts);
    if (shortcutEntries.length > 0) {
      warnings.push("Manifest shortcuts are recorded as launch metadata only.");
    }
    if (manifest.installer?.file) {
      warnings.push("installer.file is not executed automatically; review package behavior.");
    }

    await reportPhase("downloading");
    for (const [index, urlTemplate] of urls.entries()) {
      const url = substituteVariables(urlTemplate, {
        $version: manifest.version,
      });
      const downloaded = await downloadToStore(context, url);
      const expectedHash = hashes[index];
      if (expectedHash && !options.noHash && !await verifyFileHash(downloaded.path, expectedHash)) {
        throw new Error(`Hash mismatch for ${url}`);
      }
      if (expectedHash && options.noHash) {
        warnings.push(`Skipped hash verification for ${basename(downloaded.originalName)}.`);
      }
      downloadedFiles.push({
        path: downloaded.path,
        originalName: downloaded.originalName,
      });
    }

    await reportPhase("extracting");
    let flattenedRootDir: string | null = null;
    for (const downloadedFile of downloadedFiles) {
      if (detectArchiveType(downloadedFile.path) === "single") {
        await copyPath(downloadedFile.path, join(stagingDir, downloadedFile.originalName));
      } else {
        flattenedRootDir = await extractInto(downloadedFile.path, stagingDir);
      }
    }

    if (manifest.extract_dir) {
      await applyExtractDir(stagingDir, manifest.extract_dir, flattenedRootDir);
    }

    const variables: Record<string, string> = {
      $app: app,
      $bucket: bucketName,
      $url: urls[0] ?? "",
      $manifest: JSON.stringify(manifest, null, 2),
      $dir: stagingDir,
      $original_dir: stagingDir,
      $persist_dir: installPath ?? stagingDir,
      $version: manifest.version,
      $architecture: resolveArch(options.arch ?? context.config.arch),
      $global: "false",
      $scoopdir: context.root,
      $bucketsdir: context.dirs.buckets,
      $fname: downloadedFiles[0]?.originalName ?? "",
    };

    if (!options.noScripts) {
      await runPowerShellScript(manifest.pre_install, variables, stagingDir);
      await runPowerShellScript(manifest.installer?.script, variables, stagingDir);
      await runPowerShellScript(manifest.post_install, variables, stagingDir);
    }

    const envSet = Object.fromEntries(
      Object.entries(manifest.env_set ?? {}).map(([key, value]) => [key, substituteVariables(value, variables)]),
    );
    const bin = normalizeBins(manifest.bin);
    const interactiveEntries = dedupeShimDefs([...bin, ...shortcutEntries]);

    return finalizePreparedPackage(stagingDir, {
      portability: detectPortability(manifest),
      runtime: detectRuntime(bin),
      bin,
      interactiveEntries,
      daemonEntries: [],
      persist: normalizePersistEntries(manifest.persist),
      envAddPath: ensureArray(manifest.env_add_path),
      envSet,
      warnings,
      notes: renderNotes(manifest.notes),
    });
  },
};
