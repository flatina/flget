import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolveSource } from "../sources";
import { applyPersistTransaction, rollbackCommittedUpdate } from "../core/fs-transaction";
import { refreshActivationCache } from "../core/activation-cache";
import { listPackageMetas, loadPackageMeta, savePackageMeta } from "../core/metadata";
import { refreshPackageShims } from "../core/shim";
import { assertSourceEnabled } from "../core/source-enablement";
import { completeTransaction, createTransaction, failTransaction, setTransactionPhase, updateTransaction } from "../core/transaction";
import type { InstallOptions, PackageMeta, PersistDef, PreparedPackage, RuntimeContext, TransactionPhase } from "../core/types";
import { getSourceFamilyByType } from "../core/source-family";
import { ensureDir, pathExists, removePath, renameStrict, writeText } from "../utils/fs";
import { runCommand } from "../utils/process";
import { randomULID } from "../utils/strings";
import { buildPackageMeta, getCurrentPath, getPackageBaseDir } from "./helpers";

const DEFAULT_UPDATE_BASE_URL = "https://flatina.github.io/flget";
const UPDATE_BASE_URL_ENV = "FLGET_UPDATE_BASE_URL";
const SELF_UPDATE_SYNC_ENV = "FLGET_SELF_UPDATE_SYNC";

function mergePersist(left: PersistDef[], right: PersistDef[]): PersistDef[] {
  const map = new Map<string, PersistDef>();
  for (const entry of [...left, ...right]) {
    map.set(`${entry.source}::${entry.target}`, entry);
  }
  return [...map.values()];
}

