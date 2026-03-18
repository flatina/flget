
import { getCurrentPath } from "./helpers";
import { refreshActivationCache } from "../core/activation-cache";
import { loadPackageMeta } from "../core/metadata";
import { completeTransaction, listTransactions, loadTransaction } from "../core/transaction";
import { createShims, deleteShims } from "../core/shim";
import { pathExists, removePath, renameStrict } from "../utils/fs";
import type { RuntimeContext } from "../core/types";

export async function runRepairCommand(context: RuntimeContext, packageId?: string): Promise<void> {
  if (!packageId) {
    const transactions = await listTransactions(context.root);
    if (transactions.length === 0) {
      console.log("No incomplete transactions.");
      return;
    }
    for (const transaction of transactions) {
      console.log(`${transaction.id}\t${transaction.operation}\t${transaction.phase}\t${transaction.lastError ?? ""}`);
    }
    return;
  }

  const transaction = await loadTransaction(context.root, packageId);
  if (!transaction) {
    throw new Error(`No incomplete transaction found for ${packageId}`);
  }

  const meta = await loadPackageMeta(context.root, packageId);
  let repaired = false;

  if (meta) {
    const currentPath = getCurrentPath(context, meta.id, meta.sourceType);
    if (!await pathExists(currentPath) && transaction.previousVersionPath && await pathExists(transaction.previousVersionPath)) {
      await renameStrict(transaction.previousVersionPath, currentPath);
      repaired = true;
    }

    if (await pathExists(currentPath)) {
      await deleteShims(context.root, meta.bin);
      await createShims(context.root, meta.sourceType, meta.id, meta.bin);
      repaired = true;
    }
  }

  if (transaction.stagingPath && await pathExists(transaction.stagingPath)) {
    await removePath(transaction.stagingPath);
    repaired = true;
  }

  if (!repaired) {
    throw new Error(`Unable to repair ${packageId} automatically.`);
  }

  await refreshActivationCache(context.root);
  await completeTransaction(context.root, packageId);
  console.log(`Repaired ${packageId}`);
}
