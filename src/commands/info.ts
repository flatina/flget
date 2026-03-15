import { loadPackageMeta } from "../core/metadata";

export async function runInfoCommand(root: string, id: string): Promise<void> {
  const meta = await loadPackageMeta(root, id);
  if (!meta) {
    throw new Error(`Package not found: ${id}`);
  }
  console.log(JSON.stringify(meta, null, 2));
}
