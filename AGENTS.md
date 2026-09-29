# Agent guidelines

These rules apply to the entire repository.

## Core principle

- Run only the minimum verification needed for the change.
- Do not build "just in case" or after every changed file.
- Do not restart running servers unless necessary.
- Do not change `data/` for verification. If a check temporarily changes the board, restore it.

## Dependencies

- The project uses `npm` and `package-lock.json`.
- On the first run without `node_modules`, run `npm ci`.
- Do not reinstall dependencies for every task.
- After an intentional dependency change, run `npm install` to update `package-lock.json`.

## Local development

Main command:

```powershell
.\start-local.cmd
```

It starts:

- `http://localhost:3101` — development version with Hot Reload;
- `http://localhost:3100` — stable production version.

Startup rules:

- Always use `http://localhost:3101` to develop and verify current changes.
- CSS, JSX, and most JS changes appear automatically on the development server. No build or restart is needed.
- If both servers are already running, use them instead of running `start-local.cmd` again.
- `start-local.cmd -Force` stops both servers. Use it only if Hot Reload is broken or a server is stuck, and only if it will not disrupt other agents.
- Port `3100` does not reflect source changes until a new production build. Do not use it to verify unfinished changes.
- Do not start a separate `npm run dev` if the development server is available on port `3101`.

## When a build is unnecessary

Do not run `npm run build` for:

- CSS-only changes;
- changes to text, spacing, colors, or sizes;
- small JSX markup changes;
- local UI handler changes;
- documentation;
- intermediate iterations of one task.

For these changes, verify the affected flow on the development server. For visual changes, open the relevant UI state and inspect it visually.

## When a build is required

Run one production build at the end of the task if you changed:

- `package.json` or `package-lock.json`;
- `next.config.js` or startup scripts;
- page routing;
- client/server boundaries;
- imports, exports, or module structure in a large refactor;
- API routes or shared server infrastructure with build-error risk.

A build is also required if the user explicitly asks to verify production/release, or if the change is being prepared for deployment.

Command:

```powershell
npm run build
```

Build rules:

- Run it after all related edits are complete, not after each edit.
- If only CSS or text changed after a successful build, do not build again.
- Do not run multiple builds in parallel: they share `.next`.

## Linting and tests

- The project has no automated tests or configured ESLint config yet.
- Do not run `npm run lint`: it may start interactive setup.
- Verify the changed flow manually on the development server.
- For API changes, check only the affected route and avoid real generative-service requests unless needed.

## Completion report

- Report only checks that actually ran.
- If no build ran, briefly explain why this type of change did not need one.
- Do not claim a check passed if it did not run.
