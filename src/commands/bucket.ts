import { rename } from "node:fs/promises";
import { readConfig, writeConfig } from "../core/config";
import type { RuntimeContext } from "../core/types";
import { ensureDir, pathExists, removePath } from "../utils/fs";
import { getGitHubHeaders, getDefaultBranchHead, getTarballUrl } from "../core/github";
import { parseGitHubRepoUrl } from "../core/github-url";
import { downloadToStore } from "../core/download";
import { getTarballPath, invalidateBucketCache, isLocalBucketUrl } from "../core/bucket-archive";

async function syncBucket(context: RuntimeContext, name: string, url: string): Promise<void> {
  if (isLocalBucketUrl(url)) {
    if (!await pathExists(url)) {
      throw new Error(`Local bucket path does not exist: ${url}`);
    }
    return;
  }

  const parsed = parseGitHubRepoUrl(url);
  if (!parsed) {
    throw new Error(`Unsupported bucket URL (only GitHub repos supported): ${url}`);
  }

  const { owner, repo } = parsed;
  const head = await getDefaultBranchHead(context, owner, repo);
  const tarballUrl = getTarballUrl(owner, repo, head.sha);

  const downloaded = await downloadToStore(context, tarballUrl, {
    requestInit: { headers: await getGitHubHeaders(context) },
    filenameHint: `bucket-${name}.tar.gz`,
  });

  await ensureDir(context.dirs.buckets);
  const targetPath = getTarballPath(context.dirs.buckets, name);
  await rename(downloaded.path, targetPath);
  invalidateBucketCache(context.dirs.buckets, name);
}

export async function syncBucketIfNeeded(context: RuntimeContext, name: string): Promise<void> {
  const tarball = getTarballPath(context.dirs.buckets, name);
  if (await pathExists(tarball)) {
    return;
  }

  // Check if it's a local-path bucket
  const bucket = context.config.buckets.find((entry) => entry.name === name);
  if (bucket && isLocalBucketUrl(bucket.url)) {
    return;
  }

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
      // Clean up tarball
      const tarball = getTarballPath(context.dirs.buckets, name);
      if (await pathExists(tarball)) {
        await removePath(tarball);
      }
      invalidateBucketCache(context.dirs.buckets, name);
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
