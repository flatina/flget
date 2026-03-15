import { resolve } from "node:path";
import { readConfig, writeConfig } from "../core/config";
import { ROOT_CONFIG_NAME } from "../core/dirs";
import type { RuntimeContext } from "../core/types";
import { pathExists } from "../utils/fs";

function normalizeRootPath(path: string): string {
  return resolve(path);
}

async function assertRootExists(path: string): Promise<void> {
  const normalized = normalizeRootPath(path);
  if (!await pathExists(resolve(normalized, ROOT_CONFIG_NAME))) {
    throw new Error(`Not a flget root: ${normalized}`);
  }
}

function findRootIndex(roots: Array<{ path: string }>, value: string): number {
  const normalized = normalizeRootPath(value);
  return roots.findIndex((entry) => normalizeRootPath(entry.path) === normalized);
}

export async function runRootCommand(context: RuntimeContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const config = await readConfig(context.root);

  switch (subcommand) {
    case "list":
      for (const entry of config.roots) {
        console.log(entry.path);
      }
      return;
    case "add": {
      const [path] = rest;
      if (!path) {
        throw new Error("Usage: flget root add <path>");
      }
      await assertRootExists(path);
      const normalized = normalizeRootPath(path);
      if (findRootIndex(config.roots, normalized) >= 0) {
        throw new Error(`Root already exists: ${normalized}`);
      }
      config.roots.push({ path: normalized });
      await writeConfig(context.root, config);
      console.log(`Added root ${normalized}`);
      return;
    }
    case "remove": {
      const [path] = rest;
      if (!path) {
        throw new Error("Usage: flget root remove <path>");
      }
      const index = findRootIndex(config.roots, path);
      if (index < 0) {
        throw new Error(`Root not found: ${normalizeRootPath(path)}`);
      }
      const [removed] = config.roots.splice(index, 1);
      await writeConfig(context.root, config);
      console.log(`Removed root ${removed.path}`);
      return;
    }
    case "first": {
      const [path] = rest;
      if (!path) {
        throw new Error("Usage: flget root first <path>");
      }
      const index = findRootIndex(config.roots, path);
      if (index < 0) {
        throw new Error(`Root not found: ${normalizeRootPath(path)}`);
      }
      const [entry] = config.roots.splice(index, 1);
      config.roots.unshift(entry);
      await writeConfig(context.root, config);
      console.log(`Moved root to first ${entry.path}`);
      return;
    }
    case "last": {
      const [path] = rest;
      if (!path) {
        throw new Error("Usage: flget root last <path>");
      }
      const index = findRootIndex(config.roots, path);
      if (index < 0) {
        throw new Error(`Root not found: ${normalizeRootPath(path)}`);
      }
      const [entry] = config.roots.splice(index, 1);
      config.roots.push(entry);
      await writeConfig(context.root, config);
      console.log(`Moved root to last ${entry.path}`);
      return;
    }
    default:
      throw new Error("Usage: flget root <add|remove|list|first|last> ...");
  }
}
