import { resolve } from "node:path";
import { readConfig, writeConfig } from "../core/config";
import { ROOT_CONFIG_NAME } from "../core/dirs";
import type { RuntimeContext } from "../core/types";
import { pathExists } from "../utils/fs";

export function isRemoteDepot(uri: string): boolean {
  return uri.startsWith("http://") || uri.startsWith("https://");
}

function normalizeDepotUri(uri: string): string {
  if (isRemoteDepot(uri)) {
    return uri.replace(/\/+$/, "");
  }
  return resolve(uri);
}

async function assertDepotExists(uri: string): Promise<void> {
  const normalized = normalizeDepotUri(uri);
  if (isRemoteDepot(normalized)) {
    const indexUrl = `${normalized}/depot/index.json`;
    try {
      const response = await fetch(indexUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw new Error(`Remote depot returned ${response.status}: ${indexUrl}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("returned")) {
        throw error;
      }
      throw new Error(`Cannot reach remote depot: ${indexUrl}`);
    }
  } else {
    if (!await pathExists(resolve(normalized, ROOT_CONFIG_NAME))) {
      throw new Error(`Not a flget root: ${normalized}`);
    }
  }
}

function findDepotIndex(depots: Array<{ uri: string }>, value: string): number {
  const normalized = normalizeDepotUri(value);
  return depots.findIndex((entry) => normalizeDepotUri(entry.uri) === normalized);
}

export async function runDepotCommand(context: RuntimeContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const config = await readConfig(context.root);

  switch (subcommand) {
    case "list":
      for (const entry of config.depots) {
        console.log(entry.uri);
      }
      return;
    case "add": {
      const [uri] = rest;
      if (!uri) {
        throw new Error("Usage: flget depot add <path-or-url>");
      }
      await assertDepotExists(uri);
      const normalized = normalizeDepotUri(uri);
      if (findDepotIndex(config.depots, normalized) >= 0) {
        throw new Error(`Depot already exists: ${normalized}`);
      }
      config.depots.push({ uri: normalized });
      await writeConfig(context.root, config);
      console.log(`Added depot ${normalized}`);
      return;
    }
    case "remove": {
      const [uri] = rest;
      if (!uri) {
        throw new Error("Usage: flget depot remove <path-or-url>");
      }
      const index = findDepotIndex(config.depots, uri);
      if (index < 0) {
        throw new Error(`Depot not found: ${normalizeDepotUri(uri)}`);
      }
      const [removed] = config.depots.splice(index, 1);
      await writeConfig(context.root, config);
      console.log(`Removed depot ${removed.uri}`);
      return;
    }
    case "first": {
      const [uri] = rest;
      if (!uri) {
        throw new Error("Usage: flget depot first <path-or-url>");
      }
      const index = findDepotIndex(config.depots, uri);
      if (index < 0) {
        throw new Error(`Depot not found: ${normalizeDepotUri(uri)}`);
      }
      const [entry] = config.depots.splice(index, 1);
      config.depots.unshift(entry);
      await writeConfig(context.root, config);
      console.log(`Moved depot to first ${entry.uri}`);
      return;
    }
    case "last": {
      const [uri] = rest;
      if (!uri) {
        throw new Error("Usage: flget depot last <path-or-url>");
      }
      const index = findDepotIndex(config.depots, uri);
      if (index < 0) {
        throw new Error(`Depot not found: ${normalizeDepotUri(uri)}`);
      }
      const [entry] = config.depots.splice(index, 1);
      config.depots.push(entry);
      await writeConfig(context.root, config);
      console.log(`Moved depot to last ${entry.uri}`);
      return;
    }
    default:
      throw new Error("Usage: flget depot <add|remove|list|first|last> ...");
  }
}
