import { getPackageBaseDir } from "./helpers";
import { deletePackageMetaBySource, loadPackageMeta, promotePackageWinner } from "../core/metadata";
import { refreshActivationCache } from "../core/activation-cache";
import { createShims, deleteShims } from "../core/shim";
import { completeTransaction, createTransaction, failTransaction } from "../core/transaction";
import type { RuntimeContext } from "../core/types";
import { removePath } from "../utils/fs";

export async function runRemoveCommand(context: RuntimeContext, id: string): Promise<void> {
  const meta = await loadPackageMeta(context.root, id);
  if (!meta) {
    throw new Error(`Package not found: ${id}`);
  }

  await createTransaction(context.root, meta.id, "remove");

  try {
    await deleteShims(context.root, meta.bin);
    await removePath(getPackageBaseDir(context, meta.id, meta.sourceType));
    await deletePackageMetaBySource(context.root, meta.sourceType, meta.id);
    const fallbackWinner = await promotePackageWinner(context.root, meta.id);
    if (fallbackWinner) {
      await createShims(context.root, fallbackWinner.sourceType, fallbackWinner.id, fallbackWinner.bin);
    }
    await refreshActivationCache(context.root);
    await completeTransaction(context.root, meta.id);
    console.log(`Removed ${id}`);
  } catch (error) {
    await failTransaction(context.root, meta.id, error);
    throw error;
  }
}
