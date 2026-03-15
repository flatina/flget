import type { FlgetConfig, Logger } from "../core/types";

const levelWeight: Record<NonNullable<FlgetConfig["logLevel"]>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level: FlgetConfig["logLevel"] = "info"): Logger {
  const threshold = levelWeight[level];

  function emit(target: keyof Logger, weight: number, prefix: string, message: string): void {
    if (weight < threshold) {
      return;
    }

    const line = `${prefix} ${message}`;
    if (target === "error") {
      console.error(line);
      return;
    }
    if (target === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  }

  return {
    debug(message) {
      emit("debug", levelWeight.debug, "[debug]", message);
    },
    info(message) {
      emit("info", levelWeight.info, "[info]", message);
    },
    warn(message) {
      emit("warn", levelWeight.warn, "[warn]", message);
    },
    error(message) {
      emit("error", levelWeight.error, "[error]", message);
    },
  };
}
