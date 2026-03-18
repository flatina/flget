import { getDefaultConfig, writeConfig } from "./config";
import { ensureLayout, ROOT_CONFIG_NAME } from "./dirs";
import { refreshActivationCache } from "./activation-cache";
import { ensureStaticRootShims, regenerateRootShims } from "./shim";
import { pathExists } from "../utils/fs";
import { join } from "node:path";

export async function ensureRootInitialized(root: string): Promise<void> {
  const dirs = await ensureLayout(root);
  if (!await pathExists(dirs.configFile)) {
    await writeConfig(root, getDefaultConfig());
  }
}

export async function ensureRootScripts(root: string): Promise<void> {
  await refreshActivationCache(root);
  try {
    await regenerateRootShims(root);
    await ensureStaticRootShims(root);
  } catch {
    // Read-only roots should still allow static flget shim activation.
  }
}

export async function bootstrapRoot(root: string): Promise<void> {
  await ensureRootInitialized(root);
  await ensureRootScripts(root);
}

export async function rootExists(root: string): Promise<boolean> {
  return pathExists(join(root, ROOT_CONFIG_NAME));
}
