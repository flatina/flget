import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, normalize } from "node:path";
import { listPackageMetas } from "../core/metadata";
import { getSourceFamilyByType } from "../core/source-family";
import { getStringFlag } from "../utils/cli";
import type { ParsedArgs } from "../utils/cli";

const ALLOWED_ROOTS = new Set(["scoop", "npm", "ghr", "gh", "depot"]);
const SERVED_ROOT_FILES = new Set(["update.ps1", "activate.ps1", "index.html", "version.json"]);
const SERVED_DOWNLOAD_FILES = new Set(["flget.js", "flget.js.map", "activate.ps1", "update.ps1", "bun.exe"]);

function isAllowedPath(relativePath: string): boolean {
  const firstSegment = relativePath.split(/[\\/]/)[0];
  return firstSegment !== undefined && ALLOWED_ROOTS.has(firstSegment);
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

async function serveFile(filePath: string, contentType: string): Promise<Response> {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    return new Response("not found", { status: 404 });
  }
  return new Response(Bun.file(filePath), {
    headers: { "content-type": contentType },
  });
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

      // Root-level files (update.ps1, activate.ps1, index.html, version.json)
      if (pathname === "" || pathname === "index.html") {
        return serveFile(join(root, "index.html"), "text/html; charset=utf-8");
      }
      if (SERVED_ROOT_FILES.has(pathname)) {
        const contentType = pathname.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
        return serveFile(join(root, pathname), contentType);
      }

      // /downloads/<file> — individual runtime files for update.ps1
      if (pathname.startsWith("downloads/")) {
        const filename = pathname.slice("downloads/".length);
        if (SERVED_DOWNLOAD_FILES.has(filename)) {
          return serveFile(join(root, filename), "application/octet-stream");
        }
        return new Response("not found", { status: 404 });
      }

      // Depot endpoints (under /depot/ prefix)
      if (!pathname.startsWith("depot/")) {
        return new Response("not found", { status: 404 });
      }

      const depotPath = pathname.slice("depot/".length);

      if (depotPath === "index.json") {
        const index = await buildIndex(root);
        return new Response(JSON.stringify(index, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      const normalizedPath = normalize(depotPath);
      if (normalizedPath.startsWith("..") || normalizedPath.includes("\0")) {
        return new Response("forbidden", { status: 403 });
      }

      if (!isAllowedPath(normalizedPath)) {
        return new Response("not found", { status: 404 });
      }

      if (normalizedPath.endsWith("meta.json")) {
        return serveFile(
          join(root, normalizedPath.replace(/meta\.json$/, "flget.meta.json")),
          "application/json; charset=utf-8",
        );
      }

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
