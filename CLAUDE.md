# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Topside is a mobile web app (PWA) for Subsurface dive logs: it reads and writes the Subsurface git
storage format directly, syncs with the Subsurface cloud or any git server through a small PHP
proxy, imports Garmin FIT files, works offline, and renders share images. GPL-2.0-only, public
repository. Code, comments, commits and README are English; the UI is German and English.

## Commands

Node ≥ 22.12, npm workspaces (`packages/core`, `apps/web`). On Windows PowerShell with a
restrictive execution policy, call `npm.cmd` instead of `npm`.

```bash
npm install
npm test                                       # all Vitest tests (vitest.config.ts: packages/*/test/**/*.test.ts)
npx vitest run packages/core/test/xml.test.ts  # one file
npx vitest run -t "round trip"                 # tests whose name matches
npm run typecheck                              # tsc for core + svelte-check for the web app; must be 0 errors
npm run dev                                    # app on http://localhost:5173 with a built-in git proxy
npm run build                                  # -> apps/web/dist/ (static files + git-proxy.php + .htaccess)
node scripts/check-login.ts <email> [server]   # read-only cloud login check, asks for the password hidden
```

Local-only tests run against private data and are skipped when it is missing. Paths default to
siblings of the repository; override with `TOPSIDE_REAL_REPO` (clone of a Subsurface cloud repo),
`TOPSIDE_REAL_FITS` (folder of FIT files whose dives are in that repo), `TOPSIDE_REAL_SSRF`
(Subsurface XML export of the same logbook).

Dev-server proxy settings: `TOPSIDE_PROXY_HOSTS` (extra https git hosts, default
github.com,gitlab.com,codeberg.org), `TOPSIDE_PROXY_HTTP_HOSTS` (tests only: local plain-http git
servers such as `127.0.0.1:51234`). App name: `VITE_APP_NAME` in `apps/web/.env` / `.env.local`.

`apps/web/dist/` is tracked in git (deployed by FTP); rebuild after web changes.

On Windows, run Vitest from a path with an upper-case drive letter (`W:\…`, not `w:\…`).
With a lower-case one every suite fails with "Cannot read properties of undefined (reading
'config')", because Vitest gets loaded twice under two spellings of the same path.

## Architecture

### packages/core — no DOM, runs in browser and Node

- `subsurface/` — the storage format. `parse.ts` mirrors Subsurface's `core/load-git.cpp`,
  `serialize.ts` mirrors `core/save-git.cpp`, `xml.ts` mirrors `core/save-xml.cpp` /
  `core/parse-xml.cpp`. `docs/format.md` describes the format (there is no official spec).
  Files are `GitTree` = `Map<name, string | GitTree>`; `flattenTree`/`unflattenTree` convert to
  path maps (empty directories as `path/`).
- **Byte-exact round trip is the central invariant**: parse → serialize must reproduce every file
  of a repository written by Subsurface (sources: github.com/subsurface/subsurface, `core/`; FIT
  fields: libdivecomputer `src/garmin_parser.c`). Number formats (`units.ts`: `put_milli`, `lrint`),
  string quoting (`text.ts`), line order, "write only when changed" sample rules and directory
  naming relative to the trip date all follow the C++ code line by line. When changing the
  writer, read the corresponding Subsurface source first.
- Sample model (`model.ts`): carried-over fields (ndl, tts, heartbeat, …) hold full values;
  temperature and tank pressure are set only where a reading exists — this matches Subsurface
  after its `fixup_dc_temp()`.
- `garmin/` — `fit-decode.ts` is an own FIT container decoder (Garmin's FIT SDK is deliberately
  not used: its license is incompatible with the GPL). `fit-import.ts` maps FIT messages to a
  `Dive` following libdivecomputer's `src/garmin_parser.c` (field numbers, alert names and
  severities) and drops repeated alerts like Subsurface's `fixup_dc_events()`. `dive-id.ts`:
  Subsurface's `diveid` = first 32-bit word (LE) of SHA-1 of the FIT file name zero-padded to
  24 bytes; duplicates are found by dive ID or start time within a minute (`findSameDive`).
- `subsurface/edit.ts`, `merge.ts`, `app/drafts.ts` — logbook changes: append dives with
  Subsurface numbering, copy missing dives between logbooks (sites/trips reused or created),
  drafts that describe user input independently of a logbook copy and are applied later.
  `app/presets.ts`: equipment presets (never pressures) and suggestions taken from the logbook
  (cylinder types, suits, buddies); the web app keeps presets in `localStorage` (`lib/gear.ts`).
  `app/edits.ts`: changes to existing dives (field-level, keyed by the dive's start time; also
  pictures and deletion), to sites (by uuid) and to trips (by location + first dive), applied to a
  freshly fetched logbook at sync. Deleting keeps the other dive numbers, as Subsurface does. `app/notes.ts`: notes taken before a FIT file
  exists, matched to dives by time, or turned into a dive without samples (model
  "manually added dive", for which Subsurface draws a stand-in profile).
  `app/pictures.ts`: picture references ("Topside/<date time site>/<name>", so Subsurface's
  "Find moved media files" matches the unpacked full export), offsets from Exif, ordering as
  Subsurface's add_picture(). The images stay in IndexedDB (`apps/web/src/lib/media.ts`).
