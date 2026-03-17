import { readConfig, writeConfig } from "../core/config";
import { listConfiguredRegistries, syncRegistries } from "../core/registry";
import type { RuntimeContext } from "../core/types";

export async function runRegistryCommand(context: RuntimeContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const config = await readConfig(context.root);

  switch (subcommand) {
    case "list":
      console.log(`local\t${context.dirs.compatLocal}`);
      for (const entry of listConfiguredRegistries(config)) {
        console.log(`${entry.scope}\t${entry.url}`);
      }
      return;
    case "add": {
      const [url] = rest;
      if (!url) {
        throw new Error("Usage: flget compat add <url>");
      }
      if (!config.compatRegistries.community.includes(url)) {
        config.compatRegistries.community.push(url);
        await writeConfig(context.root, config);
      }
      console.log(`Added community compat source ${url}`);
      return;
    }
    case "remove": {
      const [url] = rest;
      if (!url) {
        throw new Error("Usage: flget compat remove <url>");
      }
      config.compatRegistries.community = config.compatRegistries.community.filter((entry) => entry !== url);
      await writeConfig(context.root, config);
      console.log(`Removed community compat source ${url}`);
      return;
    }
    case "update":
      await syncRegistries({ ...context, config });
      console.log("Updated compatibility sources");
      return;
    default:
      throw new Error("Usage: flget compat <list|add|remove|update> ...");
  }
}
