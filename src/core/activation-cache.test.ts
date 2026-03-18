import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshActivationCache } from "./activation-cache";
import { savePackageMeta, setPackageWinner } from "./metadata";
import { ensureRootInitialized } from "./root";

describe("refreshActivationCache", () => {
  test("expands envSet root placeholders into cached activation values", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-config-"));
    await ensureRootInitialized(root);

    await mkdir(join(root, "npm", "codex"), { recursive: true });
    await savePackageMeta(root, {
      id: "codex",
      installKind: "app",
      displayName: "@openai/codex",
      sourceType: "npm",
      sourceRef: "npm:@openai/codex",
      resolvedVersion: "1.0.0",
      resolvedRef: "1.0.0",
      portability: "portable",
      runtime: "bun-native",
      bin: [],
      persist: [],
      envSet: {
        CODEX_HOME: "${FL_ROOT}\\.codex",
        CODEX_CACHE: "${FL_CURRENT}\\cache",
      },
      warnings: [],
      notes: null,
    });
    await setPackageWinner(root, { sourceType: "npm", id: "codex" });

    await refreshActivationCache(root);

    const cache = await readFile(join(root, "tmp", "cache-env-sets.txt"), "utf8");
    expect(cache).toContain(`CODEX_HOME=${root}\\.codex`);
    expect(cache).toContain(`CODEX_CACHE=${join(root, "npm", "codex", "current")}\\cache`);
  });
});
