#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { sqliteAdapter } from "../storage/index.js";
import { parseArgs } from "./args.js";
import { createRepository, runCommand, usageText } from "./commands.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const databasePath = resolve(parsed.flags.db ?? ".glialnode/glialnode.sqlite");
  const databaseExistedAtStartup = existsSync(databasePath);
  const databaseParentExistedAtStartup = existsSync(dirname(databasePath));
  let repository: ReturnType<typeof createRepository> | undefined;

  try {
    repository = createRepository(databasePath);
    const result = await runCommand(parsed, {
      repository,
      databasePath,
      databaseExistedAtStartup,
      databaseParentExistedAtStartup,
    });
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
    const schemaVersion = repository ? repository.getSchemaVersion() : "unavailable";

    if (wantsJson) {
      console.error(
        JSON.stringify(
          {
            error: message,
            storage: sqliteAdapter.name,
            schemaVersion,
            schemaLatest: sqliteAdapter.schemaVersion,
            database: databasePath,
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
    console.error(`schemaVersion=${schemaVersion}`);
    console.error(`schemaLatest=${sqliteAdapter.schemaVersion}`);
    console.error(`database=${databasePath}`);
    console.error(`error=${message}`);
    console.error(usageText());
    process.exitCode = 1;
  } finally {
    repository?.close();
  }
}

void main();
