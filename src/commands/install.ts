import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { findExactInstallMatches, findSearchMatches, parseSearchQuery, type SearchMatch } from "./search";
import { resolveSource } from "../sources";
import { buildPackageMeta, getCurrentPath, getPackageBaseDir } from "./helpers";
import { refreshActivationCache } from "../core/activation-cache";
import { deletePackageMetaBySource, loadPackageMeta, loadPackageMetaBySource, savePackageMeta, setPackageWinner } from "../core/metadata";
import { deleteShims, refreshPackageShims } from "../core/shim";
import { completeTransaction, createTransaction, failTransaction, setTransactionPhase } from "../core/transaction";
import type { InstallOptions, PreparedPackage, SourceType, TransactionPhase, RuntimeContext } from "../core/types";
import { ensureDir, pathExists, removePath, renameStrict } from "../utils/fs";
import { randomULID } from "../utils/strings";

function looksLikeFullyQualifiedIdentifier(identifier: string): boolean {
  return /^scoop:[^/]+\/.+$/.test(identifier)
    || /^npm:(@[^/]+\/[^@]+|[^@/]+)(?:@.+)?$/.test(identifier)
    || /^ghr:[^/]+\/[^@]+(?:@.+)?$/.test(identifier)
    || /^npmgh:[^/]+\/[^@]+(?:@.+)?$/.test(identifier)
    || /^skill:[^/]+\/[^@#]+(?:@[^#]+)?(?:#.+)?$/.test(identifier);
}

function toSearchQuery(identifier: string, source?: InstallOptions["source"]): string {
  if (source) {
    return `${source}:${identifier}`;
  }
  return identifier;
}

function filterInstallMatches(matches: SearchMatch[], source?: InstallOptions["source"]): SearchMatch[] {
  return matches.filter((match) => match.installable && (!source || match.source === source));
}

function directSourceShortcut(identifier: string, source?: InstallOptions["source"]): string | null {
  if (!source) {
    return null;
  }

  switch (source) {
    case "npm":
      return `npm:${identifier}`;
    case "ghr":
    case "npmgh":
    case "skill":
      return identifier.includes("/") ? `${source}:${identifier}` : null;
    default:
      return null;
  }
}

async function promptForMatch(matches: SearchMatch[]): Promise<SearchMatch> {
  console.log("Multiple matches found:");
  for (const [index, match] of matches.entries()) {
    console.log(`${index + 1}. ${match.line}`);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question("Select one: ")).trim();
    const selected = Number.parseInt(answer, 10);
    if (!Number.isInteger(selected) || selected < 1 || selected > matches.length) {
      throw new Error("Invalid selection.");
    }
    return matches[selected - 1]!;
  } finally {
    rl.close();
  }
}

async function resolveAmbiguousInstallMatches(identifier: string, matches: SearchMatch[]): Promise<string> {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return (await promptForMatch(matches)).identifier;
  }

  throw new Error(
    `Multiple matches found for ${identifier}. Use --source <scoop|npm|ghr|npmgh|skill> or run in an interactive terminal.`,
  );
}

async function resolveInstallIdentifier(
  context: RuntimeContext,
  identifier: string,
  options: InstallOptions,
): Promise<string> {
  if (looksLikeFullyQualifiedIdentifier(identifier)) {
    return identifier;
  }

  const direct = directSourceShortcut(identifier, options.source);
  if (direct) {
    return direct;
  }

  const hasExplicitScope = options.source !== undefined || parseSearchQuery(identifier).scope !== null;
  const scopedQuery = toSearchQuery(identifier, options.source);

  const exactMatches = filterInstallMatches(
    await findExactInstallMatches(context, scopedQuery, {
      includeSkills: options.source === "skill",
    }),
    options.source,
  );

  if (exactMatches.length === 1) {
    return exactMatches[0]!.identifier;
  }
  if (exactMatches.length > 1) {
    return resolveAmbiguousInstallMatches(identifier, exactMatches);
  }

  if (!hasExplicitScope) {
    throw new Error(
      `No exact installable source found for ${identifier}. Use \`flget search ${identifier}\` to inspect partial matches or provide --source <scoop|npm|ghr|npmgh|skill>.`,
    );
  }

  const matches = filterInstallMatches(
    await findSearchMatches(context, scopedQuery, {
      includeRoots: false,
      includeSkills: options.source === "skill",
    }),
    options.source,
  );

  if (matches.length === 0) {
    throw new Error(`No installable source found for ${identifier}`);
  }
  if (matches.length === 1) {
    return matches[0]!.identifier;
  }

  return resolveAmbiguousInstallMatches(identifier, matches);
}

