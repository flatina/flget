import { readConfig, writeConfig } from "../core/config";
import { listConfiguredRegistries, syncRegistries } from "../core/registry";
import type { RuntimeContext } from "../core/types";

export async function runRegistryCommand(context: RuntimeContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const config = await readConfig(context.root);

  switch (subcommand) {
    case "list":
      console.log(`local\t${context.dirs.localRegistries}`);
      for (const entry of listConfiguredRegistries(config)) {
        console.log(`${entry.scope}\t${entry.url}`);
      }
      return;
    case "add": {
      const [url] = rest;
      if (!url) {
        throw new Error("Usage: flget registry add <url>");
      }
      if (!config.compatibilityRegistries.community.includes(url)) {
        config.compatibilityRegistries.community.push(url);
        await writeConfig(context.root, config);
      }
      console.log(`Added community registry ${url}`);
      return;
    }
    case "remove": {
      const [url] = rest;
      if (!url) {
        throw new Error("Usage: flget registry remove <url>");
      }
      config.compatibilityRegistries.community = config.compatibilityRegistries.community.filter((entry) => entry !== url);
      await writeConfig(context.root, config);
      console.log(`Removed community registry ${url}`);
      return;
    }
    case "update":
      await syncRegistries({ ...context, config });
      console.log("Updated compatibility registries");
      return;
    default:
      throw new Error("Usage: flget registry <list|add|remove|update> ...");
  }
}
