import { createHash } from "node:crypto";
import { basename, join, relative, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { getDefaultBranchHead, getGitHubHeaders, getTarballUrl } from "../core/github";
import { downloadToStore } from "../core/download";
import { extractInto } from "../core/extract";
import { getSourceFamilyByType } from "../core/source-family";
import type {
  InstallOptions,
  PreparedPackage,
  ResolvedSource,
  RuntimeContext,
  ShimDef,
  ShimRunner,
  SkillMeta,
  SourceRef,
  SourceResolver,
  TransactionPhase,
} from "../core/types";
import { copyPath, ensureDir, pathExists, removePath } from "../utils/fs";
import { parseYaml, readRuntimeText } from "../utils/runtime";
import { deriveShimName, detectShimType, inferShimRunner, randomULID } from "../utils/strings";
import { findExactGitHubCatalog, searchGitHubCatalog } from "./catalog-helpers";
import { finalizePreparedPackage, inferRuntimeFromBins } from "./helpers";

const IDENTIFIER = /^skill:([^/]+)\/([^@#]+?)(?:@([^#]+))?(?:#(.+))?$/;

interface SkillGithubResolvedExtra {
  owner: string;
  repo: string;
  subpath?: string;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  shims?: Array<string | {
    name?: string;
    target?: string;
    runner?: string;
  }>;
}

export interface DiscoveredSkill {
  id: string;
  relativePath: string;
  displayName?: string;
}

async function findSkillMdRecursive(root: string, depth: number): Promise<string[]> {
  if (depth < 0 || !await pathExists(root)) {
    return [];
  }

  const matches: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      matches.push(fullPath);
      continue;
    }
    if (entry.isDirectory()) {
      matches.push(...await findSkillMdRecursive(fullPath, depth - 1));
    }
  }
  return matches;
}

function getSkillBaseDirs(repoRoot: string): string[] {
  return [
    repoRoot,
    join(repoRoot, "skills"),
    join(repoRoot, ".claude", "skills"),
    join(repoRoot, ".codex", "skills"),
  ];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function normalizeRelativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/") || ".";
}

async function hashDirectoryContents(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function visit(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = normalizeRelativePath(root, fullPath);

      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\n`);
        await visit(fullPath);
        continue;
      }

      if (entry.isFile()) {
        hash.update(`file:${relativePath}\n`);
        hash.update(await readFile(fullPath));
      }
    }
  }

  await visit(root);
  return `sha256:${hash.digest("hex")}`;
}

async function findSkillDirectory(repoRoot: string, subpath?: string): Promise<{ path: string; relativePath: string; warnings: string[] }> {
  if (subpath) {
    const candidateSet = new Set<string>([
      resolve(repoRoot, subpath),
      resolve(repoRoot, basename(subpath)),
    ]);
    for (const baseDir of getSkillBaseDirs(repoRoot)) {
      candidateSet.add(resolve(baseDir, subpath));
      candidateSet.add(resolve(baseDir, basename(subpath)));
    }
    const candidates = [...candidateSet];
    for (const candidate of candidates) {
      if (await pathExists(join(candidate, "SKILL.md"))) {
        return { path: candidate, relativePath: normalizeRelativePath(repoRoot, candidate), warnings: [] };
      }
    }
    throw new Error(`SKILL.md not found at subpath ${subpath}`);
  }

  const warnings: string[] = [];
  const candidates: string[] = [];

  for (const base of getSkillBaseDirs(repoRoot)) {
    if (!await pathExists(base)) {
      continue;
    }
    if (await pathExists(join(base, "SKILL.md"))) {
      candidates.push(base);
      continue;
    }
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = join(base, entry.name);
      if (await pathExists(join(candidate, "SKILL.md"))) {
        candidates.push(candidate);
      }
    }
  }

  const recursiveCandidates = await findSkillMdRecursive(repoRoot, 3);
  for (const skillMdPath of recursiveCandidates) {
    const candidate = resolve(skillMdPath, "..");
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    throw new Error("SKILL.md not found in repository");
  }
  if (candidates.length > 1) {
    warnings.push(`Multiple skill directories found; selected ${relative(repoRoot, candidates[0]!) || "."}`);
  }

  return {
    path: candidates[0]!,
    relativePath: normalizeRelativePath(repoRoot, candidates[0]!),
    warnings,
  };
}

async function collectSkillDirectories(repoRoot: string): Promise<string[]> {
  const candidates: string[] = [];

  for (const base of getSkillBaseDirs(repoRoot)) {
    if (!await pathExists(base)) {
      continue;
    }
    if (await pathExists(join(base, "SKILL.md"))) {
      candidates.push(base);
      continue;
    }
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = join(base, entry.name);
      if (await pathExists(join(candidate, "SKILL.md"))) {
        candidates.push(candidate);
      }
    }
  }

  const recursiveCandidates = await findSkillMdRecursive(repoRoot, 3);
  for (const skillMdPath of recursiveCandidates) {
    candidates.push(resolve(skillMdPath, ".."));
  }

  return uniquePaths(candidates);
}

async function parseFrontmatter(skillMdPath: string): Promise<ParsedFrontmatter> {
  const content = await readRuntimeText(skillMdPath);
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return {};
  }
  const yaml = content.slice(4, end);
  return parseYaml(yaml) as ParsedFrontmatter;
}

function isShimRunner(value: string | undefined): value is ShimRunner {
  return value === "direct"
    || value === "cmd"
    || value === "powershell"
    || value === "java"
    || value === "python"
    || value === "bun"
    || value === "bash";
}

function validateSkillShims(shims?: ParsedFrontmatter["shims"]): ShimDef[] {
  if (!shims) {
    return [];
  }
  return shims.flatMap((entry) => {
    const target = typeof entry === "string" ? entry : entry.target;
    if (!target) {
      return [];
    }

    const normalizedTarget = target.replace(/\\/g, "/");
    if (!/^scripts\/.+$/i.test(normalizedTarget)) {
      return [];
    }

    const runner = typeof entry === "string"
      ? inferShimRunner(normalizedTarget)
      : (isShimRunner(entry.runner) ? entry.runner : inferShimRunner(normalizedTarget));
    if (!runner) {
      return [];
    }

    return [{
      name: typeof entry === "string" ? deriveShimName(normalizedTarget) : (entry.name ?? deriveShimName(normalizedTarget)),
      target: normalizedTarget,
      type: detectShimType(normalizedTarget),
      runner,
    }];
  });
}

function parseIdentifier(
  identifier: string,
): { sourceRef: SourceRef<"skill-github">; owner: string; repo: string; requestedRef?: string; subpath?: string } | null {
  const match = identifier.match(IDENTIFIER);
  if (!match) {
    return null;
  }
  const [, owner, repo, requestedRef, subpath] = match;
  return {
    sourceRef: identifier as SourceRef<"skill-github">,
    owner,
    repo,
    requestedRef: requestedRef || undefined,
    subpath: subpath || undefined,
  };
}

export function parseSkillRepoIdentifier(identifier: string): {
  owner: string;
  repo: string;
  requestedRef?: string;
  subpath?: string;
} | null {
  const parsed = parseIdentifier(identifier.startsWith("skill:") ? identifier : `skill:${identifier}`);
  if (!parsed) {
    return null;
  }
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    requestedRef: parsed.requestedRef,
    subpath: parsed.subpath,
  };
}

export async function discoverSkillsInRepo(
  context: RuntimeContext,
  identifier: string,
): Promise<DiscoveredSkill[]> {
  const parsed = parseSkillRepoIdentifier(identifier);
  if (!parsed) {
    throw new Error(`Invalid skill repository reference: ${identifier}`);
  }

  const { owner, repo, requestedRef, subpath } = parsed;
  if (subpath) {
    return [{
      id: basename(subpath).toLowerCase(),
      relativePath: subpath,
    }];
  }

  const resolvedRef = requestedRef ?? (await getDefaultBranchHead(context, owner, repo)).sha;
  const tempRepoDir = join(context.dirs.staging, `skill-discovery-${repo}-${randomULID()}`);

  try {
    const tarball = await downloadToStore(context, getTarballUrl(owner, repo, resolvedRef), {
      filenameHint: `${repo}-${resolvedRef}.tar.gz`,
      requestInit: {
        headers: await getGitHubHeaders(context),
      },
    });

    await ensureDir(tempRepoDir);
    await extractInto(tarball.path, tempRepoDir);

    const directories = await collectSkillDirectories(tempRepoDir);
    const discovered: DiscoveredSkill[] = [];
    for (const directory of directories) {
      const frontmatter = await parseFrontmatter(join(directory, "SKILL.md"));
      const relativePath = normalizeRelativePath(tempRepoDir, directory);
      discovered.push({
        id: basename(directory).toLowerCase(),
        relativePath,
        displayName: frontmatter.name,
      });
    }
    return discovered;
  } finally {
    await removePath(tempRepoDir);
  }
}

export const skillGithubSource: SourceResolver<"skill-github", SkillGithubResolvedExtra> = {
  family: getSourceFamilyByType("skill-github"),

  canHandle(identifier: string): boolean {
    return IDENTIFIER.test(identifier);
  },

  async resolve(
    context: RuntimeContext,
    identifier: string,
  ): Promise<ResolvedSource<"skill-github", SkillGithubResolvedExtra>> {
    const parsed = parseIdentifier(identifier);
    if (!parsed) {
      throw new Error(`Invalid skill identifier: ${identifier}`);
    }

    const { sourceRef, owner, repo, requestedRef, subpath } = parsed;
    if (requestedRef) {
      return {
        id: (subpath ? basename(subpath) : repo).toLowerCase(),
        displayName: subpath ? basename(subpath) : repo,
        sourceType: "skill-github",
        sourceRef,
        resolvedVersion: requestedRef,
        resolvedRef: requestedRef,
        installKind: "skill",
        extra: { owner, repo, subpath },
      };
    }

    const head = await getDefaultBranchHead(context, owner, repo);
    return {
      id: (subpath ? basename(subpath) : repo).toLowerCase(),
      displayName: subpath ? basename(subpath) : repo,
      sourceType: "skill-github",
      sourceRef,
      resolvedVersion: head.sha.slice(0, 12),
      resolvedRef: head.sha,
      installKind: "skill",
      extra: { owner, repo, subpath },
    };
  },

  async search(context: RuntimeContext, query: string) {
    return searchGitHubCatalog(context, query, "skill");
  },

  async findExact(context: RuntimeContext, query: string) {
    return findExactGitHubCatalog(context, query, "skill");
  },

  async prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<"skill-github", SkillGithubResolvedExtra>,
    stagingDir: string,
    _options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage> {
    const { owner, repo, subpath } = resolved.extra;
    const tempRepoDir = `${stagingDir}.repo`;

    await reportPhase("downloading");
    const tarball = await downloadToStore(context, getTarballUrl(owner, repo, resolved.resolvedRef), {
      filenameHint: `${repo}-${resolved.resolvedRef}.tar.gz`,
      requestInit: {
        headers: await getGitHubHeaders(context),
      },
    });

    await reportPhase("extracting");
    await removePath(tempRepoDir);
    await ensureDir(tempRepoDir);
    await extractInto(tarball.path, tempRepoDir);

    const located = await findSkillDirectory(tempRepoDir, subpath);
    await ensureDir(stagingDir);
    await copyPath(located.path, stagingDir);
    await removePath(tempRepoDir);

    const frontmatter = await parseFrontmatter(join(stagingDir, "SKILL.md"));
    const shims = validateSkillShims(frontmatter.shims);
    const skill: SkillMeta = {
      folderPath: located.relativePath,
      folderHash: await hashDirectoryContents(stagingDir),
    };

    return finalizePreparedPackage(stagingDir, {
      displayName: frontmatter.name ?? resolved.displayName,
      portability: "portable",
      runtime: inferRuntimeFromBins(shims, "unverified"),
      bin: shims,
      persist: [],
      warnings: located.warnings,
      notes: frontmatter.description ?? null,
      skill,
    });
  },
};
