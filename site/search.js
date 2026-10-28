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

async function runSearch(query) {
  const key = window.SEARCH_KEY;
  const api = (path, params) => fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`)
    .then(async r => { if (!r.ok) throw new Error(r.status === 403 ? "quota" : "http"); return r.json(); });
  const found = await api("search", {
    part: "snippet", type: "video", maxResults: 50, q: query,   // extra, since Shorts and live streams are filtered out
    relevanceLanguage: "en", regionCode: "IE", safeSearch: "none",
  });
  const items = (found.items || []).filter(i => i.id?.videoId && i.snippet?.liveBroadcastContent === "none");
  if (!items.length) return [];
  const details = await api("videos", { part: "contentDetails", id: items.map(i => i.id.videoId).join(",") });
  const secs = Object.fromEntries((details.items || []).map(d => [d.id, isoSeconds(d.contentDetails?.duration)]));
  return items
    .filter(i => (secs[i.id.videoId] || 0) >= SEARCH.MIN_SECONDS)
    .slice(0, SEARCH.RESULTS)
    .map(i => ({
      id: i.id.videoId,
      title: decodeEntities(i.snippet.title),
      channel: decodeEntities(i.snippet.channelTitle),
      published: i.snippet.publishedAt,
      secs: secs[i.id.videoId],
      thumbnail: i.snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${i.id.videoId}/hqdefault.jpg`,
    }));
}

// The search box plus results. `makeCard(video, metaLine)` draws a result.
function searchPanel(makeCard, metaFor) {
  const input = el("input", { type: "search", placeholder: "Look up a video", ariaLabel: "Look up a video", enterKeyHint: "search", autocomplete: "off" });
  const go = el("button", { className: "tick", type: "submit", textContent: "Search" });
  const note = el("div", { className: "search-note" });
  const results = el("div", { className: "list search-results" });
  const form = el("form", { className: "search-form" }, [input, go]);
  const box = el("section", { className: "search-box" }, [form, note, results]);

  function paintNote(extra) {
    const left = Math.max(0, SEARCH.DAILY_LIMIT - searchesUsedToday());
    const off = !window.SEARCH_KEY;
    input.disabled = go.disabled = off || left === 0;
    note.textContent = off ? "Search isn't set up yet."
      : extra || (left === 0 ? "No searches left today. Back tomorrow." : `${left} of ${SEARCH.DAILY_LIMIT} searches left today`);
  }
  function show(list, query) {
    if (!list) return results.replaceChildren();
    const clear = el("button", { className: "tick", textContent: "Clear results" });
    clear.addEventListener("click", () => { try { sessionStorage.removeItem(SEARCH.LAST_KEY); } catch (e) {} show(null); paintNote(); });
    results.replaceChildren(
      el("div", { className: "search-head" }, [el("span", { textContent: list.length ? `Results for “${query}”` : `Nothing found for “${query}”` }), clear]),
      ...list.map(v => makeCard(v, metaFor(v))));
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query || searchesUsedToday() >= SEARCH.DAILY_LIMIT) return paintNote();
    input.blur();
    paintNote("Searching…");
    go.disabled = true;
    try {
      const list = await runSearch(query);
      countSearch();
      try { sessionStorage.setItem(SEARCH.LAST_KEY, JSON.stringify({ query, list })); } catch (e) {}
      input.value = "";
      show(list, query);
      paintNote();
    } catch (err) {
      paintNote(err.message === "quota" ? "Search is unavailable right now (YouTube quota). Try later." : "Search failed. Check your connection and try again.");
      go.disabled = false;
    }
  });

  try {
    const last = JSON.parse(sessionStorage.getItem(SEARCH.LAST_KEY) || "null");
    if (last) show(last.list, last.query);
  } catch (e) {}
  paintNote();
  return box;
}
