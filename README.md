# Watch List

A distraction-free page showing only the latest videos from channels I choose.
No algorithm, no recommendations, no search.

## How it works

- `channels.json` lists the channels.
- Twice a day, a GitHub Action runs `scripts/fetch_feeds.py`, which reads each
  channel's public YouTube feed (long-form uploads only, no Shorts) and builds the page.
- The page is published with GitHub Pages. Videos play embedded on the page.
- "Mark watched" ticks are stored on your device.

## Add or remove a channel

Edit `channels.json` on GitHub (pencil icon) and commit. Each entry needs a
`name` plus either a `handle` (e.g. `"@SpawnWave"`) or a channel `id` (starts with `UC`).
The page rebuilds automatically after the commit.

## Refresh now

Actions tab → "Update watch list" → "Run workflow".
