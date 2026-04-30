import { createRelayServer } from "./relay.js";

const port = Number(process.env.RELAY_PORT ?? process.env.PORT ?? 8788);
const host = process.env.RELAY_HOST ?? "0.0.0.0";

const relay = createRelayServer();

relay.server.listen(port, host, () => {
  console.log(`Codex Remote relay listening on http://${host}:${port}`);
});
