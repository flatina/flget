import type { Arch } from "./types";

export function detectHostArch(): Arch {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "ia32":
      return "32bit";
    default:
      return "64bit";
  }
}

export function resolveArch(override?: Arch | null): Arch {
  return override ?? detectHostArch();
}
