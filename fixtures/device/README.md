# Device fixture: "Verkstedlogg"

A small, neutral mobile web app (a tradesperson's job log, Norwegian bokmål UI) used to
build and test native device-capture drivers (phone emulator, headless Chrome stand-in).
Not a real product. No external network resources; deterministic seed data (25 jobs).

Run: `node fixtures/device/server.js --port 8787 [--poll 2000] [--latency 0]` (prints the URL),
or `import { startFixtureServer } from './fixtures/device/server.js'` ->
`{ url, port, close(), state }`.

## Routes
- `/` phone app. Hash routes `#/`, `#/job/:id`, `#/done`. Job list (search, long list; job 17
  "Takrenne – Solberg" is far down), detail, bottom-sheet dialog "Ekstraarbeid", success state.
  Test hook: `window.__fixture = { ready: Promise, route() }`. Roles/names: link = job title,
  button "Legg til ekstraarbeid", dialog "Ekstraarbeid", textboxes "Beskrivelse"/"Beløp",
  buttons "Send til kunden"/"Avbryt", status "Sendt til kunden", button "Tilbake til jobber".
  `data-testid`: job-card-<id>, extra-open, extra-text, extra-amount, extra-send, done-status, back-to-list.
- `/office` second device: polls `/api/state` every `pollMs` (or `?poll=ms`), re-fetches jobs on
  version change; tabs "Til godkjenning" / "Alle jobber", button "Oppdater".
- `/calibration` four fixed magenta 24x24 markers (`data-cal` tl/tr/bl/br inset at 12/88 % × 20/80 % of the viewport — clear of rounded corners, cutouts, edge-to-edge nav bars;
  corners), one in-document marker (`doc`, y=1200) on a 3000 px page, and a green 40 px flash band (CSS y 52–92, below the corner markers so it never hides one) on
  touch/pointer down for 150 ms (`window.__lastTouch = performance.now()`).
- `/manifest.webmanifest`, `/icon.svg`, `/sw.js` (no-op, claims clients; Chrome on Android may need a
  service worker before offering install / "Add to Home screen").
- API (same-origin, no CORS, `Cache-Control: no-store`, optional `latencyMs`):
  `GET /api/jobs`, `GET /api/state`, `POST /api/jobs/:id/extra {text, amount}` (marks the job
  `pending-approval`, bumps `version`), `POST /api/reset`.

Magenta (#ff00ff) and pure green (#00ff00) appear only on `/calibration`.

## How driver tests use it
Start the server bound to a LAN/emulator-reachable host (`--host 0.0.0.0`; emulator sees the host as
10.0.2.2), open `/calibration` to fit the screen-to-CSS mapping (find the magenta markers in captured
frames), use role+name targets on `/`, use `--latency 800` for a visible busy spinner, run `/office` on a
second device to observe cross-device propagation, and reset with `POST /api/reset` between runs.
Self-test: `node --test test/device-fixture.test.js` (Chrome part skipped without a Chrome binary).
