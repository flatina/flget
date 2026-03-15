import { dirname, join } from "node:path";
import type { Logger, PersistDef } from "./types";
import { ensureDir, pathExists, removePath, renameStrict } from "../utils/fs";

interface AppliedPersistEntry {
  source: string;
  target: string;
  backup?: string;
}

export async function applyPersistTransaction(
  oldVersionPath: string,
  currentPath: string,
  persistDefs: PersistDef[],
  logger: Logger,
): Promise<void> {
  const applied: AppliedPersistEntry[] = [];

  try {
    for (const entry of persistDefs) {
      const source = join(oldVersionPath, entry.source);
      const target = join(currentPath, entry.target);

      if (!await pathExists(source)) {
        continue;
      }

      await ensureDir(dirname(target));

      let backup: string | undefined;
      if (await pathExists(target)) {
        backup = `${target}.flget-backup`;
        logger.warn(`persist target exists, backing up ${target}`);
        await removePath(backup);
        await renameStrict(target, backup);
      }

      await renameStrict(source, target);
      applied.push({ source, target, backup });
    }
  } catch (error) {
    await rollbackPersistTransaction(applied);
    throw new Error(
      `persist migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function rollbackPersistTransaction(applied: AppliedPersistEntry[]): Promise<void> {
  for (const entry of applied.reverse()) {
    if (await pathExists(entry.target)) {
      await ensureDir(dirname(entry.source));
      await renameStrict(entry.target, entry.source);
    }
    if (entry.backup && await pathExists(entry.backup)) {
      await renameStrict(entry.backup, entry.target);
    }
  }
}

export async function rollbackCommittedUpdate(
  currentPath: string,
  previousVersionPath: string,
  failedCurrentPath: string,
): Promise<void> {
  if (!await pathExists(previousVersionPath)) {
    return;
  }

  if (!await pathExists(currentPath)) {
    await renameStrict(previousVersionPath, currentPath);
    return;
  }

  await renameStrict(currentPath, failedCurrentPath);
  await renameStrict(previousVersionPath, currentPath);
}