function getSelfUpdateBaseUrl(): string {
  return (process.env[UPDATE_BASE_URL_ENV] ?? DEFAULT_UPDATE_BASE_URL).replace(/\/+$/, "");
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

async function createFallbackUpdateLauncher(root: string, tempDir: string, baseUrl: string): Promise<string> {
  const launcherDir = join(tempDir, `self-update-launcher-${randomULID()}`);
  await ensureDir(launcherDir);
  const launcherPath = join(launcherDir, "launch-update.ps1");
  const escapedRoot = escapePowerShellSingleQuotedString(root);
  const escapedBaseUrl = escapePowerShellSingleQuotedString(baseUrl);

  await writeText(launcherPath, `#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$root = '${escapedRoot}'
$baseUrl = '${escapedBaseUrl}'
$sessionDir = Join-Path $root ("tmp\\self-update\\bootstrap-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null
$updateScript = Join-Path $sessionDir "update.ps1"
Invoke-WebRequest -Uri "$baseUrl/update.ps1" -OutFile $updateScript
& $updateScript -RootPath $root -BaseUrl $baseUrl
exit $LASTEXITCODE
`);

  return launcherPath;
}

async function runSelfUpdate(context: RuntimeContext): Promise<void> {
  const baseUrl = getSelfUpdateBaseUrl();
  const updateScriptPath = await pathExists(context.dirs.updatePs1)
    ? context.dirs.updatePs1
    : await createFallbackUpdateLauncher(context.root, context.dirs.temp, baseUrl);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", updateScriptPath, "-RootPath", context.root, "-BaseUrl", baseUrl];

  if (process.env[SELF_UPDATE_SYNC_ENV] === "1") {
    const result = await runCommand(["powershell", ...args], { cwd: context.root });
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    return;
  }

  const child = spawn("powershell", args, {
    cwd: context.root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  console.log("Started flget self-update in a new PowerShell process.");
}

async function getUniqueVersionPath(baseDir: string, version: string): Promise<string> {
  let candidate = join(baseDir, version);
  let index = 1;
  while (await pathExists(candidate)) {
    candidate = join(baseDir, `${version}-${index}`);
    index += 1;
  }
  return candidate;
}

function isUnchangedSkillUpdate(existing: PackageMeta, nextMeta: PackageMeta): boolean {
  return existing.installKind === "skill"
    && nextMeta.installKind === "skill"
    && existing.skill.folderHash === nextMeta.skill.folderHash;
}

async function updateOne(context: RuntimeContext, existing: PackageMeta, options: InstallOptions): Promise<void> {
  const winner = await loadPackageMeta(context.root, existing.id);
  const isWinner = winner?.sourceType === existing.sourceType;
  assertSourceEnabled(context.config, getSourceFamilyByType(existing.sourceType).cliSource);

  const resolution = await resolveSource(context, existing.sourceRef, options);
  const { resolved } = resolution;
  if (resolved.resolvedVersion === existing.resolvedVersion && resolved.resolvedRef === existing.resolvedRef) {
    console.log(`${existing.id} is already up to date.`);
    return;
  }

  const stagingDir = join(context.dirs.temp, `${resolved.id}-${randomULID()}`);
  const packageBase = getPackageBaseDir(context, existing.id, existing.sourceType);
  const currentPath = getCurrentPath(context, existing.id, existing.sourceType);
  const previousVersionPath = await getUniqueVersionPath(packageBase, existing.resolvedVersion);
  resolved.extra = {
    ...resolved.extra,
    installPath: currentPath,
  };
  await ensureDir(stagingDir);

  await createTransaction(context.root, existing.id, "update", {
    targetVersion: resolved.resolvedVersion,
    previousVersion: existing.resolvedVersion,
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
      await setTransactionPhase(context.root, existing.id, phase);
    });
    await setTransactionPhase(context.root, existing.id, "staging-ready");

    const nextMeta = buildPackageMeta(resolved, prepared);
    if (options.tags?.length) {
      nextMeta.tags = options.tags;
    } else if (existing.tags?.length) {
      nextMeta.tags = [...existing.tags];
    }
    if (isUnchangedSkillUpdate(existing, nextMeta)) {
      await removePath(stagingDir);
      await savePackageMeta(context.root, nextMeta);
      console.log(`${existing.id} skill content is already up to date.`);
      await completeTransaction(context.root, existing.id);
      return;
    }

    await setTransactionPhase(context.root, existing.id, "committing", {
      previousVersionPath,
    });
    await renameStrict(currentPath, previousVersionPath);
    await updateTransaction(context.root, existing.id, { previousVersionPath });

    try {
      await renameStrict(stagingDir, currentPath);
    } catch (error) {
      if (!await pathExists(currentPath) && await pathExists(previousVersionPath)) {
        await renameStrict(previousVersionPath, currentPath);
      }
      throw error;
    }

    const effectivePersistType = nextMeta.persistType
      ?? (existing.persist.length > 0 ? "folder-migrate" : "none");

    if (effectivePersistType === "folder-migrate") {
      await setTransactionPhase(context.root, existing.id, "persisting");
      try {
        await applyPersistTransaction(previousVersionPath, currentPath, mergePersist(existing.persist, nextMeta.persist), context.logger);
      } catch (error) {
        const failedCurrentPath = await getUniqueVersionPath(packageBase, `${nextMeta.resolvedVersion}-failed`);
        await rollbackCommittedUpdate(currentPath, previousVersionPath, failedCurrentPath);
        throw error;
      }
    } else if (existing.persistType === "folder-migrate" || (!existing.persistType && existing.persist.length > 0)) {
      context.logger.warn(`${existing.id}: persistType changed from folder-migrate. Previous data may be in: ${previousVersionPath}`);
    }

    await setTransactionPhase(context.root, existing.id, "shimming");
    await savePackageMeta(context.root, nextMeta);
    if (isWinner) {
      await refreshPackageShims(context.root, existing, nextMeta);
    }
    await refreshActivationCache(context.root);
    await completeTransaction(context.root, existing.id);

    console.log(`Updated ${existing.id}: ${existing.resolvedVersion} -> ${nextMeta.resolvedVersion}`);
    for (const warning of nextMeta.warnings) {
      console.warn(`[warn] ${warning}`);
    }
  } catch (error) {
    await failTransaction(context.root, existing.id, error);
    throw error;
  }
}

export async function runUpdateCommand(
  context: RuntimeContext,
  packageId: string | undefined,
  updateAll: boolean,
  noSelf: boolean,
  options: InstallOptions,
): Promise<void> {
  if (updateAll) {
    const metas = await listPackageMetas(context.root);
    const failures: string[] = [];
    for (const meta of metas) {
      try {
        await updateOne(context, meta, options);
      } catch (error) {
        failures.push(`${meta.id} (${getSourceFamilyByType(meta.sourceType).cliSource}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Some updates failed:\n${failures.join("\n")}`);
    }
    if (!noSelf) {
      await runSelfUpdate(context);
    }
    return;
  }

  if (!packageId) {
    if (noSelf) {
      throw new Error("Usage: flget update [<package>] [--all] [--no-self]");
    }
    await runSelfUpdate(context);
    return;
  }

  const meta = await loadPackageMeta(context.root, packageId);
  if (!meta) {
    throw new Error(`Package not found: ${packageId}`);
  }
  await updateOne(context, meta, options);
}
