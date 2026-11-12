# Topside

Upload Garmin dive computer files (FIT) from your phone straight into your
[Subsurface](https://subsurface-divelog.org) cloud logbook, and add buddy, gear and notes on the way.
Runs in the browser. No PC needed.

> **Status:** early development, not usable yet.

## Why

Subsurface Mobile cannot import FIT files. On a dive trip with only a phone, Garmin dives stay
stuck in Garmin Connect until you are back at a PC. Topside closes that gap.

## How it works (planned)

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
npm test
npm run typecheck
```

## License

GPL-2.0-only, the same license as Subsurface. See [LICENSE](LICENSE).

Topside is an independent project and is not affiliated with the Subsurface project.
