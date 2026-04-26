# Codex Remote PWA

Local-first remote control surface for Codex. The bridge server runs on your computer, the PWA runs in your phone browser, and a private network layer such as Tailscale can expose it safely outside your LAN.

## Why this exists

Codex works well on a desktop, but it is awkward to continue a local coding session from a phone. This project adds a mobile-first control surface on top of a local Codex runtime so you can:

- continue an existing session from your phone
- watch the latest output without opening a remote desktop
- import recent local Codex sessions
- interrupt or approve work from a simpler UI

## What works in this MVP

- Create and list remote sessions
- Send a new prompt from the phone
- Stream timeline events over WebSocket
- Persist sessions, runs, events, and approvals in SQLite
- Resume later prompts through the stored runtime thread id
- Render pending approvals in the phone UI and send approval actions back to the bridge API

## Current runtime shape

- Default fallback runtime: `codex exec --json`
- First-class runtime option: `codex app-server` over WebSocket via `CODEX_APP_SERVER_URL`
- The app-server runtime supports `thread/start`, `turn/start`, `turn/interrupt`, streamed command and assistant events, and pending approval capture
- Approval writeback to app-server is still future work, so phone-side approval actions are visible and persisted, but they do not yet answer the upstream JSON-RPC request

## Architecture

```text
Phone browser / PWA
  -> REST + WebSocket bridge
  -> SQLite session store
  -> Codex runtime adapter
      -> codex app-server (preferred)
      -> codex exec --json (fallback)
```

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Build the app:

```bash
npm run build
```

3. Start Codex app-server if you want the official websocket runtime:

```bash
codex app-server --listen ws://127.0.0.1:8766
```

4. Start the single-port server:

```bash
BRIDGE_TOKEN=your-secret-token \
CODEX_APP_SERVER_URL=ws://127.0.0.1:8766 \
npm run start --workspace @codex-remote/server
```

If `CODEX_APP_SERVER_URL` is omitted, the bridge falls back to the CLI JSON runtime.

5. Open the app locally:

- `http://127.0.0.1:8787/`

The server now serves the built PWA and API on the same port.

## Connection password

The phone UI asks for a connection password. This is simply the `BRIDGE_TOKEN` value you used when starting the server.

- If you open the page with `?token=...` or `?bridgeToken=...`, the UI will prefill it automatically.
- On `localhost`, the development default `change-me` is filled automatically.

## Tailscale setup

If you want phone access outside your LAN, the cleanest path is Tailscale.

Install on macOS:

```bash
brew install tailscale
```

Rootless userspace daemon option:

```bash
/opt/homebrew/opt/tailscale/bin/tailscaled \
  --tun=userspace-networking \
  --socket=/tmp/tailscaled-codex.sock \
  --state=$HOME/.local/share/tailscale/codex-remote.state
```

Login from another terminal:

```bash
tailscale --socket=/tmp/tailscaled-codex.sock up --accept-routes=false --hostname=codex-remote-pwa --qr
```

After login succeeds, expose the single-port app to your tailnet:

```bash
tailscale --socket=/tmp/tailscaled-codex.sock serve --bg 8787
```

Then open the Tailscale HTTPS URL shown by:

```bash
tailscale --socket=/tmp/tailscaled-codex.sock serve status
```

Do not expose the bridge directly to the public internet.

## Repository hygiene

This repository intentionally ignores:

- local SQLite databases
- build artifacts
- `node_modules`
- local runtime scratch directories
- internal planning notes

## Scripts

- `npm test`
- `npm run build`
- `npm run dev --workspace @codex-remote/server`
- `npm run start --workspace @codex-remote/server`
