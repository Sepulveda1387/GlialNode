#!/usr/bin/env node

import { resolve } from "node:path";

import { sqliteAdapter } from "../storage/index.js";
import { parseArgs } from "./args.js";
import { createRepository, runCommand, usageText } from "./commands.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const databasePath = resolve(parsed.flags.db ?? ".glialnode/glialnode.sqlite");
  const repository = createRepository(databasePath);

  try {
    const result = await runCommand(parsed, { repository });
    console.log("GlialNode CLI");
    console.log(`storage=${sqliteAdapter.name}`);
    console.log(`schemaVersion=${sqliteAdapter.schemaVersion}`);
    console.log(`database=${databasePath}`);

    for (const line of result.lines) {
      console.log(line);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("GlialNode CLI");
    console.error(`storage=${sqliteAdapter.name}`);
    console.error(`schemaVersion=${sqliteAdapter.schemaVersion}`);
    console.error(`error=${message}`);
    console.error(usageText());
    process.exitCode = 1;
  } finally {
    repository.close();
  }
}

void main();
