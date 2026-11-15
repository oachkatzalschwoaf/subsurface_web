# Topside

A dive logbook for the phone that reads and writes the [Subsurface](https://subsurface-divelog.org)
storage format: import Garmin dive computer files (FIT), add buddy, gear and notes, look at your
dives and their profiles, and make share images. Installable as an app, works offline. No PC needed.

> **Status:** early development. Uploading works in tests; it has not been used in the field yet.

## Why

Subsurface Mobile cannot import FIT files. On a dive trip with only a phone, Garmin dives stay
stuck in Garmin Connect until you are back at a PC. Topside closes that gap.

## Features

- **Where the logbook lives:** the Subsurface cloud, an own git repository (GitHub, GitLab, own
  server), or only on the device.
- **Offline:** the logbook is kept on the device. New dives are stored and uploaded with the next
  sync. Installable on Android/iOS as a home-screen app.
- **Garmin FIT import** (also Garmin Connect ZIP exports), duplicate detection.
- **Logbook and dive pages** with depth, temperature and heart-rate charts.
- **Share images** with selectable numbers, fonts, colours and your own photo.
- **Subsurface XML (.ssrf)** export and import, full backups (ZIP) and restore.
- **Trip mode:** copy the logbook into an own git repository before a trip, work with the copy,
  and transfer the new dives into the Subsurface cloud afterwards.

## How it works

- Topside reads and writes the Subsurface git storage format directly. It is the same repository
  that Subsurface Desktop and Subsurface Mobile sync with, so there is no separate database and no
  converter.
- Every change is a normal git commit. Topside never force-pushes, so the full history stays
  available.
- Browsers cannot talk to the Subsurface cloud directly (no CORS), so a small PHP proxy forwards the
  git traffic. It runs on ordinary shared hosting.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm test            # unit tests, including sync against a local git server
npm run typecheck
npm run dev         # app on http://localhost:5173 with a built-in git proxy
```

## Hosting it yourself

You need web space with HTTPS and PHP 8 with cURL (ordinary shared hosting is enough).

```bash
npm run build
```

Upload the contents of `apps/web/dist/` (including `.htaccess` and `git-proxy.php`) to a folder
on your web space and open it in the browser.

To use an own git server (for example GitHub) besides the Subsurface cloud, copy
`git-proxy.config.example.php` to `git-proxy.config.php` and list the host names there. The
proxy reaches no other servers. Every listed host is reachable through your proxy for anyone who
can open your installation, so consider protecting the folder with a password.

To show your own name in the app, put `VITE_APP_NAME=...` into `apps/web/.env.local` before
building.

Your password or token is sent to `git-proxy.php` on your own web space, which passes it on to the
git server and stores nothing. The app does not store it either; the browser's password manager
can. The offline copy of the logbook is kept unencrypted in the browser's storage on the device;
"Sign out" deletes it. Do not use a Topside installation you do not trust.

## License

GPL-2.0-only, the same license as Subsurface. See [LICENSE](LICENSE).

Topside is an independent project and is not affiliated with the Subsurface project.
