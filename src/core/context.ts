import { readConfig } from "./config";
import { ensureLayout, findFlgetRoot, getDirs } from "./dirs";
import { ensureRootInitialized } from "./root";
import { DEFAULT_SOURCE_ENABLEMENT } from "./source-enablement";
import type { RuntimeContext } from "./types";
import { createLogger } from "../utils/logger";

export async function loadContext(startDir?: string, options?: { createIfMissing?: boolean }): Promise<RuntimeContext> {
  let root = await findFlgetRoot(startDir);
  if (!root && options?.createIfMissing) {
    root = startDir ?? process.cwd();
    await ensureRootInitialized(root);
  }
  if (!root) {
    throw new Error("flget root not found. Run the installer here first.");
  }

  const dirs = await ensureLayout(root);
  const config = await readConfig(root);
  return {
    root,
    dirs,
    config,
    logger: createLogger(config.logLevel),
  };
}

export function createEphemeralContext(root: string, logLevel: RuntimeContext["config"]["logLevel"] = "info"): RuntimeContext {
  const dirs = getDirs(root);
  const config = {
    version: 1 as const,
    arch: null,
    logLevel,
    sources: { ...DEFAULT_SOURCE_ENABLEMENT },
    buckets: [],
    roots: [],
    compatRegistries: {
      official: [],
      community: [],
    },
    useLocalOverrides: true,
  };

  return {
    root,
    dirs,
    config,
    logger: createLogger(logLevel),
  };
}
