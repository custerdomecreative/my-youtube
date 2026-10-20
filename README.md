# Watch List

A distraction-free page showing only the latest videos from channels I choose.
No algorithm, no recommendations, no search.

## How it works

- `channels.json` lists the channels.
- Every 2 hours during the day, a GitHub Action runs `scripts/fetch_feeds.py`, which reads each
  channel's public YouTube feed (long-form uploads only, no Shorts) and builds the page.
- The page is published with GitHub Pages. Videos play embedded on the page.
- "Mark watched" ticks are stored on your device.

## Add or remove a channel

Edit `channels.json` on GitHub (pencil icon) and commit. Each entry needs a
`name` plus either a `handle` (e.g. `"@SpawnWave"`) or a channel `id` (starts with `UC`).
The page rebuilds automatically after the commit.

## Refresh now

Actions tab → "Update watch list" → "Run workflow".

## News page

`news.html` shows recent stories from the feeds in `feeds.json`, with the
article text readable on the page where the site allows it (not NYT).

- The story data is encrypted with the `NEWS_PASSWORD` repository secret
  before publishing, so the public page is unreadable without it. Each device
  asks for the password once.
- `site/status.json` (unencrypted) lists per-source counts and errors only.
- To add or remove a source, edit `feeds.json`. Set `"fulltext": false` for
  paywalled sites.

## Update now button

Each page has an "Update now" button that runs the update workflow on demand
(2-hour cooldown per device, set in `site/updater.js`). It needs a GitHub
fine-grained token with access to this repository only and the permission
"Actions: Read and write". The token is pasted in once per device and kept in
that browser's storage; it is never committed or published.
