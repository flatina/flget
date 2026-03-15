import { listPackageMetas } from "../core/metadata";
import { pad } from "../utils/strings";

export async function runListCommand(root: string, asJson: boolean): Promise<void> {
  const packages = await listPackageMetas(root);
  if (asJson) {
    console.log(JSON.stringify(packages, null, 2));
    return;
  }

  if (packages.length === 0) {
    console.log("No packages installed.");
    return;
  }

  const headers = ["Package", "Version", "Source", "Portability"];
  const rows = packages.map((meta) => [
    meta.id,
    meta.resolvedVersion,
    meta.sourceType,
    meta.portability,
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)));

  console.log(headers.map((header, index) => pad(header, widths[index]!)).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(row.map((value, index) => pad(value, widths[index]!)).join("  "));
  }
}
