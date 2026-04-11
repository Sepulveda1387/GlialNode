import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const target = resolve("dist");
const maxAttempts = 5;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    if (existsSync(target)) {
      rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 75,
      });
    }

    process.exit(0);
  } catch (error) {
    if (attempt === maxAttempts) {
      throw error;
    }

    await delay(100 * attempt);
  }
}
