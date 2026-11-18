#!/usr/bin/env node

import { runRemoteLauncher } from "./remote-launcher.mjs";

try {
  process.exitCode = await runRemoteLauncher();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
