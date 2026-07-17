# Project guidance

This file applies to the repository root. A more specific `AGENTS.md`, such as the one under `videos/javascript-king-merge-overlays/`, takes precedence within its directory.

## Scope and change discipline

- Keep each change limited to the requested feature. Do not edit, rename, reformat, or clean up unrelated files.
- Follow the existing Next.js App Router, React, TypeScript, Tailwind CSS, and Zustand patterns in the nearby code.
- Trace the active UI, API route, Baserow field mapping, and storage path before changing a workflow. Several features depend on external services and schema-specific field IDs.
- Settings and pipeline preferences are persisted in browser `localStorage`, primarily through `src/store/useAppStore.ts`. When changing persisted settings, inspect the default, load, save, update, and reset paths together.
- Do not commit `.env.local`, credentials, provider keys, generated media, or local runtime data.
- Document any new environment variable, Baserow field, external service, or pipeline step in the relevant project documentation.

## Setup and running

The project requires Node.js 20 or newer, npm, FFmpeg/FFprobe, Baserow, and MinIO. Install dependencies with:

```bash
npm install
```

Run the full local development helper with:

```bash
npm run dev
```

This macOS-oriented command starts Next.js on `http://localhost:9540`, restarts the configured local MinIO server, uses `caffeinate`, and requires `MINIO_ROOT_PASSWORD` in the shell or `.env.local`. It also stops an existing Next.js process on port 9540 and the matching MinIO process. Use this only when that restart behavior is intended.

Run the same helper without `caffeinate` with:

```bash
npm run dev:restart
```

When MinIO should not be restarted, run only Next.js with:

```bash
npx next dev -p 9540
```

For a production build and server:

```bash
npm run build
npm run start
```

## Validation

There is currently no automated test script or checked-in test suite. Validate in proportion to the files and workflow changed.

Run ESLint only on the touched JavaScript or TypeScript files:

```bash
npm run lint -- src/path/to/changed-file.ts src/path/to/changed-component.tsx
```

Do not use the repository-wide `npm run lint` as the default check for a focused change. Report any pre-existing or unrelated failures separately from failures caused by the changed files.

For changes that can affect compilation, routing, or production behavior, also run:

```bash
npm run build
```

Before handing off a change:

```bash
git diff --check
```

Manually smoke-test the affected workflow at `http://localhost:9540`. State which external services and credentials were available, because routes that use Baserow, MinIO, FFmpeg, TTS, transcription, or AI providers cannot be fully validated without their configured dependencies.
