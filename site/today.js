// Today, the front page. Everything here is read on this device: highlights from the Commonplace data
// layer (CP, never sent anywhere), the Watch list and read ticks from this device's storage, and the
// day's stories, which are decrypted here with the key News already saved. Nothing is written except
// what Commonplace itself syncs.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
    }
    n.append(...kids.flat().filter(x => x != null && x !== false));
    return n;
  };
  const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const ago = iso => {
    if (!iso) return "";
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  };
  const duration = secs => {
    const m = Math.round(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.max(m, 1)} min`;
  };
  const libraryLink = id => `commonplace.html#library/${encodeURIComponent(id)}`;

  // ---------- picking passages ----------
  // One passage per day, the same on every device: a random pick seeded by the date, over the passages
  // sorted by id. Favourites and passages not seen for a long time weigh more.
  function pickSeeded(items, weight, salt) {
    if (!items.length) return null;
    const rng = CP.seeded(`${salt}:${CP.todayStr()}`);
    const list = items.slice().sort((a, b) => (a.h.id < b.h.id ? -1 : 1));
    const weights = list.map(weight);
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  function libraryWeight({ h }) {
    let w = h.favourite ? 3 : 1;
    const e = CP.getReview(h.id);
    if (!e) return w * 2.5;                       // never reviewed: long unseen
    const days = e.last ? Math.max(0, (new Date(CP.todayStr()) - new Date(e.last)) / 86400000) : 90;
    return w * (1 + Math.min(days, 365) / 90);
  }
  const usable = ({ src, h }) => src.kind !== "thoughts" && h.text && h.text.length >= 25 && h.text.length <= 700
    && (CP.getReview(h.id) || {}).state !== "discarded";

  // ---------- small pieces ----------
  const kicker = (text, cls = "") => el("div", { class: `kicker ${cls}`.trim(), text });
  function cite(src, h, withTags) {
    const where = h.location || (typeof h.page === "number" ? `p. ${h.page}` : "");
    return el("div", { class: "cite" },
      src.author && `${src.author}, `, el("a", { href: libraryLink(src.id) }, el("i", { text: src.title })),
      where && ` · ${where}`, h.favourite && " · ★ Favourite",
      withTags && h.tags.slice(0, 3).map(t => el("span", { class: "chip", text: t })));
  }
  const sizeFor = len => (len <= 140 ? "xl" : len <= 260 ? "l" : len <= 480 ? "m" : "s");
  const quote = (text, cls) => el("blockquote", { class: `quote ${cls}` }, `“${text}”`);
  function setupNote() {
    return el("div", {}, el("p", { class: "quiet", text: "Commonplace Book needs sync set up." }),
      el("a", { class: "link-strong", href: "watch.html", text: "Open Watch to set it up →" }));
  }

  // ---------- Commonplace: lead, library, now reading, latest note, AI passage ----------
  let leadId = null, libId = null;   // so the library and AI picks don't repeat the lead

  function renderLead() {
    const box = $("lead");
    box.replaceChildren();
    if (!CP.hasToken()) return void box.append(kicker("Today's review", "accent"), setupNote());
    if (!ready()) return void box.append(kicker("Today's review", "accent"), el("p", { class: "loading", text: "Loading your library…" }));
    if (!CP.hasHighlightData()) {
      return void box.append(kicker("Today's review", "accent"), el("p", { class: "quote m", text: "Nothing to review yet." }),
        el("div", { class: "actions-row" }, el("a", { class: "btn-ink", href: "commonplace.html#add", text: "Add a highlight →" })));
    }
    const q = CP.dailyQueue();
    const total = q.pending.length + q.done;
    const first = q.pending.length ? CP.findHighlight(q.pending[0]) : null;
    if (first) {
      leadId = first.h.id;
      box.append(
        kicker(`Today's review · ${q.done + 1} of ${total}`, "accent"),
        quote(first.h.text, sizeFor(first.h.text.length)),
        cite(first.src, first.h, true),
        el("div", { class: "actions-row" }, el("a", { class: "btn-ink", href: "commonplace.html#review", text: "Begin today's review →" })));
    } else if (total) {
      const favs = CP.allHighlights().filter(x => usable(x) && x.h.favourite);
      const pick = pickSeeded(favs.length ? favs : CP.allHighlights().filter(usable), () => 1, "done");
      box.append(kicker("Today's review", "accent"), el("h2", { class: "done-head", text: "Done for today" }));
      if (pick) { leadId = pick.h.id; box.append(kicker("A favourite", "small"), quote(pick.h.text, "l"), cite(pick.src, pick.h, true)); }
      box.append(el("a", { class: "link-strong", href: "commonplace.html", text: "Commonplace Book →" }));
    } else {
      box.append(kicker("Today's review", "accent"), el("p", { class: "quote m", text: "Nothing is due today." }),
        el("a", { class: "link-strong", href: "commonplace.html#library", text: "Browse your library →" }));
    }
  }

  function coverEl(src) {
    const ph = () => el("div", { class: "cover ph", "aria-hidden": "true", text: src.title });
    if (!src.cover) return ph();
    const img = el("img", { class: "cover", src: src.cover, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(ph()));
    return img;
  }

  function renderLibrary() {
    const box = $("lib");
    box.replaceChildren();
    if (!CP.hasToken()) return void box.append(el("div", { class: "block" }, kicker("From your library"), setupNote()));
    if (!ready()) return void box.append(el("div", { class: "block" }, kicker("From your library"), el("p", { class: "loading", text: "Loading…" })));
    const all = CP.allHighlights();

    // From your library
    const q = CP.hasHighlightData() ? CP.dailyQueue() : { pending: [] };
    const skip = new Set([leadId, ...q.pending]);
    const pick = pickSeeded(all.filter(x => usable(x) && !skip.has(x.h.id)), libraryWeight, "library");
    libId = pick ? pick.h.id : null;
    if (pick) box.append(el("div", { class: "block" }, kicker("From your library"), quote(pick.h.text, "plain"), cite(pick.src, pick.h, false)));

    // Now reading
    const reading = CP.nowReading();
    if (reading) {
      const { src } = reading, n = src.highlights.length;
      box.append(el("div", { class: "block" }, kicker("Now reading"),
        el("div", { class: "reading" }, el("a", { href: libraryLink(src.id), "aria-hidden": "true", tabindex: "-1" }, coverEl(src)),
          el("div", {}, el("a", { class: "t", href: libraryLink(src.id), text: src.title }),
            el("div", { class: "by", text: [src.author, plural(n, "highlight")].filter(Boolean).join(" · ") })))));
    }

    // Your latest note: the note most recently written or edited (a note typed in the app counts from when you
    // last changed it, a Kindle note from when it was imported).
    let latest = null, latestAt = "";
    for (const x of all) {
      if (!x.h.note || !x.h.note.trim()) continue;
      const at = x.h.noteEdited ? x.h.updated : x.h.created;
      if (at > latestAt) { latestAt = at; latest = x; }
    }
    if (latest) {
      const { src, h } = latest;
      box.append(el("div", { class: "block" }, kicker("Your latest note"), el("p", { class: "note-quote", text: h.note.trim() }),
        el("div", { class: "cite" }, src.kind === "thoughts" ? "From " : "On ", src.author && src.kind !== "thoughts" ? `${src.author}, ` : "",
          el("a", { href: libraryLink(src.id) }, el("i", { text: src.title })))));
    }
    if (!box.children.length) box.append(el("div", { class: "block" }, kicker("From your library"), el("p", { class: "quiet", text: "Your highlights will appear here." })));
  }

  // The first sync decides what's on this device; wait for it (briefly) before picking today's set, so an empty
  // cache never writes an empty day. After a few seconds, or if offline, show what's saved here.
  let waited = false;
  setTimeout(() => { waited = true; renderCommonplace(); }, 5000);
  function ready() {
    const s = CP.getStatus().state;
    return waited || (s !== "idle" && s !== "syncing");
  }
  function renderCommonplace() { renderLead(); renderLibrary(); renderAiDesk(); }

  // ---------- News ----------
  async function loadStories(prefix) {
    const raw = load("news-key-v1", null);
    if (!raw) return { locked: true };
    try {
      const res = await fetch(`${prefix}news.enc.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return { error: true };
      const enc = await res.json();
      const key = await crypto.subtle.importKey("raw", b64(raw), { name: "AES-GCM" }, false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.data));
      return { stories: JSON.parse(new TextDecoder().decode(plain)).stories || [] };
    } catch (e) { return { error: true }; }
  }
  // Which stories are in today's paper lives in paper.js, shared with the News page.
  const readSet = () => new Set(load("news-read-v1", []));
  const laterIds = key => new Set(load(key, []).map(s => s.id));
  const recent = (stories, laterKey) => Paper.recent(stories, readSet(), laterIds(laterKey));
  const todaysPaper = (stories, laterKey) => Paper.todaysPaper(stories, readSet(), laterIds(laterKey));
  const NEWS_SOURCES = Paper.NEWS_SOURCES;
  function minutesToRead(s) {
    if (!Array.isArray(s.text)) return 0;
    const words = s.text.reduce((n, p) => n + (typeof p === "string" ? p
      : Array.isArray(p) ? p.map(r => r[0]).join("") : "").split(/\s+/).filter(Boolean).length, 0);
    return words ? Math.max(1, Math.round(words / 230)) : 0;
  }
  const storyHref = (s, ai) => (s.text ? `${ai ? "ai.html" : "news.html"}?story=${encodeURIComponent(s.id)}` : s.link);
  const storyAttrs = s => (s.text ? {} : { target: "_blank", rel: "noopener" });
  const sourceLine = s => [s.source, minutesToRead(s) ? `${minutesToRead(s)} min read` : ""].filter(Boolean).join(" · ");

  let newsData = null;
  function renderNews() {
    const box = $("news");
    box.replaceChildren(kicker("News"));
    if (!newsData) return void box.append(el("p", { class: "loading", text: "Loading…" }));
    if (newsData.locked) return void box.append(el("p", { class: "quiet", text: "Enter your news password to see today's stories." }), el("a", { class: "link-strong", href: "news.html", text: "Open News →" }));
    if (newsData.error) return void box.append(el("p", { class: "quiet", text: "News isn't available right now." }), el("a", { class: "link-strong", href: "news.html", text: "Open News →" }));
    const paper = todaysPaper(newsData.stories, "news-later-v1");
    if (!paper.length) return void box.append(el("p", { class: "quiet", text: "You've read today's paper." }), el("a", { class: "link-strong", href: "news.html", text: "All stories →" }));

    const isNews = s => NEWS_SOURCES.has(s.source);
    const lead = paper.find(s => isNews(s) && s.summary && s.summary.trim()) || paper.find(isNews) || paper[0];
    box.append(el("article", { class: "lead-story" },
      el("a", { class: "h", href: storyHref(lead), ...storyAttrs(lead), text: lead.title }),
      lead.summary && el("p", { class: "sum", text: lead.summary }),
      el("div", { class: "src", text: sourceLine(lead) })));
    // 3 to 5 headlines, no more than two from one source so the front page isn't one site.
    const perSource = { [lead.source]: 1 }, newsHeads = [], extras = paper.filter(s => s !== lead && !isNews(s));
    for (const s of paper) {
      if (s === lead || !isNews(s) || (perSource[s.source] || 0) >= 2) continue;
      perSource[s.source] = (perSource[s.source] || 0) + 1;
      newsHeads.push(s);
    }
    const heads = [];
    for (let i = 0; i < 5; i++) {
      const next = (i === 2 || i === 4) && extras.length ? extras.shift() : newsHeads.shift() || extras.shift();
      if (next) heads.push(next);
    }
    heads.forEach((s, i) => box.append(el("article", { class: `hl${i >= 3 ? " extra" : ""}` },
      el("a", { class: "h", href: storyHref(s), ...storyAttrs(s), text: s.title }), el("div", { class: "src", text: sourceLine(s) }))));
    box.append(el("a", { class: "link-strong", href: "news.html", text: `Today's paper — ${paper.length} ${paper.length === 1 ? "story" : "stories"} →` }));
  }

  // ---------- The AI desk ----------
  let aiNews = null, aiVideos = null;
  function renderAiDesk() {
    const box = $("ai");
    const items = [];
    if (CP.hasToken() && ready() && CP.hasHighlightData()) {
      const mine = CP.allHighlights().filter(x => usable(x) && x.h.id !== libId && x.h.id !== leadId && x.h.tags.some(t => t === "ai" || t === "ai-parallel"));
      const pick = pickSeeded(mine, x => (x.h.favourite ? 3 : 1) * (x.h.tags.includes("ai-parallel") ? 2 : 1), "ai");
      if (pick) {
        const tag = pick.h.tags.includes("ai-parallel") ? "ai-parallel" : "ai";
        items.push(el("article", {}, kicker(`From your notes · ${tag}`, "small"), quote(pick.h.text, "sm"),
          el("div", { class: "cite" }, pick.src.author && `${pick.src.author}, `, el("a", { href: libraryLink(pick.src.id) }, el("i", { text: pick.src.title })))));
      }
    }
    if (aiNews && aiNews.stories) {
      const s = recent(aiNews.stories, "ai-news-later-v1")[0];
      if (s) items.push(el("article", {}, kicker(`News · ${s.source}`, "small"),
        el("a", { class: "h", href: storyHref(s, true), ...storyAttrs(s), text: s.title }),
        minutesToRead(s) ? el("div", { class: "src", text: `${minutesToRead(s)} min read` }) : null));
    }
    if (aiVideos) {
      const watched = new Set(load("watched-v1", [])), later = new Set(load("ai-later-v1", []).map(v => v.id));
      const v = aiVideos.find(x => !watched.has(x.id) && !later.has(x.id));
      if (v) items.push(el("article", {}, kicker(`Video · ${v.channel}`, "small"),
        el("a", { class: "ai-video", href: `ai.html?v=${encodeURIComponent(v.id)}` }, el("img", { class: "thumb small", src: v.thumbnail, alt: "", loading: "lazy" }),
          el("span", { class: "h", text: v.title }))));
    }
    box.hidden = !items.length;
    box.replaceChildren(...(items.length ? [el("div", { class: "watch-head" }, kicker("The AI desk"), el("a", { href: "ai.html", text: "Open the AI desk →" })), el("div", { class: "ai-items" }, items)] : []));
  }

  // ---------- Watch ----------
  // The three videos most recently saved to the watch list that aren't watched yet.
  function renderWatch() {
    const box = $("watch");
    const watched = new Set(load("watched-v1", []));
    const saved = load("later-v1", []).filter(v => !watched.has(v.id));
    box.hidden = !saved.length;
    if (!saved.length) return box.replaceChildren();
    const progress = load("progress-v1", {});
    box.replaceChildren(
      el("div", { class: "watch-head" }, kicker("Watch"), el("a", { href: "watch.html#later", text: `Your watch list (${saved.length}) →` })),
      el("div", { class: "watch-items" }, saved.slice(-3).reverse().map(v => {
        const len = progress[v.id] && progress[v.id][1] ? duration(progress[v.id][1]) : "";
        return el("a", { class: "watch-item", href: `watch.html?v=${encodeURIComponent(v.id)}` }, el("img", { class: "thumb", src: v.thumbnail, alt: "", loading: "lazy" }),
          el("div", {}, el("div", { class: "h", text: v.title }), el("div", { class: "src", text: [v.channel, len || ago(v.published)].filter(Boolean).join(" · ") })));
      })));
  }

  // ---------- go ----------
  function renderAll() { renderCommonplace(); renderNews(); renderAiDesk(); renderWatch(); }
  renderAll();

  CP.onChange(() => { clearTimeout(renderAll.t); renderAll.t = setTimeout(renderCommonplace, 200); });
  CP.onStatus(() => { clearTimeout(renderAll.t); renderAll.t = setTimeout(renderCommonplace, 200); });
  CP.init();

  loadStories("").then(d => { newsData = d; renderNews(); });
  loadStories("ai-").then(d => { aiNews = d; renderAiDesk(); });
  fetch(`ai-videos.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json()).then(d => { aiVideos = d.videos || []; renderAiDesk(); }).catch(() => {});
  fetch(`videos.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json())
    .then(d => { $("updated").textContent = d.updated ? `Updated ${ago(d.updated)}` : ""; }).catch(() => {});

  // Back to the page, or a new day: redraw from what's saved on this device.
  const refresh = () => { if (!document.hidden) { renderAll(); } };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  window.addEventListener("storage", e => { if (/^(watched-v1|later-v1|ai-later-v1|news-read-v1|news-later-v1|ai-news-later-v1)$/.test(e.key || "")) { renderNews(); renderAiDesk(); renderWatch(); } });
})();
