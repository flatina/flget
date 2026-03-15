import { ensureRootInitialized, ensureRootScripts } from "../core/root";

export async function runEnvCommand(root: string): Promise<void> {
  await ensureRootInitialized(root);
  await ensureRootScripts(root);
  console.log("Regenerated env caches.");
}