async function removeExistingPackage(context: RuntimeContext, sourceType: SourceType, id: string): Promise<void> {
  const existing = await loadPackageMetaBySource(context.root, sourceType, id);
  if (!existing) {
    return;
  }
  const packageBase = getPackageBaseDir(context, existing.id, existing.sourceType);
  await deleteShims(context.root, existing.bin);
  await removePath(packageBase);
  await deletePackageMetaBySource(context.root, existing.sourceType, existing.id);
}

export async function runInstallCommand(context: RuntimeContext, identifier: string, options: InstallOptions): Promise<void> {
  const installIdentifier = await resolveInstallIdentifier(context, identifier, options);
  const resolution = await resolveSource(context, installIdentifier, options);
  const { resolved } = resolution;
  const previousWinner = await loadPackageMeta(context.root, resolved.id);
  const existing = await loadPackageMetaBySource(context.root, resolved.sourceType, resolved.id);
  if (existing && !options.force) {
    throw new Error(`${resolved.id} is already installed. Use \`flget update ${resolved.id}\` or \`--force\`.`);
  }

  if (existing && options.force) {
    await removeExistingPackage(context, resolved.sourceType, resolved.id);
  }

  const stagingDir = join(context.dirs.staging, `${resolved.id}-${randomULID()}`);
  const targetCurrent = getCurrentPath(context, resolved.id, resolved.sourceType);
  const targetBase = getPackageBaseDir(context, resolved.id, resolved.sourceType);
  resolved.extra = {
    ...resolved.extra,
    installPath: targetCurrent,
  };
  await ensureDir(stagingDir);
  await ensureDir(targetBase);

  await createTransaction(context.root, resolved.id, "install", {
    targetVersion: resolved.resolvedVersion,
    stagingPath: stagingDir,
  });

  try {
    const prepare = resolution.resolver.prepare as (
      context: RuntimeContext,
      resolved: typeof resolution.resolved,
      stagingDir: string,
      options: InstallOptions,
      reportPhase: (phase: TransactionPhase) => Promise<void>,
    ) => Promise<PreparedPackage>;
    const prepared = await prepare(context, resolution.resolved, stagingDir, options, async (phase) => {
      await setTransactionPhase(context.root, resolved.id, phase);
    });
    await setTransactionPhase(context.root, resolved.id, "staging-ready");

    if (await pathExists(targetCurrent)) {
      throw new Error(`Current path already exists: ${targetCurrent}`);
    }

    await setTransactionPhase(context.root, resolved.id, "committing");
    await renameStrict(stagingDir, targetCurrent);

    const meta = buildPackageMeta(resolved, prepared);
    if (options.tags?.length) {
      meta.tags = options.tags;
    }
    await setTransactionPhase(context.root, resolved.id, "shimming");
    await savePackageMeta(context.root, meta);
    await setPackageWinner(context.root, meta);
    await refreshPackageShims(context.root, previousWinner, meta);
    await refreshActivationCache(context.root);
    await completeTransaction(context.root, resolved.id);

    console.log(`Installed ${meta.id}@${meta.resolvedVersion}`);
    for (const warning of meta.warnings) {
      console.warn(`[warn] ${warning}`);
    }
    if (meta.notes) {
      console.log(meta.notes);
    }
  } catch (error) {
    await failTransaction(context.root, resolved.id, error);
    throw error;
  }
}