- `subsurface/gas.ts` — gas use and SAC exactly as Subsurface computes them (real-gas
  compressibility, salinity, surface pressure); the XML export writes `sac` like Subsurface.
  `app/stats.ts` — logbook statistics and the dive search.
- `sync/sync.ts` — isomorphic-git on objects only (no checkout). `fetchLogbook` clones and reads
  the tree; `inspect()` refuses writing (returns `problems`) unless the tree round-trips exactly;
  `pushLogbook` commits on top of the fetched commit and never force-pushes (a moved remote is a
  `conflict`). `withHeadSymref` works around the Subsurface cloud advertising no `HEAD`, which
  isomorphic-git otherwise rejects. `initRemote` fills an empty branch. `memory-fs.ts` is the
  in-memory fs used in the browser.

### apps/web — Svelte 5 (runes) + Vite

- `lib/workspace.svelte.ts` is the app state, all in IndexedDB (`lib/db.ts`): offline copy of the
  logbook, pending draft batches, pending dive/site/trip edits, dive notes and picture metadata
  (`lib/media.ts`). Sync = fetch fresh → apply batches → dive edits → site edits → trip edits →
  one push (retry once on conflict); local mode applies changes directly. `view` = logbook with
  everything pending applied. Deleting a not yet synced dive only drops its draft.
- `lib/sources.ts` — cloud / own git / local sources, `remoteFor()` builds the remote incl. the
  proxy URL, password-manager helpers. Secrets stay in memory; nothing writes them to storage.
- `components/` — `DiveChart` draws depth/temperature/heart rate as separate panels on one time
  axis (no dual axes). `DetailsFields` is the one form for new dives, notes and edits. Routing is
  hash-based (`#/dive/<when>`, `#/edit/<when>`, `#/share/<when>`, `#/site/<uuid>`,
  `#/trip/<first when>`, `#/stats`); from 900 px width the log shows list and dive side by side.
- `lib/share-render.ts` — canvas share image. Every field is its own block in a relative layout
  (`title`, `subtitle`, `graph`, `stat:<id>`); sizes scale with `min(W, H) / 1080`. Editor
  settings live in `localStorage` (`topside.share`, `version: 2`; older ones are converted).
  Fonts come from Fontsource and must be SIL OFL.
- `lib/i18n.ts` — `en` defines the keys, `de` is typed by it; add every string to both.
- `pwa.ts` — Vite plugin that generates `manifest.webmanifest` (with `VITE_APP_NAME`) and `sw.js`
  caching the build; `git-proxy.php` is never cached.

### Git proxy

Browsers cannot reach the Subsurface cloud (no CORS), so `apps/web/public/git-proxy.php` forwards
git smart-HTTP (`git-proxy.php/<host>/<path>`). Only the Subsurface cloud hosts plus hosts listed
in `git-proxy.config.php` (see `.example.php`, never committed), and only the three git
endpoints; disallowed hosts get 421. The Vite dev server has the same proxy in `vite.config.ts` —
keep both allowlists in sync. `public/.htaccess` sets a strict CSP (no inline styles, images from
`self`/`blob:`/`data:`), passes the Authorization header to PHP and enables `AcceptPathInfo`.

## Rules

- Never commit real dive data: no `.ssrf`, `.fit`, cloud-repo copies, real names, activity IDs or
  account e-mails, also not in docs or test expectations. Fixtures are synthetic
  (`packages/core/test/fixtures/sample-repo.ts`, `test/helpers/fit-builder.ts`).
- Tests read real repositories from the git object store (`test/helpers/git-tree.ts`), not the
  checkout: `core.autocrlf` would otherwise change line endings.
- Sync tests run against a local `git http-backend` server with Basic auth whose `HEAD` points
  nowhere, like the cloud (`test/helpers/git-server.ts`).
- The XML export writes the computed `sac` like Subsurface; `otu`/`cns` need Subsurface's deco
  model and are left out. The local XML test compares against a real Subsurface export line by
  line with only those two removed.
- There are no browser tests in the repository; UI changes are checked by hand or with ad-hoc
  headless-browser scripts.
- TypeScript is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` in core).
  Imports use `.ts` extensions. Avoid TS-only runtime syntax such as parameter properties: scripts
  run with Node's built-in type stripping.
