import type { FundingInfo, FundingLink } from "../core/funding";
import { listPackageMetas, loadPackageMeta } from "../core/metadata";
import type { AppPackageMeta, PackageMeta, RuntimeContext } from "../core/types";
import { getResolverBySourceType } from "../sources";

interface FundResult {
  id: string;
  sourceType: PackageMeta["sourceType"];
  links: FundingLink[];
  message: string | null;
}

async function resolveFundingForMeta(
  context: RuntimeContext,
  meta: AppPackageMeta,
  cache: Map<string, Promise<FundingInfo>>,
): Promise<FundResult | null> {
  const resolver = getResolverBySourceType(meta.sourceType);
  if (!resolver.resolveFunding) {
    return null;
  }

  const info = await resolver.resolveFunding(context, meta, cache);
  if (!info || (info.links.length === 0 && !info.message)) {
    return null;
  }

  return {
    id: meta.id,
    sourceType: meta.sourceType,
    links: info.links,
    message: info.message,
  };
}

function formatResult(result: FundResult): string {
  const links = result.links.map((link) => `${link.platform}: ${link.url}`).join(" | ");
  const message = result.message ? `\t${result.message}` : "";
  return `${result.id}\t${result.sourceType}\t${links || "-"}${message}`;
}

export async function runFundCommand(context: RuntimeContext, packageId: string | undefined): Promise<void> {
  const cache = new Map<string, Promise<FundingInfo>>();
  const metas = packageId
    ? [await loadPackageMeta(context.root, packageId)].filter((entry): entry is PackageMeta => entry !== null)
    : await listPackageMetas(context.root);
  const appMetas = metas.filter((entry): entry is AppPackageMeta => entry.installKind === "app");

  if (packageId && metas.length === 0) {
    throw new Error(`Package not found: ${packageId}`);
  }

  const results = (await Promise.all(appMetas.map((meta) => resolveFundingForMeta(context, meta, cache))))
    .filter((entry): entry is FundResult => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id) || left.sourceType.localeCompare(right.sourceType));

  if (results.length === 0) {
    console.log(packageId ? `No funding information found for ${packageId}.` : "No funding information found.");
    return;
  }

  for (const result of results) {
    console.log(formatResult(result));
  }
}
