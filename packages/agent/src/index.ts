#!/usr/bin/env node

import { RemoteAgent } from "./remote-agent.js";

type CliOptions = {
  bridgeUrl: string;
  pairCode: string;
  relayUrl: string;
  token: string;
};

function readFlag(args: string[], name: string): string | null {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1] ?? null;
  }

  return null;
}

function parseOptions(args: string[]): CliOptions {
  const relayUrl = readFlag(args, "--relay") ?? process.env.CODEX_REMOTE_RELAY_URL;
  const pairCode = readFlag(args, "--pair") ?? process.env.CODEX_REMOTE_PAIR_CODE;
  const bridgeUrl =
    readFlag(args, "--bridge") ??
    process.env.CODEX_REMOTE_BRIDGE_URL ??
    "http://127.0.0.1:8787";
  const token =
    readFlag(args, "--token") ??
    process.env.BRIDGE_TOKEN ??
    process.env.CODEX_REMOTE_BRIDGE_TOKEN ??
    "change-me";

  if (!relayUrl || !pairCode) {
    throw new Error(
      "Usage: codex-remote-agent --relay http://127.0.0.1:8788 --pair PAIRCODE [--bridge http://127.0.0.1:8787] [--token change-me]",
    );
  }

  return {
    bridgeUrl,
    pairCode,
    relayUrl,
    token,
  };
}

const options = parseOptions(process.argv.slice(2));
const agent = new RemoteAgent(options);

process.once("SIGINT", () => {
  agent.close();
  process.exit(0);
});
process.once("SIGTERM", () => {
  agent.close();
  process.exit(0);
});

await agent.connect();
console.log(
  `Codex Remote agent connected: ${options.bridgeUrl} -> ${options.relayUrl} (${options.pairCode})`,
);
