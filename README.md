# Topside

Upload Garmin dive computer files (FIT) from your phone straight into your
[Subsurface](https://subsurface-divelog.org) cloud logbook, and add buddy, gear and notes on the way.
Runs in the browser. No PC needed.

> **Status:** early development. Uploading works in tests; it has not been used in the field yet.

## Why

Subsurface Mobile cannot import FIT files. On a dive trip with only a phone, Garmin dives stay
stuck in Garmin Connect until you are back at a PC. Topside closes that gap.

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
on your web space and open it in the browser. Sign in with your Subsurface cloud account.

Your password is sent to `git-proxy.php` on your own web space, which passes it on to the
Subsurface cloud and stores nothing. Do not use a Topside installation you do not trust.

## License

GPL-2.0-only, the same license as Subsurface. See [LICENSE](LICENSE).

Topside is an independent project and is not affiliated with the Subsurface project.
