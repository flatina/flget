import type { FlgetDirs, SourceType } from "./types";
import { SOURCE_FAMILIES, getSourceFamilyByType } from "./source-family";

export function getPackageBaseRelativePath(sourceType: SourceType, id: string): string {
  return [...getSourceFamilyByType(sourceType).rootDirSegments, id].join("\\");
}

export function getMetaSearchRoots(dirs: FlgetDirs): string[] {
  return SOURCE_FAMILIES.map((family) => dirs[family.dirsKey]);
}
