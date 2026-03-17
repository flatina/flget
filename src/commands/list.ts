import { listPackageMetas } from "../core/metadata";
import { pad } from "../utils/strings";

export async function runListCommand(root: string, asJson: boolean, filterTag?: string): Promise<void> {
  let packages = await listPackageMetas(root);
  if (filterTag) {
    packages = packages.filter((meta) => meta.tags?.includes(filterTag));
  }

  if (asJson) {
    console.log(JSON.stringify(packages, null, 2));
    return;
  }

  if (packages.length === 0) {
    console.log(filterTag ? `No packages found with tag "${filterTag}".` : "No packages installed.");
    return;
  }

  const showTags = packages.some((meta) => meta.tags?.length);
  const headers = ["Package", "Version", "Source", "Portability", ...(showTags ? ["Tags"] : [])];
  const rows = packages.map((meta) => [
    meta.id,
    meta.resolvedVersion,
    meta.sourceType,
    meta.portability,
    ...(showTags ? [meta.tags?.join(", ") ?? ""] : []),
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)));

  console.log(headers.map((header, index) => pad(header, widths[index]!)).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(row.map((value, index) => pad(value, widths[index]!)).join("  "));
  }
}
