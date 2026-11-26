// Commonplace data layer: sources and highlights, review state, covers, and
// syncing with the private repository custerdomecreative/my-youtube-state.
//
// Nothing here is ever sent to the public repository or GitHub Pages. Highlights
// live in this device's localStorage (so the page opens instantly and works
// offline) and are copied to commonplace/ in the private repo with the same
// device-only token that sync.js and the Update button use.
//
//   commonplace/sources/<sourceId>.json   one file per source, with its highlights
//   commonplace/review.json               review state, merged per highlight by time
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CP = factory();
})(this, function () {
  "use strict";

  const STATE_REPO = "custerdomecreative/my-youtube-state";
  const ROOT = "commonplace";
  const REVIEW_PATH = `${ROOT}/review.json`;
  const TOKEN_KEY = "gh-token-v1";
  const K = { sources: "cp-sources-v1", review: "cp-review-v1", shas: "cp-shas-v1", dirty: "cp-dirty-v1", today: "cp-today-v1" };
  const DAILY_MAX = 7;
  const THOUGHTS_ID = "src_my-thoughts";

  // ---------- small helpers ----------
  const ls = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; } };
  const lsGet = (k, fallback) => { try { const v = ls().getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  let cacheError = false;
  const lsSet = (k, v) => { try { ls().setItem(k, JSON.stringify(v)); cacheError = false; return true; } catch (e) { cacheError = true; return false; } };
  const token = () => { try { return ls().getItem(TOKEN_KEY); } catch (e) { return null; } };
  const nowIso = () => new Date().toISOString();
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const addDays = (dateStr, n) => { const [y, m, d] = dateStr.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };

  // 53-bit string hash (cyrb53): stable ids from text.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }
  // Text compared for "same highlight": spacing, quote styles and case ignored.
  const norm = t => String(t || "").replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  const slug = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function surname(author) {
    const first = String(author || "").split(/;|&| and /)[0].trim();
    if (!first) return "";
    if (first.includes(",")) return first.split(",")[0].trim();
    const parts = first.split(/\s+/);
    return parts[parts.length - 1];
  }
  // Kindle titles often carry file-name and shop clutter: "Jurassic Park_ A Novel - Crichton, Michael",
  // "Small Things Like These: Shortlisted for the Booker Prize 2022 | &lt;b&gt;An exquisite…&lt;/b&gt;".
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const decode = s => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const BLURB = /(shortlisted|longlisted|winner of|prize|award|bestsell|best-sell|from the (author|bestselling|number one)|now a (major|netflix)|soon to be a|sunday times|new york times|^\s*a novel\s*$)/i;
  function cleanAuthor(author) { return decode(decode(author)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
  function cleanTitle(title, author) {
    let t = decode(decode(title)).replace(/<[^>]*>/g, " ");
    t = t.replace(/_\s+/g, ": ").replace(/_/g, " ");
    t = t.split(/\s+\|\s+/)[0];
    const sn = surname(cleanAuthor(author));
    if (sn) t = t.replace(new RegExp(`\\s+-\\s+[^-]*\\b${escapeRe(sn)}\\b[^-]*$`, "i"), "");
    const i = t.indexOf(":");
    if (i > 0 && BLURB.test(t.slice(i + 1))) t = t.slice(0, i);
    t = t.replace(/\s+/g, " ").replace(/[\s:;,|-]+$/, "").trim();
    return t || String(title || "").trim();
  }
  // "The Power Broker" + "Robert A. Caro" -> src_power-broker-caro, so a re-import finds the same book.
  function sourceIdFor(title, author) {
    const t = slug(String(title || "").replace(/^(the|a|an)\s+/i, "")).slice(0, 48).replace(/-+$/, "");
    const a = slug(surname(author)).slice(0, 24).replace(/-+$/, "");
    const body = [t, a].filter(Boolean).join("-");
    return "src_" + (body || hash(String(title || "") + String(author || "")).slice(0, 10));
  }
  const highlightId = (sourceId, text) => "h_" + hash(sourceId + "\u0001" + norm(text));
  const randomId = () => "h_" + hash(Date.now() + ":" + Math.random()).slice(0, 10);
  const normTag = t => String(t || "").trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-");
  // "Loc 1802-1805" -> [1802, 1805]
  function locRange(location) {
    const m = String(location || "").match(/(\d+)(?:\s*-\s*(\d+))?/);
    return m ? [Number(m[1]), Number(m[2] || m[1])] : null;
  }

  // ---------- state ----------
  let sources = lsGet(K.sources, {});   // id -> source
  let review = lsGet(K.review, {});     // highlightId -> { due, interval, state, seen, t, last }
  let shas = lsGet(K.shas, {});         // repo path -> blob sha last seen
  let dirty = lsGet(K.dirty, { sources: [], review: false });
  const listeners = new Set();
  let status = { state: token() ? "idle" : "setup", text: token() ? "" : "Needs sync set up" };

  const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const statusListeners = new Set();
  const onStatus = fn => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
  function setStatus(state, text) { status = { state, text }; statusListeners.forEach(fn => { try { fn(status); } catch (e) {} }); }
  const getStatus = () => status;

  function persist() {
    lsSet(K.sources, sources); lsSet(K.review, review); lsSet(K.shas, shas); lsSet(K.dirty, dirty);
  }

  // ---------- sources and highlights ----------
  const allSources = () => Object.values(sources);
  const getSource = id => sources[id];
  const hasHighlightData = () => allSources().some(s => s.highlights.length);

  function newSource({ id, kind = "book", title, author = "", url = null, cover = null }) {
    return { id: kind === "thoughts" ? THOUGHTS_ID : (id || sourceIdFor(title, author)), kind, title, author, cover, url, added: nowIso(), updated: nowIso(), highlights: [], deleted: {} };
  }
  // The saved source if there is one, else a fresh unsaved one (call saveSource to keep it).
  function ensureSource(spec) {
    if (spec.kind === "thoughts") return sources[THOUGHTS_ID] || newSource({ kind: "thoughts", title: "My thoughts", cover: "" });
    const id = spec.id || sourceIdFor(spec.title, spec.author);
    return sources[id] || newSource(spec);
  }
  function markDirty(id) { if (!dirty.sources.includes(id)) dirty.sources.push(id); }
  function saveSource(src) {
    src.updated = nowIso();
    sources[src.id] = src;
    markDirty(src.id);
    persist();
    emit();
    scheduleFlush(2500);
    return src;
  }
  function makeHighlight(f) {
    const t = nowIso();
    return {
      id: f.id || randomId(), text: f.text, note: f.note || "", tags: (f.tags || []).map(normTag).filter(Boolean),
      location: f.location || null, page: f.page == null ? null : f.page, via: f.via || "manual",
      favourite: !!f.favourite, created: f.created || t, updated: t,
      ...(f.noteOriginal ? { noteOriginal: f.noteOriginal } : {}),   // a Kindle-typed note as typed, before tidying
    };
  }
  function addHighlight(src, fields) {
    const h = makeHighlight(fields);
    if (src.highlights.some(x => x.id === h.id)) return src.highlights.find(x => x.id === h.id);
    src.highlights.push(h);
    delete src.deleted[h.id];
    saveSource(src);
    return h;
  }
  // Change fields of a highlight; `edited` marks text changed by hand so a Kindle re-import leaves it alone.
  function updateHighlight(sourceId, hid, patch) {
    const src = sources[sourceId], h = src && src.highlights.find(x => x.id === hid);
    if (!h) return null;
    if ("text" in patch && patch.text !== h.text) h.edited = true;
    if ("note" in patch && patch.note !== h.note) h.noteEdited = true;   // so a Kindle re-import never refills or replaces it
    Object.assign(h, patch);
    if ("tags" in patch) h.tags = patch.tags.map(normTag).filter(Boolean);
    h.updated = nowIso();
    saveSource(src);
    return h;
  }
  function deleteHighlight(sourceId, hid) {
    const src = sources[sourceId], h = src && src.highlights.find(x => x.id === hid);
    if (!h) return;
    const ts = nowIso();
    // Remember the deletion (by id and by the text's id) so a Kindle re-import doesn't bring it back.
    src.deleted[hid] = ts; src.deleted[highlightId(src.id, h.text)] = ts;
    src.highlights = src.highlights.filter(x => x.id !== hid);
    delete review[hid];
    dirty.review = true;
    saveSource(src);
    scheduleFlush(20000);
  }
  // Title and author are only labels: the id never changes, so Kindle re-imports still find the book.
  function updateSource(sourceId, { title, author }) {
    const src = sources[sourceId];
    if (!src) return;
    const changed = (title && title !== src.title) || (author != null && author !== src.author);
    if (title) src.title = title;
    if (author != null) src.author = author;
    src.titleEdited = true;
    if (changed && src.kind === "book" && !src.cover) src.cover = null;   // look the cover up again
    saveSource(src);
    fillCovers();
  }
  // Tidy titles saved before the clean-up existed (or arriving from another device). Hand-edited ones are left alone.
  function tidyTitles() {
    let n = 0;
    for (const src of allSources()) {
      if (src.kind !== "book" || src.titleEdited) continue;
      const title = cleanTitle(src.title, src.author), author = cleanAuthor(src.author);
      if (title === src.title && author === src.author) continue;
      src.title = title; src.author = author;
      if (src.cover === "") src.cover = null;
      src.updated = nowIso(); markDirty(src.id); n++;
    }
    if (n) { persist(); emit(); scheduleFlush(2500); }
    return n;
  }
  // Add tags to many highlights in one source with a single save (approved tag suggestions).
  function bulkTag(sourceId, map) {
    const src = sources[sourceId];
    if (!src) return 0;
    let n = 0;
    const t = nowIso();
    for (const h of src.highlights) {
      const add = (map[h.id] || []).map(normTag).filter(x => x && !h.tags.includes(x));
      if (add.length) { h.tags = [...h.tags, ...add]; h.updated = t; n++; }
    }
    if (n) saveSource(src);
    return n;
  }
  function setCover(sourceId, cover) {
    const src = sources[sourceId];
    if (!src) return;
    src.cover = cover;
    saveSource(src);
  }
  function findHighlight(hid) {
    for (const src of allSources()) { const h = src.highlights.find(x => x.id === hid); if (h) return { src, h }; }
    return null;
  }
  function allHighlights() {
    const out = [];
    for (const src of allSources()) for (const h of src.highlights) out.push({ src, h });
    return out;
  }
  function allTags() {
    const counts = new Map();
    for (const { h } of allHighlights()) for (const t of h.tags) counts.set(t, (counts.get(t) || 0) + 1);
    return counts;
  }
  const lastHighlighted = src => src.highlights.reduce((m, h) => (h.created > m ? h.created : m), src.added || "");
  // Reading order: by location, then page, then date added. Thoughts: newest first.
  function sortedHighlights(src) {
    const list = src.highlights.slice();
    if (src.kind === "thoughts") return list.sort((a, b) => (a.created < b.created ? 1 : -1));
    const key = h => { const r = locRange(h.location); return r ? r[0] : (typeof h.page === "number" ? h.page * 1000 : Infinity); };
    return list.sort((a, b) => (key(a) - key(b)) || (a.created < b.created ? -1 : 1));
  }

  // ---------- review ----------
  const getReview = hid => review[hid] || null;
  function nextReview(entry, action, today) {
    const base = (entry && entry.interval) || 3;
    let interval = base, state = "active";
    if (action === "keep") interval = Math.max(7, base * 2);
    else if (action === "sooner") interval = Math.max(2, Math.round(base / 2));
    else if (action === "less") interval = Math.max(30, base * 4);
    else if (action === "discard") state = "discarded";
    interval = Math.min(interval, 730);
    return { due: addDays(today, interval), interval, state, seen: ((entry && entry.seen) || 0) + 1, t: Date.now(), last: today };
  }
  function reviewAction(hid, action) {
    review[hid] = nextReview(review[hid], action, todayStr());
    dirty.review = true;
    persist();
    scheduleFlush(20000);   // a batch after the session, not per tap
  }
  function restoreToReview(hid) {
    const e = review[hid];
    if (!e) return;
    review[hid] = { ...e, state: "active", due: todayStr(), t: Date.now() };
    dirty.review = true; persist(); scheduleFlush(20000); emit();
  }
  // Take back the last review action (the toast's Undo). A never-seen highlight comes back as due now.
  function undoReview(hid, prev) {
    review[hid] = prev ? { ...prev, t: Date.now() } : { due: todayStr(), interval: 3, state: "active", seen: 0, t: Date.now(), last: "" };
    dirty.review = true; persist(); scheduleFlush(20000);
  }
  const reviewedToday = (today = todayStr()) => Object.values(review).filter(e => e.last === today).length;

  // Today's picks: due first, then never-seen; favourites weighted up; some randomness,
  // and a nudge against several from the same source in a row.
  function pickDaily(items, reviewMap, today, quota, rng = Math.random) {
    const pool = [];
    for (const { src, h } of items) {
      const e = reviewMap[h.id];
      let score;
      if (e) {
        if (e.state === "discarded" || e.due > today) continue;
        const overdue = Math.round((new Date(today) - new Date(e.due)) / 86400000);
        score = 1000 + Math.min(overdue, 60) * 4;
      } else score = 500;
      if (h.favourite) score += 150;
      pool.push({ id: h.id, sourceId: src.id, score: score + rng() * 300 });
    }
    const picked = [], perSource = {};
    while (picked.length < quota && pool.length) {
      let best = 0, bestScore = -Infinity;
      pool.forEach((c, i) => { const s = c.score - (perSource[c.sourceId] || 0) * 90; if (s > bestScore) { bestScore = s; best = i; } });
      const [c] = pool.splice(best, 1);
      picked.push(c.id); perSource[c.sourceId] = (perSource[c.sourceId] || 0) + 1;
    }
    return picked;
  }
  // Today's cards still to do, plus how many were done today (on any device).
  function dailyQueue(today = todayStr()) {
    const done = reviewedToday(today);
    let saved = lsGet(K.today, null);
    if (!saved || saved.date !== today) {
      saved = { date: today, ids: pickDaily(allHighlights(), review, today, Math.max(0, DAILY_MAX - done)) };
      lsSet(K.today, saved);
    }
    const pending = saved.ids.filter(id => findHighlight(id) && !(review[id] && review[id].last === today));
    return { pending, done };
  }

  // ---------- search ----------
  function search(query, tags = []) {
    const terms = norm(query).split(" ").filter(Boolean);
    const out = [];
    for (const { src, h } of allHighlights()) {
      if (tags.length && !tags.every(t => h.tags.includes(t))) continue;
      if (terms.length) {
        const hay = norm([h.text, h.note, src.title, src.author, h.tags.join(" ")].join(" \n "));
        if (!terms.every(t => hay.includes(t))) continue;
      }
      out.push({ src, h });
    }
    return out.sort((a, b) => (a.h.created < b.h.created ? 1 : -1));
  }

  // ---------- merging (two devices, or this device and the repo) ----------
  // Fixed key order and sorted lists, so equal data always compares equal.
  function canonSource(s) {
    const hl = s.highlights.map(h => ({
      id: h.id, text: h.text, note: h.note || "", tags: h.tags || [], location: h.location ?? null, page: h.page ?? null,
      via: h.via || "manual", favourite: !!h.favourite, ...(h.edited ? { edited: true } : {}), ...(h.noteEdited ? { noteEdited: true } : {}), ...(h.noteOriginal ? { noteOriginal: h.noteOriginal } : {}), created: h.created, updated: h.updated,
    })).sort((a, b) => (a.id < b.id ? -1 : 1));
    const deleted = Object.fromEntries(Object.entries(s.deleted || {}).sort(([a], [b]) => (a < b ? -1 : 1)));
    return { id: s.id, kind: s.kind, title: s.title, author: s.author || "", ...(s.titleEdited ? { titleEdited: true } : {}), cover: s.cover ?? null, url: s.url ?? null, added: s.added, updated: s.updated, highlights: hl, deleted };
  }
  function mergeSource(a, b) {
    const newer = a.updated >= b.updated ? a : b, older = newer === a ? b : a;
    const deleted = { ...(older.deleted || {}) };
    for (const [id, ts] of Object.entries(newer.deleted || {})) if (!deleted[id] || ts > deleted[id]) deleted[id] = ts;
    const byId = new Map();
    for (const h of [...a.highlights, ...b.highlights]) { const cur = byId.get(h.id); if (!cur || h.updated > cur.updated) byId.set(h.id, h); }
    const highlights = [...byId.values()].filter(h => !(deleted[h.id] && deleted[h.id] >= h.updated));
    const cover = newer.cover !== null && newer.cover !== undefined ? newer.cover : older.cover ?? null;
    return canonSource({ ...newer, cover, added: a.added < b.added ? a.added : b.added, highlights, deleted });
  }
  function mergeReview(a, b) {
    const out = { ...a };
    for (const [id, e] of Object.entries(b || {})) if (!out[id] || e.t > out[id].t) out[id] = e;
    return out;
  }
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  // ---------- GitHub contents API ----------
  const toB64 = s => { const bytes = new TextEncoder().encode(s); let out = ""; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  const gh = (path, opts = {}, raw = false) => fetch(`https://api.github.com/repos/${STATE_REPO}/contents/${enc(path)}`, {
    cache: "no-store", ...opts,
    headers: { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  const fail = res => { throw new Error(res.status === 401 || res.status === 403 ? "setup" : "http"); };

  // name -> blob sha for the files in a folder (empty if the folder doesn't exist yet).
  async function listDir(path) {
    const res = await gh(path);
    if (res.status === 404) {
      // Missing folder, or no access to the repository: probe the repository itself.
      const repo = await fetch(`https://api.github.com/repos/${STATE_REPO}`, { cache: "no-store", headers: { Authorization: `Bearer ${token()}` } });
      if (!repo.ok) throw new Error("setup");
      return new Map();
    }
    if (!res.ok) fail(res);
    const list = await res.json();
    return new Map((Array.isArray(list) ? list : []).filter(e => e.type === "file").map(e => [e.name, e.sha]));
  }
  // Raw media type: works however large the file grows (the JSON form stops at 1 MB).
  async function getRaw(path) {
    const res = await gh(path, {}, true);
    if (!res.ok) fail(res);
    return JSON.parse(await res.text());
  }

  async function pull() {
    const [rootDir, srcDir] = await Promise.all([listDir(ROOT), listDir(`${ROOT}/sources`)]);
    let changed = false;
    const rsha = rootDir.get("review.json");
    if (rsha && rsha !== shas[REVIEW_PATH]) {
      const remote = await getRaw(REVIEW_PATH);
      const merged = mergeReview(review, remote);
      if (!same(merged, remote)) dirty.review = true;
      if (!same(merged, review)) changed = true;
      review = merged; shas[REVIEW_PATH] = rsha;
    }
    const todo = [...srcDir].filter(([name, sha]) => name.endsWith(".json") && sha !== shas[`${ROOT}/sources/${name}`]);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [name, sha] = todo[next++];
        const remote = await getRaw(`${ROOT}/sources/${name}`);
        if (!remote || !remote.id || !Array.isArray(remote.highlights)) continue;
        remote.deleted = remote.deleted || {};
        const local = sources[remote.id];
        const merged = local ? mergeSource(local, remote) : canonSource(remote);
        if (local && !same(merged, canonSource(remote))) markDirty(remote.id);
        if (!local || !same(merged, canonSource(local))) changed = true;
        sources[remote.id] = merged; shas[`${ROOT}/sources/${name}`] = sha;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    persist();
    if (changed) emit();
    tidyTitles();
  }

  async function pushSource(id, dir) {
    const path = `${ROOT}/sources/${id}.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = dir.get(`${id}.json`);
      // Someone else (another device) wrote since we last looked: merge, never overwrite.
      if (sha && sha !== shas[path]) {
        const remote = await getRaw(path);
        remote.deleted = remote.deleted || {};
        sources[id] = mergeSource(sources[id], remote); shas[path] = sha; persist(); emit();
      }
      const stamp = sources[id].updated;
      const res = await gh(path, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Commonplace sync", content: toB64(JSON.stringify(canonSource(sources[id]))), ...(sha ? { sha } : {}) }),
      });
      if (res.ok) {
        const body = await res.json();
        shas[path] = body.content.sha; dir.set(`${id}.json`, body.content.sha);
        if (sources[id].updated === stamp) dirty.sources = dirty.sources.filter(x => x !== id);
        persist();
        return;
      }
      if (res.status === 409 || res.status === 422) { const fresh = await listDir(`${ROOT}/sources`); dir.clear(); fresh.forEach((v, k) => dir.set(k, v)); continue; }
      fail(res);
    }
    throw new Error("http");
  }
  async function pushReview() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = (await listDir(ROOT)).get("review.json");
      if (sha && sha !== shas[REVIEW_PATH]) { review = mergeReview(review, await getRaw(REVIEW_PATH)); shas[REVIEW_PATH] = sha; persist(); }
      const snapshot = JSON.stringify(review);
      const res = await gh(REVIEW_PATH, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Commonplace review", content: toB64(snapshot), ...(sha ? { sha } : {}) }),
      });
      if (res.ok) {
        shas[REVIEW_PATH] = (await res.json()).content.sha;
        if (JSON.stringify(review) === snapshot) dirty.review = false;
        persist();
        return;
      }
      if (res.status === 409 || res.status === 422) continue;
      fail(res);
    }
    throw new Error("http");
  }

  let busy = false, again = false, timer = null;
  function scheduleFlush(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => { sync(); }, ms);
  }
  const pendingCount = () => dirty.sources.length + (dirty.review ? 1 : 0);
  // Pull what other devices wrote, then send what's waiting here. Safe to call any time.
  async function sync() {
    clearTimeout(timer);
    if (!token()) return setStatus("setup", "Needs sync set up");
    if (busy) { again = true; return; }
    busy = true;
    try {
      setStatus("syncing", "Syncing…");
      await pull();
      if (dirty.sources.length) {
        const dir = await listDir(`${ROOT}/sources`);
        for (const id of [...dirty.sources]) if (sources[id]) await pushSource(id, dir); else dirty.sources = dirty.sources.filter(x => x !== id);
      }
      if (dirty.review) await pushReview();
      persist();
      setStatus("synced", cacheError ? "Synced (this device is full)" : "Synced ✓");
    } catch (e) {
      if (e.message === "setup") setStatus("setup", "Sync needs setup");
      else if (!navigator.onLine || e instanceof TypeError) setStatus("offline", pendingCount() ? "Offline: saved on this device, will sync" : "Offline");
      else setStatus("error", "Sync failed: will retry");
    } finally {
      busy = false;
      if (again) { again = false; scheduleFlush(1500); }
    }
  }

  // ---------- covers ----------
  let lookupFailed = false;   // a request failed (offline, blocked): "no cover found" isn't certain then
  const getJson = async url => { try { const r = await fetch(url); if (!r.ok) { lookupFailed = true; return null; } return await r.json(); } catch (e) { lookupFailed = true; return null; } };
  const olCover = id => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
  async function olSearch(title, author, limit) {
    const q = new URLSearchParams({ title, limit: String(limit), fields: "cover_i", lang: "en" });
    if (author) q.set("author", author);
    const data = await getJson(`https://openlibrary.org/search.json?${q}`);
    return ((data && data.docs) || []).filter(d => d.cover_i).map(d => olCover(d.cover_i));
  }
  async function googleCover(title, author) {
    const q = `intitle:${title}` + (author ? `+inauthor:${author}` : "");
    const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q).replace(/%2B/g, "+")}&maxResults=1`);
    const link = data && data.items && data.items[0] && data.items[0].volumeInfo && data.items[0].volumeInfo.imageLinks;
    return link && link.thumbnail ? link.thumbnail.replace(/^http:/, "https:") : null;
  }
  // One cover URL for a book: Open Library first, Google Books if that has none.
  // "" means none exists; null means we couldn't check (try again later).
  async function findCover(title, author) {
    lookupFailed = false;
    const short = String(title).split(/[:(]/)[0].trim();
    // Several matches, first one that has a cover: the top match often has none.
    const first = (await olSearch(short || title, author, 10))[0] || (short && short !== title ? (await olSearch(title, author, 10))[0] : null);
    const found = first || (await googleCover(short || title, author));
    return found || (lookupFailed ? null : "");
  }
  async function coverCandidates(title, author) {
    const short = String(title).split(/[:(]/)[0].trim();
    const list = await olSearch(short || title, author, 12);
    return [...new Set(list)].slice(0, 6);
  }
  let coverQueueRunning = false;
  // Look up covers once for books that don't have one yet; the URL is saved on the source.
  async function fillCovers() {
    if (coverQueueRunning) return;
    coverQueueRunning = true;
    try {
      // Once per device: look again for books saved as "no cover" by the old, one-result lookup.
      if (ls() && !ls().getItem("cp-cover-retry-v2")) {
        for (const s of allSources()) if (s.kind === "book" && s.cover === "") s.cover = null;
        ls().setItem("cp-cover-retry-v2", "1");
      }
      // One book failing (Google Books often refuses keyless browser requests) must not hold up the rest:
      // skip it, leave it for next time, and carry on. Stop only when offline or nothing is getting through.
      let failures = 0;
      for (const src of allSources().filter(s => s.kind === "book" && (s.cover === null || s.cover === undefined))) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        const url = await findCover(src.title, src.author);
        if (url === null) { if (++failures >= 5) break; continue; }
        failures = 0;
        if (sources[src.id] && (sources[src.id].cover === null || sources[src.id].cover === undefined)) setCover(src.id, url);
        await new Promise(r => setTimeout(r, 250));   // be gentle with Open Library
      }
    } finally { coverQueueRunning = false; }
  }

  async function init() {
    tidyTitles();
    if (!token()) return setStatus("setup", "Needs sync set up");
    await sync();
  }

  // Send anything waiting when the page is hidden or the network comes back.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.hidden) { if (pendingCount()) sync(); } else if (token()) sync(); });
    window.addEventListener("online", () => sync());
    window.addEventListener("pagehide", () => { if (pendingCount()) sync(); });
  }

  return {
    THOUGHTS_ID, DAILY_MAX, hasToken: () => !!token(), init, sync, onChange, onStatus, getStatus, pendingCount,
    // sources and highlights
    allSources, getSource, ensureSource, saveSource, updateSource, bulkTag, tidyTitles, cleanTitle, cleanAuthor, makeHighlight, addHighlight, updateHighlight, deleteHighlight, setCover, findHighlight,
    allHighlights, allTags, lastHighlighted, sortedHighlights, hasHighlightData, search,
    // review
    getReview, reviewAction, undoReview, restoreToReview, dailyQueue, reviewedToday, pickDaily, nextReview,
    // covers
    findCover, coverCandidates, fillCovers,
    // pure helpers (also used by the Kindle importer and tests)
    sourceIdFor, highlightId, norm, normTag, locRange, mergeSource, mergeReview, canonSource, todayStr, addDays,
    _reset(state) { sources = state.sources || {}; review = state.review || {}; shas = {}; dirty = { sources: [], review: false }; },
  };
});
