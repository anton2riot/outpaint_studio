# Outpaint Studio

A standalone composition and outpainting editor with images on an infinite canvas, generation frames, variants, regeneration, and autosave.

## Getting started

1. Run `npm ci`.
2. Run `.\start-local.cmd`.
3. Enter your personal Gemini or OpenAI key through "Set API keys" in the app.

Keys are stored in the browser's `localStorage`. During generation, the selected provider's key is sent to the server API only in the request body and then to that provider. Server keys from `.env` are not used. Do not include `.env` in a release.

The command clears old builds and starts two independent versions:

- `http://localhost:3100` — stable production version;
- `http://localhost:3101` — development version with Hot Reload.

To use other ports: `.\start-local.cmd -StablePort 3200 -DevPort 3201`.

Running the command again reuses existing servers and is safe when several agents are working in parallel. Use `.\start-local.cmd -Force` to clear and restart both servers.

The board and images are stored locally in `data/`.
