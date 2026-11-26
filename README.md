# The Margin

A private, newspaper-style app for my own reading and watching: a **Today** front
page, a **Commonplace Book** of highlights, **News**, an **AI** desk and **Watch**.
No algorithm, no recommendations, nothing endless. It's a static site (`site/`)
published with GitHub Pages, and it opens on Today.

| Section | Page | What it is |
| --- | --- | --- |
| Today | `index.html` | The front page: a highlight to start the day, From your library, Now reading, today's paper, the AI desk, your watch list. Built on this device from the other sections' data. |
| Commonplace Book | `commonplace.html` | Highlights and review (private, see below). On the phone tab bar it's "Book". |
| News | `news.html` | **Today's paper** (a short finished list that ends "You're up to date") and **All stories** (the whole feed, with New / Later / All, source filter and search). |
| AI | `ai.html` | One desk with three tabs: News, Videos, and Notes (my highlights tagged `ai` or `ai-parallel`). |
| Watch | `watch.html` | The watch list, with **Channels** (every channel's full catalogue, with search) as a tab: `watch.html#channels`. |

Old links still work: `./?s=ai`, `news.html?s=ai` and `watch.html?s=ai` go to the AI
desk, `channels.html` goes to the Channels tab, and `today.html` goes to Today.

## How it works

- `channels.json` lists the YouTube channels for Watch.
- Every 2 hours during the day, a GitHub Action runs `scripts/fetch_feeds.py`, which reads each
  channel's public YouTube feed (long-form uploads only, no Shorts) and builds the page data.
- The site is published with GitHub Pages. Videos play embedded on the page.
- "Mark watched" and "Mark read" ticks are stored on your device (and synced, see below).

## Add or remove a channel

Edit `channels.json` on GitHub (pencil icon) and commit. Each entry needs a
`name` plus either a `handle` (e.g. `"@SpawnWave"`) or a channel `id` (starts with `UC`).
The page rebuilds automatically after the commit.

## Refresh now

Actions tab → "Update watch list" → "Run workflow".

## News

`news.html` reads the feeds in `feeds.json`, with the article text readable on the
page where the site allows it (not NYT).

- **Today's paper** is RTÉ News, BBC World and the NYT from the last 24 hours, plus
  at most one rugby or football story from BBC Sport and one from VGC. Which stories
  make the paper is decided in `site/paper.js`, shared with the front page so they
  always agree; edit the sport word lists at the top of that file. The paper is
  chosen before you start reading, so it only gets shorter. Everything else
  (The Verge, other sport, older stories) is in **All stories**, one tap deeper.
- The story data is encrypted with the `NEWS_PASSWORD` repository secret
  before publishing, so the public page is unreadable without it. Each device
  asks for the password once.
- `site/status.json` (unencrypted) lists per-source counts and errors only.
- To add or remove a source, edit `feeds.json`. Set `"fulltext": false` for
  paywalled sites.

## AI desk

`ai.html` has three tabs, from its own lists:

- **News** and **Videos**: `ai-feeds.json` lists the news feeds and `ai-channels.json`
  the YouTube channels (same formats as `feeds.json` and `channels.json`). The
  update job fetches them on the same schedule (videos every 30 minutes, news
  about every 2 hours) with `scripts/fetch_feeds.py ai` and `scripts/fetch_news.py ai`,
  which write `ai-videos.json`, `ai-news.enc.json` and `ai-status.json`. AI news is
  encrypted with the same `NEWS_PASSWORD`, so an unlocked device can read both.
- **Notes**: my own highlights tagged `ai` or `ai-parallel`, read from Commonplace on
  the device (never published).

Watched and read ticks are shared with Watch and News; Watch Later, Read Later,
Playing and Favourites for AI items are kept separately. AI channels aren't in the
Channels tab.

## Update now button

Each page has an "Update now" button that runs the update workflow on demand
(2-hour cooldown per device, set in `site/updater.js`). Because GitHub runs
scheduled jobs late or skips them, a page also starts an update by itself when
it's opened and the data is more than 2 hours old (or joins one another device
has already started). It needs a GitHub
fine-grained token with access to this repository only and the permission
"Actions: Read and write". The token is pasted in once per device and kept in
that browser's storage; it is never committed or published.

## Sync between devices

`site/sync.js` keeps watched/read ticks and the Later lists in step across
devices by storing them in `state.json` in the private repository
`custerdomecreative/my-youtube-state`. Each change is timestamped and the most
recent change to each item wins. It uses the same device-only token as the
Update button, which also needs "Contents: Read and write" on that repository.

## Reload and Block

- **⟳ Reload app** reloads the page from GitHub, skipping cached copies. Each
  deploy stamps the commit into `version.json` and the asset URLs, and pages
  reload themselves once when they see a newer version.
- **Block 1 hr** (in the Menu) hides all pages until the time is up, on every synced device.

## Commonplace Book (highlights and review)

