# Contributing

## Development setup

1. Install dependencies:

```bash
npm install
```

2. Run the full test suite before opening a pull request:

```bash
npm test
```

3. Build all packages:

```bash
npm run build
```

## Pull requests

- Keep changes focused.
- Add or update tests for behavior changes.
- Document user-facing changes in `README.md` when needed.
- Avoid committing local databases, build artifacts, or machine-specific configuration.

## Project structure

- `packages/shared`: shared schemas and types
- `packages/server`: bridge server and Codex runtime adapters
- `packages/web`: mobile-first PWA client
