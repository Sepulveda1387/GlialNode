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
    const wantsJson = parsed.flags.json === "true";

    if (wantsJson) {
      for (const line of result.lines) {
        console.log(line);
      }
      return;
    }

    console.log("GlialNode CLI");
    console.log(`storage=${sqliteAdapter.name}`);
    console.log(`schemaVersion=${repository.getSchemaVersion()}`);
    console.log(`schemaLatest=${sqliteAdapter.schemaVersion}`);
    console.log(`database=${databasePath}`);

    for (const line of result.lines) {
      console.log(line);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wantsJson = parsed.flags.json === "true";

    if (wantsJson) {
      console.error(
        JSON.stringify(
          {
            error: message,
            storage: sqliteAdapter.name,
            schemaVersion: repository.getSchemaVersion(),
            schemaLatest: sqliteAdapter.schemaVersion,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.error("GlialNode CLI");
    console.error(`storage=${sqliteAdapter.name}`);
    console.error(`schemaVersion=${repository.getSchemaVersion()}`);
    console.error(`schemaLatest=${sqliteAdapter.schemaVersion}`);
    console.error(`error=${message}`);
    console.error(usageText());
    process.exitCode = 1;
  } finally {
    repository.close();
  }
}

void main();
