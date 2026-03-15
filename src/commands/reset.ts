import { regenerateEnvScripts } from "../core/env-script";
import { loadPackageMeta, loadPackageMetaBySource, setPackageWinner } from "../core/metadata";
import { getSourceFamilyByCliSource } from "../core/source-family";
import { createShims, deleteShims } from "../core/shim";
import type { InstallSource, RuntimeContext } from "../core/types";
import { pathExists } from "../utils/fs";
import { getCurrentPath } from "./helpers";

export async function runResetCommand(
  context: RuntimeContext,
  id: string,
  source?: InstallSource,
): Promise<void> {
  const previousWinner = await loadPackageMeta(context.root, id);
  const selected = source
    ? await loadPackageMetaBySource(context.root, getSourceFamilyByCliSource(source).sourceType, id)
    : previousWinner;

  if (!selected) {
    throw new Error(source ? `Package not found: ${id} (${source})` : `Package not found: ${id}`);
  }

  const currentPath = getCurrentPath(context, selected.id, selected.sourceType);
  if (!await pathExists(currentPath)) {
    throw new Error(`Current path not found: ${currentPath}`);
  }

  if (previousWinner) {
    await deleteShims(context.root, previousWinner.bin);
  }
  await setPackageWinner(context.root, selected);
  await createShims(context.root, selected.sourceType, selected.id, selected.bin);
  await regenerateEnvScripts(context.root);

  if (source && previousWinner?.sourceType !== selected.sourceType) {
    console.log(`Reset ${id} to ${source}`);
    return;
  }
  console.log(`Reset ${id}`);
}
