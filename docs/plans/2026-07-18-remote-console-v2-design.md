# Codex Remote Console V2 Design

## Objective

Turn Codex Remote PWA into a task-first mobile console that is easy to start, easy to reopen, and visually calm. The primary success path is:

1. Run one command on the Mac.
2. Open or scan one stable phone URL.
3. Resume the last session or choose a recent Codex thread with one tap.
4. Read progress and send the next prompt without navigating through setup UI.

The design preserves the existing direct and Relay protocols. It does not create a native macOS application, install a launch daemon, or silently alter Tailscale configuration.

## Product Principles

- Conversation first: timeline and composer own the main viewport.
- Progressive disclosure: connection diagnostics, sharing, and manual session creation are secondary surfaces.
- One source of truth: session title and status appear once in the main header.
- Stable access: the launcher reuses a generated token and selected port across runs.
- Honest state: connected, reconnecting, read-only, and failed states use explicit copy and actions.
- Mobile density: avoid nested cards, oversized headings, decorative gradients, and repeated metadata.

## Architecture

### Launcher

Add a Node launcher at `scripts/start-remote.mjs`, exposed as `npm run remote`. It owns process orchestration only:

- Load or create a user config under `~/.codex-remote-pwa/config.json`.
- Generate a cryptographically random bridge token on first run and write the file with user-only permissions.
- Reuse the configured port, defaulting to 8790 for this project.
- Check that the configured port is available before spawning children.
- Start `codex app-server` and the compiled bridge with the resolved environment.
- Detect LAN IPv4 addresses and a connected Tailscale IPv4 address without modifying either network.
- Print a concise access panel with local, LAN, and Tailscale URLs plus a terminal QR code for the preferred reachable URL.
- Forward SIGINT/SIGTERM to both child processes and exit non-zero when a required child fails.

The launcher does not build automatically. If required `dist` outputs are absent, it prints `npm run build` as the corrective action. This avoids hidden long-running builds during startup.

### Bridge Access Metadata

The launcher passes discovered access candidates to the bridge through one JSON environment variable. The bridge exposes them through the authenticated health response. The web client consumes these values only for the Settings share panel. Request execution, session data, and authentication remain unchanged.

### Web State

Persist the last selected bridge session ID in local storage, scoped by connection mode and base URL. On boot:

1. Load sessions and recent native Codex threads.
2. Restore the saved session when it still exists.
3. Otherwise select the first imported session.
4. If there are no imported sessions, render the recent-thread Home state directly.

Selecting a native thread imports it, selects it, persists the selection, and transitions to Chat.

## Information Architecture

### Home

Home is shown only when no bridge session is selected. It contains:

- Compact product header with connection state and Settings action.
- Searchable recent Codex thread list as the primary content.
- A small empty state when no threads are available.
- A secondary manual-path action.

Internal orchestration titles such as `<codex_delegation>` are excluded from the recent list. Long titles use two-line clamping and paths remain secondary.

### Chat

Chat contains:

- A 56px compact header with session switcher, title/path, status dot, and contextual interrupt action.
- Timeline as the only scrollable primary region.
- Pending approvals inline at the correct timeline priority.
- Sticky composer at the bottom, respecting mobile safe areas and keyboard resize.

The existing command deck is removed. Output count, runtime mode, last update, and transport move to Session Details or Settings.

### Session Picker

The picker is a bottom sheet on mobile and a fixed sidebar on wide screens. It contains a segmented control for Recent and Saved sessions, one search field, and dense rows. Connection fields and manual session creation are not mixed into this surface.

### Settings

Settings is a separate sheet containing:

- Connection mode and health.
- Reachable access URLs with copy actions and QR code.
- Advanced server address and credential fields.
- Manual project-path session creation.
- Runtime diagnostics in a compact definition list.

Advanced fields are collapsed by default when the connection is healthy.

## Visual System

- Palette: neutral white and light gray foundations, near-black text, blue for commands, green/amber/red for state, and restrained violet only for Relay identity.
- Typography: system sans, 15-16px body copy, 17px compact titles, no viewport-scaled text.
- Geometry: 8px maximum card radius, 10-12px sheet radius, 44px minimum touch targets, stable icon button dimensions.
- Surfaces: solid fills and 1px separators; shadows only for modal elevation.
- Icons: `lucide-react` icons with accessible labels and tooltips for unfamiliar actions.
- Motion: 160-220ms transform/opacity transitions with reduced-motion support.
- Layout: no cards inside cards; lists use rows and dividers rather than repeated floating tiles.

## Error Handling

- Launcher errors name the failed child or occupied port and provide one corrective command.
- A disconnected client retains the selected session and message draft, shows a reconnect banner, and disables only unsafe actions.
- Invalid credentials open Settings directly with the credential field focused.
- A missing saved session falls back to the first available session without presenting an error.
- Import failures keep Home/Picker open and show the error beside the affected list.

## Security

- Generated tokens use at least 256 bits of randomness.
- The config file is created with mode 0600 and tokens are never printed without being embedded in the explicit access URL requested by the user.
- Access metadata is returned only after bridge authentication.
- Tailscale detection is read-only. Funnel and public tunneling are never enabled automatically.
- Relay behavior and approval boundaries are not broadened by this redesign.

## Testing And QA

- Launcher unit tests: config creation/reuse, permissions, address preference, port conflict, child shutdown, and failed child propagation.
- Server tests: authenticated access metadata and invalid environment parsing.
- Web tests: last-session restore, Home fallback, internal-thread filtering, picker search, Settings separation, import transition, and error recovery.
- Existing runtime, Relay, and timeline tests remain green.
- Browser QA at 390x844, 430x932, 768x1024, and 1440x900.
- Browser assertions cover horizontal overflow, composer occlusion, sheet height, focus order, reduced motion, and console errors.

## Non-Goals

- Native menu bar app or launchd installation.
- Automatic router port forwarding.
- Automatic Tailscale Serve/Funnel configuration.
- Full terminal, file browser, or Git client.
- Replacing the existing runtime adapters or Relay protocol.
