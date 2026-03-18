import { dirname } from "node:path";
import { refreshActivationCache } from "../core/activation-cache";
import { ensureLayout } from "../core/dirs";

function resolveRootFromScript(): string {
  return dirname(process.argv[1]!);
}

export async function runCacheCommand(args: string[]): Promise<void> {
  const [subcommand] = args;

  switch (subcommand) {
    case "refresh": {
      const root = resolveRootFromScript();
      await ensureLayout(root);
      await refreshActivationCache(root);
      console.log("Refreshed activation caches.");
      return;
    }
    default:
      throw new Error("Usage: flget cache <refresh>");
  }
}
