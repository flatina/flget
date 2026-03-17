import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createWorkspaceManager(): {
  makeWorkspace: () => Promise<{ dir: string }>;
  cleanupWorkspaces: () => Promise<void>;
} {
  const workspaces: Array<{ dir: string }> = [];

  return {
    async makeWorkspace(): Promise<{ dir: string }> {
      const dir = await mkdtemp(join(tmpdir(), "flget-e2e-"));
      const workspace = { dir };
      workspaces.push(workspace);
      return workspace;
    },
    async cleanupWorkspaces(): Promise<void> {
      while (workspaces.length > 0) {
        const workspace = workspaces.pop()!;
        await rm(workspace.dir, { recursive: true, force: true });
      }
    },
  };
}
