import { fileURLToPath } from "node:url";

export const cliPath = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
export const testsRoot = fileURLToPath(new URL("../", import.meta.url));
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