`commonplace.html` is a private, Readwise-style place for highlights from the
Kindle, physical books, articles and spoken or typed thoughts. It has four
views: **Review** (the daily set), **Library** (books with covers and their
highlights), **Add** and **Search**.

**Nothing you highlight or write is ever published.** It lives in the private
repository `custerdomecreative/my-youtube-state`, in a `commonplace/` folder
(one file per book or article under `commonplace/sources/`, plus
`commonplace/review.json`), and in this device's storage so the page opens
instantly and keeps working offline (changes made offline are sent later). It
uses the same device-only token as Sync, so a device that has Sync set up
already has this. A device without one shows "Commonplace needs sync set up"
with a link to where the token is entered (Watch → Update now).

- **Kindle import:** connect the Kindle to the Mac, open its `documents`
  folder, copy `My Clippings.txt`, then Library → Import Kindle and choose it.
  The page shows a preview ("312 highlights in 9 books, 41 new") before saving.
  Import is safe to repeat: the same passage is never added twice, a passage
  you extended or trimmed on the Kindle updates the existing highlight, and
  your own notes, tags and favourites are never overwritten. Something you
  deleted in the app stays deleted.
- **Daily Review:** up to 7 highlights a day, due ones first, then ones you
  haven't seen, favourites a little more often. Keep (next in 2x the interval,
  at least 7 days), Sooner (half, at least 2 days), Less often (4x, at least 30
  days) or Discard (never in review again; still in the Library, and "Back in
  review" brings it back). New highlights start at 3 days. Each action has an
  Undo for a few seconds. The count for the day is shared between devices.
- **Covers** come from Open Library (Google Books as a fallback) and are looked
  up once, then saved. Change one from a book's page.
- **Block 1 hr** does not cover Commonplace.

- **Notes typed on the Kindle:** type them fast and messy. On import, Commonplace
  offers to have Claude tidy them (spelling, typos and obvious shorthand fixed;
  your words, meaning and length kept), using the Anthropic key on that device.
  The note as typed is kept and shown underneath ("Typed on Kindle: …"). If you
  later edit the note in the app, your version wins and a re-import never
  changes it.

### Hands-free thoughts (iPhone Shortcut)

The Shortcut opens the page with the text after a `#`, which never leaves the
phone (a `?` would be sent to the server). No token goes into a Shortcut: the
page saves with its own.

1. Shortcuts app → **+** → name it **Commonplace thought**.
2. Add **Dictate Text**.
3. Add **URL Encode** (search "encode"); its input is the *Dictated Text*.
4. Add **Text** and type, with the address of this site (the same as your watch
   list, ending in `commonplace.html`), then the *URL Encoded Text* variable:
   `https://custerdomecreative.github.io/my-youtube/commonplace.html#add?kind=thought&text=`
5. Add **Open URLs** with that Text as its input.
6. Optional: tap the shortcut's name → **Add to Home Screen**, or say "Hey Siri,
   Commonplace thought".

The page opens with your words in the box; tap **Save**. They're filed under
"My thoughts".

### Physical books (iPhone share sheet)

1. Photograph the page. In Photos (or the Camera), press and hold the text, drag
   to select the passage, and tap **Share**.
2. One-time setup: Shortcuts → **+** → name it **Add to Commonplace** → tap the
   **i** at the bottom → turn on **Show in Share Sheet** and set it to accept
   **Text** only.
3. Add **URL Encode** (its input is *Shortcut Input*), then **Text**:
   `https://custerdomecreative.github.io/my-youtube/commonplace.html#add?kind=book&text=`
   followed by the *URL Encoded Text* variable, then **Open URLs**.

The page opens with the passage filled in and asks which book, and the page.

If you keep the site on your Home Screen, Shortcuts opens links in **Safari**,
which keeps its own separate storage on iPhone. Enter the sync token there once
too (open Watch in Safari → Update now) or Commonplace will say it needs sync
set up.

### Suggested tags (Claude)

On a book's page, **Suggest tags** sends that book's passages (and your notes on
them) to Claude, which suggests themes from your tag list: power, leadership,
ambition, institutions, persuasion, corruption, war, geopolitics, middle-east,
ai, technology, ai-parallel, human-nature, habits, focus, mastery, career,
decisions, data, adversity, emotions, mindfulness, stoicism, relationships,
meaning, running, writing, plus any tags you already use. Your
judgement tags (quotable, writing-craft, essay-idea) are never suggested. You
review the suggestions, untick any you don't want, and only then are they saved.
To change the theme list, edit `THEMES` in `site/cp-suggest.js`.

- It needs an Anthropic API key (Claude Console → API keys). Set a monthly
  spend limit there. The key is pasted into the app once per device (and once in
  Safari if you use Shortcuts), kept in that browser's storage only, and sent
  only to Anthropic. It is never synced or published.
- Haiku is the default (well under a cent for a few hundred passages); Sonnet is
  sharper and costs about 20 times more. The cost of each run is shown.
- Results you've paid for are kept until you apply or discard them, even if the
  page reloads.
- To switch the feature off, remove `cp-suggest.js` and its `<script>` tag.
