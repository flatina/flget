import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, normalize } from "node:path";
import { listPackageMetas } from "../core/metadata";
import { getSourceFamilyByType } from "../core/source-family";
import { getStringFlag } from "../utils/cli";
import type { ParsedArgs } from "../utils/cli";

const ALLOWED_ROOTS = new Set(["scoop", "npm", "ghr", "gh", "depot"]);

function isAllowedPath(relativePath: string): boolean {
  const firstSegment = relativePath.split(/[\\/]/)[0];
  return firstSegment !== undefined && ALLOWED_ROOTS.has(firstSegment);
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".tar.gz") || path.endsWith(".tgz")) return "application/gzip";
  return "application/octet-stream";
}

async function buildIndex(root: string): Promise<object> {
  const metas = await listPackageMetas(root);
  const packages = metas
    .filter((meta) => meta.installKind !== "skill")
    .map((meta) => {
      const family = getSourceFamilyByType(meta.sourceType);
      return {
        id: meta.id,
        sourceType: meta.sourceType,
        resolvedVersion: meta.resolvedVersion,
        path: [...family.rootDirSegments, meta.id].join("/"),
      };
    });
  return { version: 1, packages };
}

async function buildTarGz(dirPath: string): Promise<Uint8Array> {
  const proc = Bun.spawn(["tar", "czf", "-", "-C", dirPath, "."], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`tar failed with exit code ${exitCode}`);
  }
  return new Uint8Array(output);
}

export async function runServeCommand(root: string, parsed: ParsedArgs): Promise<void> {
  const port = Number(getStringFlag(parsed.flags, "port") ?? "8080");
  const host = getStringFlag(parsed.flags, "host") ?? "127.0.0.1";

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

      if (!pathname.startsWith("depot/")) {
        return new Response("not found", { status: 404 });
      }

      const depotPath = pathname.slice("depot/".length);

      // /depot/index.json — dynamic catalog
      if (depotPath === "index.json") {
        const index = await buildIndex(root);
        return new Response(JSON.stringify(index, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      // Validate path safety
      const normalizedPath = normalize(depotPath);
      if (normalizedPath.startsWith("..") || normalizedPath.includes("\0")) {
        return new Response("forbidden", { status: 403 });
      }

      if (!isAllowedPath(normalizedPath)) {
        return new Response("not found", { status: 404 });
      }

      // /depot/<path>/meta.json — package metadata
      if (normalizedPath.endsWith("meta.json")) {
        const metaPath = join(root, normalizedPath.replace(/meta\.json$/, "flget.meta.json"));
        try {
          await access(metaPath, fsConstants.R_OK);
        } catch {
          return new Response("not found", { status: 404 });
        }
        return new Response(Bun.file(metaPath), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      // /depot/<path>/current.tar.gz — package archive
      if (normalizedPath.endsWith("current.tar.gz")) {
        const currentDir = join(root, normalizedPath.replace(/current\.tar\.gz$/, "current"));
        try {
          await access(currentDir, fsConstants.R_OK);
        } catch {
          return new Response("not found", { status: 404 });
        }
        try {
          const archive = await buildTarGz(currentDir);
          return new Response(archive, {
            headers: { "content-type": "application/gzip" },
          });
        } catch {
          return new Response("archive generation failed", { status: 500 });
        }
      }

      return new Response("not found", { status: 404 });
    },
  });

  console.log(`Serving depot at http://${host}:${server.port}/`);
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });

  server.stop();
}
