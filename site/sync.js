// Keeps watched/read ticks and Watch Later / Read Later in sync between
// devices, via one JSON file in a private GitHub repository.
//
// Each change is stamped with the time it was made, so when two devices
// disagree the most recent change to each video or story wins. Uses the
// same device-only GitHub token as the Update button, which needs
// "Contents: Read and write" on the private state repository.
(() => {
  const STATE_REPO = "custerdomecreative/my-youtube-state";
  const STATE_PATH = "state.json";
  const TOKEN_KEY = "gh-token-v1";
  const META_KEY = "sync-meta-v1";
  // localStorage key -> kind. Sets hold ids; lists hold saved items.
  const TRACKED = { "watched-v1": "watched", "news-read-v1": "read", "later-v1": "videoLater", "news-later-v1": "newsLater" };
  const SETS = ["watched", "read"], LISTS = ["videoLater", "newsLater"];
  const KIND_KEY = Object.fromEntries(Object.entries(TRACKED).map(([k, v]) => [v, k]));
  const TOMBSTONE_DAYS = 30;

  const rawSet = Storage.prototype.setItem, rawGet = Storage.prototype.getItem;
  const read = (k, fallback) => { try { const v = rawGet.call(localStorage, k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const write = (k, v) => { try { rawSet.call(localStorage, k, JSON.stringify(v)); } catch (e) {} };

  // meta: { watched: {id: ts}, read: {id: ts}, videoLater: {id: {t, item}}, newsLater: {...} }
  // Set entries: ts > 0 means marked at ts, ts < 0 means unmarked at |ts|.
  // List entries: item null means removed at t.
  let meta = read(META_KEY, null);
  if (!meta) {
    meta = {};  // first run: adopt what's already on this device as very old changes
    for (const kind of SETS) meta[kind] = Object.fromEntries(read(KIND_KEY[kind], []).map(id => [id, 1]));
    for (const kind of LISTS) meta[kind] = Object.fromEntries(read(KIND_KEY[kind], []).map((item, i) => [item.id, { t: 1 + i, item }]));
    write(META_KEY, meta);
  }

  function record(kind, before, after) {
    const t = Date.now();
    if (SETS.includes(kind)) {
      const a = new Set(before || []), b = new Set(after || []);
      for (const id of b) if (!a.has(id)) meta[kind][id] = t;
      for (const id of a) if (!b.has(id)) meta[kind][id] = -t;
    } else {
      const a = new Map((before || []).map(x => [x.id, x])), b = new Map((after || []).map(x => [x.id, x]));
      for (const [id, item] of b) if (!a.has(id)) meta[kind][id] = { t, item };
      for (const id of a.keys()) if (!b.has(id)) meta[kind][id] = { t, item: null };
    }
  }

  // Watch the pages' own saves, so they need no changes of their own.
  Storage.prototype.setItem = function (key, value) {
    if (this !== localStorage || !TRACKED[key]) return rawSet.call(this, key, value);
    const before = read(key, []);
    rawSet.call(this, key, value);
    try { record(TRACKED[key], before, JSON.parse(value)); write(META_KEY, meta); schedule(); } catch (e) {}
  };

  const stamp = (kind, e) => SETS.includes(kind) ? Math.abs(e) : e.t;
  function merge(a, b) {
    const out = {};
    for (const kind of [...SETS, ...LISTS]) {
      out[kind] = { ...(a[kind] || {}) };
      for (const [id, e] of Object.entries((b && b[kind]) || {})) {
        if (!(id in out[kind]) || stamp(kind, e) > stamp(kind, out[kind][id])) out[kind][id] = e;
      }
    }
    return out;
  }
  function prune(m) {
    const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
    for (const kind of SETS) for (const [id, ts] of Object.entries(m[kind])) if (ts < 0 && -ts < cutoff) delete m[kind][id];
    for (const kind of LISTS) for (const [id, e] of Object.entries(m[kind])) if (!e.item && e.t < cutoff) delete m[kind][id];
    return m;
  }
  const same = (a, b) => [...SETS, ...LISTS].every(kind => {
    const x = (a && a[kind]) || {}, y = (b && b[kind]) || {};
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every(id => JSON.stringify(x[id]) === JSON.stringify(y[id]));
  });

  // Write the merged state back into the keys the pages read. True if anything changed.
  function apply() {
    let changed = false;
    for (const kind of SETS) {
      const ids = Object.entries(meta[kind]).filter(([, ts]) => ts > 0).sort((a, b) => a[1] - b[1]).map(([id]) => id);
      const current = read(KIND_KEY[kind], []);
      if (ids.length !== current.length || !current.every(id => meta[kind][id] > 0)) { write(KIND_KEY[kind], ids); changed = true; }
    }
    for (const kind of LISTS) {
      const items = Object.values(meta[kind]).filter(e => e.item).sort((a, b) => a.t - b.t).map(e => e.item);
      const current = read(KIND_KEY[kind], []);
      if (items.map(x => x.id).join() !== current.map(x => x.id).join()) { write(KIND_KEY[kind], items); changed = true; }
    }
    return changed;
  }

  // --- GitHub contents API ---
  const token = () => { try { return rawGet.call(localStorage, TOKEN_KEY); } catch (e) { return null; } };
  const gh = (opts = {}) => fetch(`https://api.github.com/repos/${STATE_REPO}/contents/${STATE_PATH}`, {
    cache: "no-store", ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  const toB64 = s => { const bytes = new TextEncoder().encode(s); let out = ""; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
  const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));

  let status = "";
  function show(text, title = "") {
    status = text;
    const box = document.querySelector(".update-box");
    if (!box) return;
    let node = box.querySelector(".sync-status");
    if (!node) { node = document.createElement("div"); node.className = "sync-status"; box.append(node); }
    node.textContent = text; node.title = title;
  }

  let busy = false, again = false, pendingReload = false;
  async function sync(attempt = 0) {
    if (!token()) return show("Sync off", "Enter your GitHub token (via Update now) to sync between devices.");
    if (busy) { again = true; return; }
    busy = true;
    try {
      show("Syncing…");
      const res = await gh();
      let remote = null, sha;
      if (res.ok) { const file = await res.json(); sha = file.sha; remote = JSON.parse(fromB64(file.content)); }
      else if (res.status === 404 && attempt === 0) {
        // Missing file, or no access to the repository: probe the repository itself.
        const repo = await fetch(`https://api.github.com/repos/${STATE_REPO}`, { cache: "no-store", headers: { Authorization: `Bearer ${token()}` } });
        if (!repo.ok) throw new Error("setup");
      } else if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error("setup");
      else throw new Error("http");

      meta = prune(merge(meta, remote));
      write(META_KEY, meta);
      const changed = apply();
      if (!same(meta, remote)) {
        const put = await gh({
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Sync", content: toB64(JSON.stringify(meta)), ...(sha ? { sha } : {}) }),
        });
        if (put.status === 409 || put.status === 422) { busy = false; if (attempt < 2) return sync(attempt + 1); throw new Error("http"); }
        if (put.status === 401 || put.status === 403 || put.status === 404) throw new Error("setup");
        if (!put.ok) throw new Error("http");
      }
      show("Synced ✓");
      if (changed) reloadWhenIdle();
    } catch (e) {
      if (e.message === "setup") show("Sync needs setup", `The token needs "Contents: Read and write" access to ${STATE_REPO}.`);
      else show("Sync failed — will retry");
    } finally {
      busy = false;
      if (again) { again = false; schedule(); }
    }
  }

  // Another device changed things: show it, but never interrupt a video or an open article.
  function reloadWhenIdle() {
    if (document.querySelector(".player iframe, .reader, .pseudo-fs") || document.hidden) pendingReload = true;
    else location.reload();
  }

  let timer;
  function schedule() { clearTimeout(timer); timer = setTimeout(sync, 1500); }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (pendingReload && !document.querySelector(".player iframe, .reader, .pseudo-fs")) return location.reload();
    sync();
  });
  document.addEventListener("DOMContentLoaded", () => { if (status) show(status); sync(); });
  setInterval(() => { if (!document.hidden) sync(); }, 5 * 60000);
})();
