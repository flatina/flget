import { getDefaultConfig, readConfig, writeConfig } from "../core/config";
import { getDirs } from "../core/dirs";
import { pathExists } from "../utils/fs";

export async function runConfigCommand(args: string[]): Promise<void> {
  const [subcommand] = args;

  switch (subcommand) {
    case "show": {
      const root = process.cwd();
      const dirs = getDirs(root);
      if (!await pathExists(dirs.configFile)) {
        console.log("No config file found. Using defaults.");
      }
      const config = await readConfig(root);
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    case "create": {
      const root = process.cwd();
      const dirs = getDirs(root);
      if (await pathExists(dirs.configFile)) {
        throw new Error(`Config already exists: ${dirs.configFile}`);
      }
      await writeConfig(root, getDefaultConfig());
      console.log(`Created ${dirs.configFile}`);
      return;
    }
    default:
      throw new Error("Usage: flget config <show|create>");
  }
}
