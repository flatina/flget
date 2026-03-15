import { join } from "node:path";
import { readConfig, writeConfig } from "../core/config";
import type { RuntimeContext } from "../core/types";
import { pathExists } from "../utils/fs";
import { runCommand } from "../utils/process";

async function gitExists(): Promise<boolean> {
  try {
    await runCommand(["where.exe", "git"]);
    return true;
  } catch {
    return false;
  }
}

function getBucketDir(context: RuntimeContext, name: string): string {
  return join(context.dirs.buckets, name);
}

async function syncBucket(context: RuntimeContext, name: string, url: string): Promise<void> {
  if (!await gitExists()) {
    throw new Error("git is required for bucket sync");
  }
  const target = getBucketDir(context, name);
  const exists = await pathExists(target);
  if (exists) {
    await runCommand(["git", "-C", target, "pull", "--ff-only"]);
  } else {
    await runCommand(["git", "clone", "--depth", "1", url, target]);
  }
}

export async function syncBucketIfNeeded(context: RuntimeContext, name: string): Promise<void> {
  const target = getBucketDir(context, name);
  if (await pathExists(target)) {
    return;
  }
  const bucket = context.config.buckets.find((entry) => entry.name === name);
  if (!bucket) {
    throw new Error(`Bucket not configured: ${name}`);
  }
  await syncBucket(context, bucket.name, bucket.url);
}

export async function runBucketCommand(context: RuntimeContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const config = await readConfig(context.root);

  switch (subcommand) {
    case "list":
      for (const bucket of config.buckets) {
        console.log(`${bucket.name}\t${bucket.url}`);
      }
      return;
    case "add": {
      const [name, url] = rest;
      if (!name || !url) {
        throw new Error("Usage: flget bucket add <name> <url>");
      }
      if (config.buckets.some((bucket) => bucket.name === name)) {
        throw new Error(`Bucket already exists: ${name}`);
      }
      config.buckets.push({ name, url });
      await writeConfig(context.root, config);
      console.log(`Added bucket ${name}`);
      return;
    }
    case "remove": {
      const [name] = rest;
      if (!name) {
        throw new Error("Usage: flget bucket remove <name>");
      }
      config.buckets = config.buckets.filter((bucket) => bucket.name !== name);
      await writeConfig(context.root, config);
      console.log(`Removed bucket ${name}`);
      return;
    }
    case "update": {
      const [name] = rest;
      const targets = name ? config.buckets.filter((bucket) => bucket.name === name) : config.buckets;
      if (targets.length === 0) {
        throw new Error(name ? `Bucket not found: ${name}` : "No buckets configured");
      }
      for (const bucket of targets) {
        await syncBucket(context, bucket.name, bucket.url);
        console.log(`Synced bucket ${bucket.name}`);
      }
      return;
    }
    default:
      throw new Error("Usage: flget bucket <add|remove|list|update> ...");
  }
}
