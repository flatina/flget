import { join } from "node:path";
import { listPackageMetas } from "../core/metadata";
import { getPackageBaseRelativePath } from "../core/package-layout";
import { pad } from "../utils/strings";

function getPackageRelativePath(meta: { sourceType: string; id: string }): string {
  return join(getPackageBaseRelativePath(meta.sourceType, meta.id), "current").replace(/\\/g, "/");
}

export interface ListOptions {
  json?: boolean;
  tsv?: boolean;
  tag?: string;
  path?: boolean;
}

export async function runListCommand(root: string, options: ListOptions): Promise<void> {
  let packages = await listPackageMetas(root);
  if (options.tag) {
    packages = packages.filter((meta) => meta.tags?.includes(options.tag!));
  }

  if (options.json) {
    const data = packages.map((meta) => ({
      ...meta,
      path: getPackageRelativePath(meta),
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (options.tsv) {
    for (const meta of packages) {
      const fields = [
        meta.id, meta.resolvedVersion, meta.sourceType, meta.portability,
        meta.tags?.join(",") ?? "",
        getPackageRelativePath(meta),
      ];
      console.log(fields.join("\t"));
    }
    return;
  }

  if (packages.length === 0) {
    console.log(options.tag ? `No packages found with tag "${options.tag}".` : "No packages installed.");
    return;
  }

  const showTags = packages.some((meta) => meta.tags?.length);
  const headers = [
    "Package", "Version", "Source", "Portability",
    ...(showTags ? ["Tags"] : []),
    ...(options.path ? ["Path"] : []),
  ];
  const rows = packages.map((meta) => [
    meta.id,
    meta.resolvedVersion,
    meta.sourceType,
    meta.portability,
    ...(showTags ? [meta.tags?.join(", ") ?? ""] : []),
    ...(options.path ? [getPackageRelativePath(meta)] : []),
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)));

  console.log(headers.map((header, index) => pad(header, widths[index]!)).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(row.map((value, index) => pad(value, widths[index]!)).join("  "));
  }
}
