// Limited YouTube search for the Channels page: for looking something up,
// not for browsing. A few long-form results, no autocomplete, no "more",
// and a small daily allowance shared across devices (synced by sync.js).
//
// The key comes from search-config.js, written at deploy time from the
// YOUTUBE_SEARCH_KEY secret. It's restricted to this site and to YouTube
// searches, in its own Google Cloud project with its own quota.
const SEARCH = {
  DAILY_LIMIT: 10,
  RESULTS: 20,
  MIN_SECONDS: 181,              // Shorts can be up to 3 minutes
  USAGE_KEY: "search-usage-v1",  // { "2026-10-28": { deviceId: count } }
  DEVICE_KEY: "device-id-v1",
  LAST_KEY: "search-last-v1",    // last results, kept for this browsing session
};

function searchDeviceId() {
  try {
    let id = localStorage.getItem(SEARCH.DEVICE_KEY);
    if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(SEARCH.DEVICE_KEY, id); }
    return id;
  } catch (e) { return "this-device"; }
}
const searchToday = () => new Date().toLocaleDateString("en-CA");  // YYYY-MM-DD, local time
function searchUsage() { try { return JSON.parse(localStorage.getItem(SEARCH.USAGE_KEY) || "{}"); } catch (e) { return {}; } }
function searchesUsedToday() {
  return Object.values(searchUsage()[searchToday()] || {}).reduce((a, b) => a + b, 0);
}
function countSearch() {
  const usage = searchUsage(), day = searchToday(), dev = searchDeviceId();
  usage[day] = usage[day] || {};
  usage[day][dev] = (usage[day][dev] || 0) + 1;
  for (const d of Object.keys(usage)) if (d < day) delete usage[d];
  try { localStorage.setItem(SEARCH.USAGE_KEY, JSON.stringify(usage)); } catch (e) {}
}
const decodeEntities = s => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
function isoSeconds(d) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "") || [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

const searchApi = (path, params) =>
  fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: window.SEARCH_KEY })}`)
    .then(r => { if (!r.ok) throw new Error(r.status === 403 ? "quota" : "http"); return r.json(); });

// One result, from a search hit's snippet plus the video's details.
function toVideo(id, snippet, d) {
  const state = snippet.liveBroadcastContent || "none";
  return {
    id,
    title: decodeEntities(snippet.title || ""),
    channel: decodeEntities(snippet.channelTitle || ""),
    published: snippet.publishedAt || "",
    secs: isoSeconds(d?.contentDetails?.duration),
    views: Number(d?.statistics?.viewCount || 0),
    upcoming: state === "upcoming" ? (d?.liveStreamingDetails?.scheduledStartTime || "soon") : "",
    live: state === "live",
    thumbnail: snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}
const DETAIL_PARTS = "contentDetails,liveStreamingDetails,statistics";

// --- Re-ranking ---
// YouTube's public search API ranks loosely, so results are re-scored here:
// title matches count most, then your own channels, popularity, recency,
// and YouTube's own order as one signal among several.
const STOPWORDS = new Set("a an and the of for to in on at is it by with from vs".split(" "));
const fold = t => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const queryWords = q => [...new Set(fold(q).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOPWORDS.has(w)))];
function matchShare(text, words) {
  if (!words.length) return 0;
  const tokens = new Set(fold(text).split(/[^a-z0-9]+/));
  const hay = fold(text);
  // Whole-word match, or a prefix for longer words ("review" ~ "reviews").
  return words.filter(w => tokens.has(w) || (w.length > 3 && hay.includes(w))).length / words.length;
}
function rank(list, query, myChannels) {
  const words = queryWords(query), mine = new Set((myChannels || []).map(fold));
  const n = list.length || 1;
  const scored = list.map((v, i) => {
    const title = matchShare(v.title, words), channel = matchShare(v.channel, words);
    const ageDays = v.published ? (Date.now() - new Date(v.published)) / 86400000 : 9999;
    const score = 4 * title + 1 * channel
      + (mine.has(fold(v.channel)) ? 1.5 : 0)
      + 0.35 * Math.log10((v.views || 0) + 10)
      + (ageDays < 30 ? 0.5 : ageDays < 365 ? 0.2 : 0)
      + 1.5 * (1 - i / n);
    return { ...v, score, match: Math.max(title, channel) };
  });
  // Upcoming premieres are only pinned if they genuinely match the search.
  const kept = scored.filter(v => !(v.upcoming && v.match < 0.5));
  // Drop results that match none of the words, if there are enough that do.
  const matching = kept.filter(v => v.match > 0);
  const pool = matching.length >= 5 ? matching : kept;
  return pool.sort((a, b) => b.score - a.score);
}

async function runSearch(query, myChannels) {
  // YouTube's search often leaves scheduled premieres out of ordinary results,
  // so ask for upcoming matches separately.
  const [found, upcoming] = await Promise.all([
    searchApi("search", { part: "snippet", type: "video", maxResults: 45, q: query, relevanceLanguage: "en", regionCode: "IE", safeSearch: "none" }),
    searchApi("search", { part: "snippet", type: "video", eventType: "upcoming", maxResults: 5, q: query }).catch(() => ({ items: [] })),
  ]);
  const seen = new Set(), items = [];
  for (const i of [...(found.items || []), ...(upcoming.items || [])]) {
    const id = i.id?.videoId;
    if (id && !seen.has(id)) { seen.add(id); items.push(i); }
  }
  if (!items.length) return [];
  const batch = items.slice(0, 50);
  const details = await searchApi("videos", { part: DETAIL_PARTS, id: batch.map(i => i.id.videoId).join(",") });
  const byId = Object.fromEntries((details.items || []).map(d => [d.id, d]));
  const list = batch
    .map(i => toVideo(i.id.videoId, i.snippet, byId[i.id.videoId]))
    // Upcoming premieres and live streams have no length yet, so only the
    // finished videos go through the Shorts filter.
    .filter(v => v.upcoming || v.live || v.secs >= SEARCH.MIN_SECONDS);
  return rank(list, query, myChannels).slice(0, SEARCH.RESULTS);
}

// A pasted YouTube link: look up just that video (doesn't use a search).
function linkedVideoId(text) {
  const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(text);
  return m ? m[1] : null;
}
async function lookUpVideo(id) {
  const data = await searchApi("videos", { part: `snippet,${DETAIL_PARTS}`, id });
  return (data.items || []).map(d => toVideo(d.id, d.snippet, d));
}

const SORT_KEY = "search-sort-v1";
function sortResults(list, how) {
  // Live and upcoming stay at the top whatever the sort.
  const pinned = list.filter(v => v.live || v.upcoming), rest = list.filter(v => !v.live && !v.upcoming);
  if (how === "newest") rest.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  if (how === "views") rest.sort((a, b) => (b.views || 0) - (a.views || 0));
  return [...pinned, ...rest];
}

// The search box plus results. `makeCard(video, metaLine)` draws a result.
function searchPanel(makeCard, metaFor, myChannels) {
  const input = el("input", { type: "search", placeholder: "Look up a video, or paste a YouTube link", ariaLabel: "Look up a video", enterKeyHint: "search", autocomplete: "off" });
  const go = el("button", { className: "tick", type: "submit", textContent: "Search" });
  const note = el("div", { className: "search-note" });
  const results = el("div", { className: "list search-results" });
  const form = el("form", { className: "search-form" }, [input, go]);
  const box = el("section", { className: "search-box" }, [form, note, results]);
  let sortBy = "best";
  try { sortBy = localStorage.getItem(SORT_KEY) || "best"; } catch (e) {}

  function paintNote(extra) {
    const left = Math.max(0, SEARCH.DAILY_LIMIT - searchesUsedToday());
    const off = !window.SEARCH_KEY;
    input.disabled = go.disabled = off;
    input.placeholder = left === 0 ? "Paste a YouTube link" : "Look up a video, or paste a YouTube link";
    note.textContent = off ? "Search isn't set up yet."
      : extra || (left === 0 ? "No searches left today (links still work). Back tomorrow." : `${left} of ${SEARCH.DAILY_LIMIT} searches left today · links don't count`);
  }
  function show(list, label) {
    if (!list) return results.replaceChildren();
    const clear = el("button", { className: "tick", textContent: "Clear" });
    clear.addEventListener("click", () => { try { sessionStorage.removeItem(SEARCH.LAST_KEY); } catch (e) {} show(null); paintNote(); });
    const sort = el("select", { className: "search-sort", ariaLabel: "Sort results" }, [
      el("option", { value: "best", textContent: "Best match" }),
      el("option", { value: "newest", textContent: "Newest" }),
      el("option", { value: "views", textContent: "Most viewed" }),
    ]);
    sort.value = sortBy;
    const cards = el("div", { className: "list" });
    const draw = () => cards.replaceChildren(...sortResults(list, sortBy).map(v => makeCard(v, metaFor(v))));
    sort.addEventListener("change", () => { sortBy = sort.value; try { localStorage.setItem(SORT_KEY, sortBy); } catch (e) {} draw(); });
    const tools = el("div", { className: "search-tools" }, list.length > 1 ? [sort, clear] : [clear]);
    results.replaceChildren(el("div", { className: "search-head" }, [el("span", { textContent: label }), tools]), cards);
    draw();
  }
  const remember = (list, label) => { try { sessionStorage.setItem(SEARCH.LAST_KEY, JSON.stringify({ list, label })); } catch (e) {} };

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const linkId = linkedVideoId(query);
    if (!linkId && searchesUsedToday() >= SEARCH.DAILY_LIMIT) return paintNote();
    input.blur();
    paintNote(linkId ? "Looking up that video…" : "Searching…");
    go.disabled = true;
    try {
      const list = linkId ? await lookUpVideo(linkId) : await runSearch(query, myChannels ? myChannels() : []);
      if (!linkId) countSearch();
      const label = linkId ? (list.length ? "Linked video" : "Couldn't find that video") : (list.length ? `Results for “${query}”` : `Nothing found for “${query}”`);
      remember(list, label);
      input.value = "";
      show(list, label);
      paintNote();
    } catch (err) {
      paintNote(err.message === "quota" ? "Search is unavailable right now (YouTube quota). Try later." : "Search failed. Check your connection and try again.");
      go.disabled = false;
    }
  });

  try {
    const last = JSON.parse(sessionStorage.getItem(SEARCH.LAST_KEY) || "null");
    if (last) show(last.list, last.label || `Results for “${last.query}”`);
  } catch (e) {}
  paintNote();
  return box;
}
