import { join } from "node:path";
import type { Transaction, TransactionOperation, TransactionPhase } from "./types";
import { pathExists, readJson, removePath, writeJson } from "../utils/fs";
import { scanGlob } from "../utils/runtime";
import { getDirs } from "./dirs";

function getTransactionPath(root: string, id: string): string {
  return join(getDirs(root).transactions, `${id}.json`);
}

export async function createTransaction(
  root: string,
  id: string,
  operation: TransactionOperation,
  fields: Partial<Transaction> = {},
): Promise<Transaction> {
  const transaction: Transaction = {
    id,
    operation,
    phase: "started",
    startedAt: new Date().toISOString(),
    ...fields,
  };
  await writeJson(getTransactionPath(root, id), transaction);
  return transaction;
}

export async function loadTransaction(root: string, id: string): Promise<Transaction | null> {
  const target = getTransactionPath(root, id);
  if (!await pathExists(target)) {
    return null;
  }
  return readJson<Transaction>(target);
}

export async function updateTransaction(root: string, id: string, patch: Partial<Transaction>): Promise<Transaction> {
  const current = await loadTransaction(root, id);
  if (!current) {
    throw new Error(`Transaction not found: ${id}`);
  }
  const next = { ...current, ...patch };
  await writeJson(getTransactionPath(root, id), next);
  return next;
}

export async function setTransactionPhase(root: string, id: string, phase: TransactionPhase, patch: Partial<Transaction> = {}): Promise<void> {
  await updateTransaction(root, id, { ...patch, phase });
}

export async function failTransaction(root: string, id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await updateTransaction(root, id, {
    phase: "failed",
    lastError: message,
    failedAt: new Date().toISOString(),
  });
}

export async function completeTransaction(root: string, id: string): Promise<void> {
  await removePath(getTransactionPath(root, id));
}

export async function listTransactions(root: string): Promise<Transaction[]> {
  const dirs = getDirs(root);
  if (!await pathExists(dirs.transactions)) {
    return [];
  }
  const entries = await scanGlob("*.json", dirs.transactions);
  const transactions = await Promise.all(
    entries.map((entry) => readJson<Transaction>(join(dirs.transactions, entry))),
  );
  return transactions.sort((left, right) => left.id.localeCompare(right.id));
}
