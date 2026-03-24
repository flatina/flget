import { relative } from "node:path";
import type { RuntimeContext } from "../core/types";

export interface EnvOptions {
  toml?: boolean;
}

const ENV_VERSION = 2;

export async function runEnvCommand(context: RuntimeContext, options: EnvOptions = {}): Promise<void> {
  const { dirs, config } = context;
  const rel = (abs: string) => relative(dirs.root, abs).replace(/\\/g, "/");
  const sources = Object.entries(config.sources).filter(([, v]) => v).map(([k]) => k);

  if (options.toml) {
    const lines: string[] = [];
    lines.push(`env_version = ${ENV_VERSION}`);
    lines.push(`root = ${quoteToml(dirs.root)}`);
    lines.push(`shims_dir = ${quoteToml(rel(dirs.shims))}`);
    lines.push(`config_file = ${quoteToml(rel(dirs.configFile))}`);
    lines.push(`sources = ${tomlArray(sources)}`);
    if (config.buckets.length > 0) {
      lines.push(`buckets = ${tomlArray(config.buckets.map((b) => b.name))}`);
    }
    if (config.roots.length > 0) {
      lines.push(`offline_roots = ${tomlArray(config.roots.map((r) => r.path))}`);
    }
    lines.push(`xdg_config = ${quoteToml(rel(dirs.xdgConfig))}`);
    lines.push(`xdg_data = ${quoteToml(rel(dirs.xdgData))}`);
    lines.push(`xdg_state = ${quoteToml(rel(dirs.xdgState))}`);
    lines.push(`xdg_cache = ${quoteToml(rel(dirs.xdgCache))}`);
    console.log(lines.join("\n"));
    return;
  }

  console.log(`FL_ENV_VERSION=${ENV_VERSION}`);
  console.log(`FL_ROOT=${dirs.root}`);
  console.log(`FL_SHIMS_DIR=${rel(dirs.shims)}`);
  console.log(`FL_CONFIG_FILE=${rel(dirs.configFile)}`);
  console.log(`FL_SOURCES=${sources.join(",")}`);
  if (config.buckets.length > 0) {
    console.log(`FL_BUCKETS=${config.buckets.map((b) => b.name).join(",")}`);
  }
  if (config.roots.length > 0) {
    console.log(`FL_OFFLINE_ROOTS=${config.roots.map((r) => r.path).join(",")}`);
  }
  console.log(`FL_XDG_CONFIG=${rel(dirs.xdgConfig)}`);
  console.log(`FL_XDG_DATA=${rel(dirs.xdgData)}`);
  console.log(`FL_XDG_STATE=${rel(dirs.xdgState)}`);
  console.log(`FL_XDG_CACHE=${rel(dirs.xdgCache)}`);
}

function quoteToml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlArray(values: string[]): string {
  return `[${values.map(quoteToml).join(", ")}]`;
}
