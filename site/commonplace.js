// Commonplace UI: Review (default), Library, Add, Search, and the Kindle Import screen.
// Everything is built with textContent, never innerHTML, because highlights are arbitrary text.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const main = $("main");

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "value") node.value = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(kid));
    return node;
  }
  const VIA = { kindle: "Kindle", photo: "Photo", manual: "Typed", dictation: "Spoken", article: "Article" };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const go = (name, arg) => { location.hash = "#" + name + (arg ? "/" + encodeURIComponent(arg) : ""); };

  const ui = { editors: 0, reviewing: false, search: { q: "", tags: new Set(), shown: 40 } };

  // For cp-suggest.js: the same element helper, toasts, and a way to hold off background redraws.
  window.CPUI = { el: (...a) => el(...a), toast: (...a) => toast(...a), hold: () => { ui.editors++; let done = false; return () => { if (!done) { done = true; ui.editors = Math.max(0, ui.editors - 1); } }; } };

  // ---------- toast ----------
  let toastTimer = null;
  function toast(message, undo) {
    const t = $("toast");
    t.replaceChildren(message);
    if (undo) t.append(" ", el("button", { class: "btn small", type: "button", text: "Undo", onclick: () => { clearTimeout(toastTimer); t.hidden = true; undo(); } }));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 2800);
  }

  // ---------- routing ----------
  function parseRoute() {
    const raw = location.hash.slice(1), i = raw.indexOf("?");
    const path = i < 0 ? raw : raw.slice(0, i), params = new URLSearchParams(i < 0 ? "" : raw.slice(i + 1));
    const [name, arg] = path.split("/");
    return { name: name || "review", arg: arg ? decodeURIComponent(arg) : null, params };
  }
  function render() {
    ui.editors = 0; ui.reviewing = false;
    const route = parseRoute();
    const tab = route.name === "import" ? "library" : route.name;
    document.querySelectorAll("#views .tab").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === tab)));
    main.replaceChildren();
    if (!CP.hasToken()) return main.append(setupView());
    const views = { review: reviewView, library: libraryView, add: addView, search: searchView, import: importView };
    main.append((views[route.name] || reviewView)(route));
  }
  document.querySelectorAll("#views .tab").forEach(b => b.addEventListener("click", () => { if (location.hash === "#" + b.dataset.view) render(); else go(b.dataset.view); }));
  window.addEventListener("hashchange", render);

  // New data arrived (a sync, a cover): redraw the list views, but never while typing or mid-review.
  let redrawTimer = null;
  CP.onChange(() => {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      const name = parseRoute().name;
      if (ui.editors > 0 || /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "")) return;
      if (name === "library" || name === "review" || name === "search") render();
    }, 300);
  });
  CP.onStatus(s => {
    const b = $("sync-status");
    b.textContent = s.text;
    b.classList.toggle("attention", s.state === "setup" || s.state === "error");
  });
  $("sync-status").addEventListener("click", () => CP.sync());
  $("sync-status").textContent = CP.getStatus().text;

  // ---------- shared pieces ----------
  function setupView() {
    return el("div", { class: "empty" },
      el("strong", { text: "Commonplace Book needs sync set up" }),
      el("p", { class: "hint", text: "Your highlights are kept in your private repository, never on the public site. Open Watch and tap “Update now” once to paste your GitHub token, then come back." }),
      el("a", { class: "btn primary", href: "watch.html", text: "Open sync setup" }));
  }
  // Cover image, or the title set in Newsreader on a tinted card.
  function coverEl(src, cls) {
    const placeholder = () => el("div", { class: cls + " ph", "aria-hidden": "true", text: src.title });
    if (!src.cover) return placeholder();
    const img = el("img", { class: cls, src: src.cover, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(placeholder()));
    return img;
  }
  function markText(text, terms) {
    if (!terms || !terms.length) return text;
    const re = new RegExp("(" + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    return text.split(re).map((part, i) => (i % 2 ? el("mark", { text: part }) : part));
  }
  function tagInput(initial) {
    let tags = [...initial];
    const chips = el("div", { class: "chips" }), sug = el("div", { class: "suggest" });
    const input = el("input", { type: "text", placeholder: "Add a tag, then Enter", enterkeyhint: "done", autocapitalize: "none", autocomplete: "off", "aria-label": "Add a tag" });
    const add = raw => { for (const part of String(raw).split(",")) { const t = CP.normTag(part); if (t && !tags.includes(t)) tags.push(t); } input.value = ""; draw(); };
    function draw() {
      chips.replaceChildren(...tags.map(t => el("button", { type: "button", class: "tag on", "aria-label": `Remove tag ${t}`, onclick: () => { tags = tags.filter(x => x !== t); draw(); } }, t, el("span", { class: "x", text: "×" }))));
      const q = CP.normTag(input.value);
      const options = [...CP.allTags()].sort((a, b) => b[1] - a[1]).map(([t]) => t).filter(t => !tags.includes(t) && (!q || t.includes(q))).slice(0, 8);
      sug.replaceChildren(...options.map(t => el("button", { type: "button", class: "tag", onclick: () => add(t), text: t })));
    }
    input.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input.value); } });
    input.addEventListener("input", draw);
    draw();
    return { node: el("div", {}, chips, input, sug), get: () => { if (input.value.trim()) add(input.value); return tags; } };
  }
  // Note first (notes matter most), then tags; the passage text itself is tucked away.
  function editor(src, h, { onDone }) {
    ui.editors++;
    const note = el("textarea", { class: "note-in", rows: "5", value: h.note, placeholder: "Your own thoughts on this passage…", "aria-label": "My note" });
    const tags = tagInput(h.tags);
    const text = el("textarea", { rows: "5", value: h.text, "aria-label": "Passage text" });
    const close = result => { ui.editors = Math.max(0, ui.editors - 1); onDone(result); };
    const wrap = el("div", { class: "editor" },
      el("label", { class: "lbl", text: "My note" }), note,
      el("label", { class: "lbl", text: "Tags" }), tags.node,
      el("details", { class: "more" }, el("summary", { text: "Edit passage text" }), text),
      el("div", { class: "hl-actions" },
        el("button", { class: "btn primary small", type: "button", text: "Save", onclick: () => {
          CP.updateHighlight(src.id, h.id, { note: note.value.trim(), tags: tags.get(), text: text.value.trim() || h.text });
          close({ saved: true });
        } }),
        el("button", { class: "btn small", type: "button", text: "Cancel", onclick: () => close({}) }),
        el("button", { class: "btn small danger", type: "button", text: "Delete", onclick: () => {
          if (!confirm("Delete this highlight? It will be removed from your library.")) return;
          CP.deleteHighlight(src.id, h.id); close({ deleted: true });
        } })));
    // Open with the note ready to type in, unless focus has already moved somewhere inside the editor.
    setTimeout(() => { if (wrap.isConnected && !wrap.contains(document.activeElement)) note.focus(); }, 0);
    return wrap;
  }
  function starButton(sid, hid) {
    const cur = () => CP.findHighlight(hid);
    const b = el("button", { type: "button", class: "star", "aria-label": "Favourite" });
    const paint = on => { b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; b.setAttribute("aria-pressed", String(on)); };
    paint(!!(cur() && cur().h.favourite));
    b.addEventListener("click", () => { const f = cur(); if (!f) return; const on = !f.h.favourite; CP.updateHighlight(f.src.id, hid, { favourite: on }); paint(on); });
    return b;
  }
  // A highlight wherever it appears (source page, search): passage, then Aaron's note, tags, edit.
  function highlightCard(hid, opts = {}) {
    const card = el("article", { class: "hl" });
    let editing = false;
    function draw() {
      const f = CP.findHighlight(hid);
      if (!f) return card.remove();
      const { src, h } = f, rv = CP.getReview(h.id), discarded = !!(rv && rv.state === "discarded");
      card.className = "hl" + (discarded ? " discarded" : "");
      card.replaceChildren();
      if (opts.showSource) card.append(el("a", { class: "hl-src", href: `#library/${encodeURIComponent(src.id)}` }, coverEl(src, "cover"), el("span", {}, el("b", { text: src.title }), src.author ? " · " + src.author : "")));
      card.append(el("div", { class: "hl-top" }, el("p", { class: "passage" }, markText(h.text, opts.terms)), starButton(src.id, h.id)));
      if (h.note) card.append(el("div", { class: "note" }, markText(h.note, opts.terms)));
      if (h.note && h.noteOriginal && h.noteOriginal !== h.note) card.append(el("div", { class: "note-orig", text: "Typed on Kindle: " + h.noteOriginal }));
      if (h.tags.length) card.append(el("div", { class: "tags" }, h.tags.map(t => el("span", { class: "tag", text: t }))));
      const bits = [h.location, h.page != null ? `p. ${h.page}` : null, VIA[h.via], discarded ? "Not in review" : null].filter(Boolean);
      if (bits.length) card.append(el("div", { class: "meta-line", text: bits.join(" · ") }));
      if (editing) card.append(editor(src, h, { onDone: r => { editing = false; if (r.deleted) card.remove(); else draw(); } }));
      else card.append(el("div", { class: "hl-actions" },
        el("button", { class: "btn small", type: "button", text: h.note ? "Edit note & tags" : "Add note & tags", onclick: () => { editing = true; draw(); } }),
        discarded && el("button", { class: "btn small", type: "button", text: "Back in review", onclick: () => { CP.restoreToReview(h.id); toast("Back in review"); draw(); } })));
    }
    draw();
    return card;
  }

  // ---------- Review ----------
  function emptyState() {
    const loading = CP.getStatus().state === "syncing";
    return el("div", { class: "empty" },
      el("strong", { text: loading ? "Loading your library…" : "Nothing here yet" }),
      !loading && el("p", { class: "hint", text: "Import your Kindle clippings or add a thought, and highlights will start coming back to you here." }),
      !loading && el("div", { class: "row", style: "justify-content:center" },
        el("a", { class: "btn primary", href: "#import", text: "Import Kindle clippings" }),
        el("a", { class: "btn", href: "#add", text: "Add a thought" })));
  }
  function doneState(q) {
    return el("div", { class: "rv-done" },
      el("p", { class: "big-num", text: q.done ? "Done for today" : "Nothing due today" }),
      el("p", { class: "hint", text: q.done ? `${plural(q.done, "highlight")} reviewed. See you tomorrow.` : "Everything is scheduled for later. Come back tomorrow." }),
      el("div", { class: "row", style: "justify-content:center" }, el("a", { class: "btn", href: "#library", text: "Open Library" })));
  }
  function reviewView() {
    if (!CP.hasHighlightData()) return emptyState();
    const q = CP.dailyQueue();
    if (!q.pending.length) return doneState(q);
    ui.reviewing = true;
    const { src, h } = CP.findHighlight(q.pending[0]);
    const today = CP.todayStr(), prev = CP.getReview(h.id);
    const body = el("div", { class: "rv-card" });
    function drawBody(editing) {
      ui.editors = editing ? 1 : 0;
      const len = h.text.length, cur = CP.findHighlight(h.id).h;
      body.replaceChildren(
        el("div", { class: "rv-src" }, coverEl(src, "cover"), el("span", {}, el("b", { text: src.title }), src.author ? " · " + src.author : "", cur.location ? ` · ${cur.location}` : cur.page != null ? ` · p. ${cur.page}` : "")),
        el("p", { class: "rv-passage" + (len > 600 ? " xlong" : len > 280 ? " long" : ""), text: cur.text }),
        cur.note && el("div", { class: "note", text: cur.note }),
        cur.note && cur.noteOriginal && cur.noteOriginal !== cur.note && el("div", { class: "note-orig", text: "Typed on Kindle: " + cur.noteOriginal }),
        cur.tags.length > 0 && el("div", { class: "tags" }, cur.tags.map(t => el("span", { class: "tag", text: t }))),
        editing
          ? editor(src, cur, { onDone: r => { if (r.deleted) render(); else drawBody(false); } })
          : el("div", { class: "rv-tools" },
            el("button", { class: "btn small", type: "button", text: cur.note ? "Edit note & tags" : "Add note & tags", onclick: () => drawBody(true) }),
            starButton(src.id, h.id)));
    }
    drawBody(false);
    const act = (action, label) => () => {
      CP.reviewAction(h.id, action);
      window.scrollTo(0, 0);
      render();
      if (!CP.dailyQueue().pending.length) CP.sync();   // end of the session: send the batch
      toast(label, () => { CP.undoReview(h.id, prev); render(); });
    };
    const days = a => { const n = CP.nextReview(prev, a, today).interval; return `in ${plural(n, "day")}`; };
    const button = (cls, title, sub, action, label) => el("button", { class: "btn " + cls, type: "button", onclick: act(action, label) }, title, el("small", { text: sub }));
    return el("div", { class: "rv" },
      el("div", { class: "rv-progress", text: `${q.done + 1} of ${q.done + q.pending.length}` }),
      body,
      el("div", { class: "rv-actions" },
        button("primary", "Keep", days("keep"), "keep", `Kept ${days("keep")}`),
        button("", "Sooner", days("sooner"), "sooner", `Back ${days("sooner")}`),
        button("", "Less often", days("less"), "less", `Back ${days("less")}`),
        button("", "Discard", "never in review", "discard", "Discarded from review")));
  }

  // ---------- Library ----------
  function libraryView(route) {
    if (route.arg) return sourceView(route.arg);
    const list = CP.allSources().filter(s => s.highlights.length).sort((a, b) => (CP.lastHighlighted(a) < CP.lastHighlighted(b) ? 1 : -1));
    CP.fillCovers();
    const head = el("div", { class: "row", style: "justify-content:space-between; margin-bottom:14px" },
      el("h2", { class: "section", style: "margin:0", text: "Library" }),
      el("div", { class: "row" },
        window.CPSuggest && list.length > 0 && el("button", { class: "btn small" + (CPSuggest.hasPending(null) ? " primary" : ""), type: "button",
          text: CPSuggest.hasPending(null) ? "Review suggested tags" : "Suggest tags for all",
          onclick: () => { if (allBox.dataset.open === "suggest") { allBox.replaceChildren(); allBox.dataset.open = ""; render(); } else CPSuggest.panel(null, allBox, render); } }),
        el("a", { class: "btn small", href: "#import", text: "Import Kindle" }),
        el("button", { class: "btn small", type: "button", text: "Export", onclick: exportAll })));
    const allBox = el("div");
    if (!list.length) return el("div", {}, head, emptyState());
    return el("div", {}, head, allBox, el("div", { class: "grid" }, list.map(s =>
      el("a", { class: "book", href: `#library/${encodeURIComponent(s.id)}` },
        coverEl(s, "book-cover"),
        el("div", { class: "book-title", text: s.title }),
        el("div", { class: "book-sub", text: [s.author, plural(s.highlights.length, "highlight")].filter(Boolean).join(" · ") })))));
  }
  // Everything as one JSON file (books, cover links, highlights, notes, tags, review state). Downloaded to
  // this device only; nothing is sent anywhere. The API key and the GitHub token are not included.
  function exportAll() {
    const data = {
      exported: new Date().toISOString(), app: "Commonplace",
      sources: CP.allSources().filter(s => s.highlights.length).map(s => ({
        id: s.id, kind: s.kind, title: s.title, author: s.author, cover: s.cover ?? null, url: s.url ?? null,
        highlights: CP.sortedHighlights(s).map(h => ({ id: h.id, text: h.text, note: h.note, tags: h.tags, location: h.location, page: h.page, via: h.via, favourite: h.favourite, created: h.created, review: CP.getReview(h.id) })),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `commonplace-export-${CP.todayStr()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast("Export downloaded");
  }
  function sourceView(id) {
    const src = CP.getSource(id);
    if (!src) return el("div", {}, el("a", { class: "back", href: "#library", text: "← Library" }), el("p", { class: "hint", text: "That source isn't in your library yet." }));
    const picker = el("div");
    const head = el("div", { class: "src-head" }, coverEl(src, "cover big"),
      el("div", {}, el("h2", { text: src.title }),
        el("div", { class: "hint", style: "margin:0", text: [src.author, plural(src.highlights.length, "highlight")].filter(Boolean).join(" · ") }),
        el("div", { class: "row", style: "margin-top:10px" },
          src.kind === "book" && el("button", { class: "btn small", type: "button", text: "Change cover", onclick: () => coverPicker(src, picker) }),
          src.kind !== "thoughts" && el("button", { class: "btn small", type: "button", text: "Edit details", onclick: () => detailsEditor(src, picker) }),
          window.CPSuggest && src.highlights.length > 0 && el("button", { class: "btn small" + (CPSuggest.hasPending(src.id) ? " primary" : ""), type: "button",
            text: CPSuggest.hasPending(src.id) ? "Review suggested tags" : "Suggest tags",
            onclick: () => { if (picker.dataset.open === "suggest") { picker.replaceChildren(); picker.dataset.open = ""; render(); } else CPSuggest.panel(src, picker, render); } }),
          src.kind === "book" && el("button", { class: "btn small", type: "button",
            text: CP.pinnedSourceId() === src.id ? "Unpin" : "Set as now reading",
            onclick: () => {
              if (CP.pinnedSourceId() === src.id) { CP.unpinNowReading(); toast("Unpinned. Now reading follows your latest highlight."); }
              else { CP.pinNowReading(src.id); toast("Set as now reading"); }
              render();
            } }),
          el("a", { class: "btn small", href: `#add?src=${encodeURIComponent(src.id)}`, text: "Add highlight" }),
          src.url && el("a", { class: "btn small", href: src.url, rel: "noreferrer", target: "_blank", text: "Open article" }))));
    return el("div", {}, el("a", { class: "back", href: "#library", text: "← Library" }), head, picker,
      el("div", { class: "stack" }, CP.sortedHighlights(src).map(h => highlightCard(h.id))));
  }
  function detailsEditor(src, box) {
    if (box.firstChild) { box.dataset.open = ""; return box.replaceChildren(); }
    const title = el("input", { type: "text", value: src.title, "aria-label": "Title" });
    const author = el("input", { type: "text", value: src.author, "aria-label": "Author" });
    box.replaceChildren(el("div", { class: "panel" },
      el("label", { class: "lbl", style: "margin-top:0", text: "Title" }), title,
      el("label", { class: "lbl", text: "Author" }), author,
      el("div", { class: "row", style: "margin-top:12px" },
        el("button", { class: "btn primary small", type: "button", text: "Save", onclick: () => {
          if (!title.value.trim()) return toast("The title can't be empty.");
          CP.updateSource(src.id, { title: title.value.trim(), author: author.value.trim() });
          toast("Saved"); render();
        } }),
        el("button", { class: "btn small", type: "button", text: "Cancel", onclick: () => box.replaceChildren() }))));
    title.focus();
  }
  async function coverPicker(src, box) {
    if (box.firstChild) { box.dataset.open = ""; return box.replaceChildren(); }
    const url = el("input", { type: "url", placeholder: "Or paste an image link", "aria-label": "Cover image link" });
    const choose = value => { CP.setCover(src.id, value); toast(value ? "Cover changed" : "Cover removed"); render(); };
    const options = el("div", { class: "cover-pick" }, el("span", { class: "hint", text: "Looking for covers…" }));
    box.replaceChildren(el("div", { class: "panel" }, options,
      el("div", { class: "row", style: "margin-top:12px; flex-wrap:nowrap" }, url,
        el("button", { class: "btn small", type: "button", text: "Use link", onclick: () => { const v = url.value.trim(); if (/^https:\/\//i.test(v)) choose(v); else toast("Paste a link that starts with https://"); } })),
      el("div", { class: "row", style: "margin-top:10px" }, el("button", { class: "btn small", type: "button", text: "Remove cover", onclick: () => choose("") }))));
    const found = await CP.coverCandidates(src.title, src.author);
    options.replaceChildren(...(found.length
      ? found.map(u => el("button", { type: "button", "aria-label": "Use this cover", onclick: () => choose(u) }, el("img", { src: u, alt: "", referrerpolicy: "no-referrer" })))
      : [el("span", { class: "hint", text: "No other covers found." })]));
  }

  // ---------- Add ----------
  const DRAFT = "cp-draft-v1";
  const draftGet = () => { try { return JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (e) { return {}; } };
  const draftSet = d => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch (e) {} };

  // Choose where a highlight goes: recent sources first, type to search, or a new book or article.
  function sourcePicker(initial) {
    let chosen = initial; // { thoughts: true } | { id } | { fresh: "book"|"article" }
    let opened = !!(initial && initial.fresh) || false, query = "";
    const box = el("div");
    const fields = { title: "", author: "", url: "", page: "" };
    function label(c) { const s = c.id && CP.getSource(c.id); return c.thoughts ? "My thoughts (no source)" : s ? s.title : "New " + c.fresh; }
    function draw() {
      box.replaceChildren();
      if (chosen && !opened) {
        box.append(el("div", { class: "row" },
          el("span", { class: "chosen", text: label(chosen) }),
          el("button", { class: "btn small", type: "button", text: "Change", onclick: () => { opened = true; draw(); } })));
      } else {
        const search = el("input", { type: "search", placeholder: "Find a book or article…", value: query, "aria-label": "Find a source", autocomplete: "off" });
        const list = el("div", { class: "picker-list" });
        const pickWith = c => () => { chosen = c; opened = false; draw(); };
        const drawList = () => {
          const q = CP.norm(query);
          const recent = CP.allSources().filter(s => s.kind !== "thoughts").sort((a, b) => (CP.lastHighlighted(a) < CP.lastHighlighted(b) ? 1 : -1))
            .filter(s => !q || CP.norm(s.title + " " + s.author).includes(q)).slice(0, q ? 8 : 5);
          list.replaceChildren(
            el("button", { type: "button", onclick: pickWith({ thoughts: true }), text: "My thoughts (no source)" }),
            ...recent.map(s => el("button", { type: "button", onclick: pickWith({ id: s.id }) }, el("span", { text: s.title }), el("small", { text: s.author }))),
            el("button", { type: "button", onclick: pickWith({ fresh: "book" }), text: "＋ New book" }),
            el("button", { type: "button", onclick: pickWith({ fresh: "article" }), text: "＋ New article" }));
        };
        search.addEventListener("input", () => { query = search.value; drawList(); });
        drawList();
        box.append(search, list);
      }
      if (chosen && !opened && !chosen.thoughts) {
        const keep = (k, input) => { input.addEventListener("input", () => { fields[k] = input.value; }); return input; };
        if (chosen.fresh) box.append(
          el("label", { class: "lbl", text: "Title" }), keep("title", el("input", { type: "text", value: fields.title, "aria-label": "Title" })),
          el("label", { class: "lbl", text: chosen.fresh === "book" ? "Author" : "Author or outlet" }), keep("author", el("input", { type: "text", value: fields.author, "aria-label": "Author" })),
          chosen.fresh === "article" && [el("label", { class: "lbl", text: "Link (optional)" }), keep("url", el("input", { type: "url", value: fields.url, "aria-label": "Link" }))]);
        box.append(el("label", { class: "lbl", text: "Page (optional)" }), keep("page", el("input", { type: "text", inputmode: "numeric", value: fields.page, "aria-label": "Page" })));
      }
    }
    draw();
    return {
      node: box, setPage: p => { fields.page = p; draw(); },
      get() {
        if (!chosen || chosen.thoughts) return { src: CP.ensureSource({ kind: "thoughts", title: "My thoughts" }) };
        const page = /^\d+$/.test(fields.page.trim()) ? Number(fields.page) : (fields.page.trim() || null);
        if (chosen.id) return { src: CP.getSource(chosen.id), page };
        if (!fields.title.trim()) return { error: "Give the new source a title." };
        return { src: CP.ensureSource({ kind: chosen.fresh, title: fields.title.trim(), author: fields.author.trim(), url: fields.url.trim() || null, cover: chosen.fresh === "book" ? null : "" }), page };
      },
    };
  }
  function addView(route) {
    const p = route.params, hasParams = [...p.keys()].length > 0;
    // Shortcuts open …#add?kind=thought&text=… ; take it and clear the address so the text isn't left in history.
    if (hasParams) history.replaceState(null, "", location.pathname + location.search + "#add");
    const kind = p.get("kind");
    const draft = draftGet();
    let initial = { thoughts: true };
    if (p.get("src") && CP.getSource(p.get("src"))) initial = { id: p.get("src") };
    else if (kind === "book" || kind === "article") initial = { fresh: kind };   // opens the picker: the person says which book
    const picker = sourcePicker(initial);
    if (p.get("page")) picker.setPage(p.get("page"));
    const text = el("textarea", { class: "add-text", rows: "6", placeholder: "A passage or a thought…", "aria-label": "Passage or thought", value: p.get("text") || draft.text || "" });
    const note = el("textarea", { class: "note-in", rows: "3", value: p.get("note") || draft.note || "", placeholder: "My note (optional)", "aria-label": "My note" });
    const tags = tagInput([]);
    const save = () => {
      const body = text.value.trim();
      if (!body) return toast("Write or paste something first.");
      const target = picker.get();
      if (target.error) return toast(target.error);
      const via = p.get("via") || (kind === "thought" ? "dictation" : kind === "book" || kind === "article" ? "photo" : "manual");
      CP.addHighlight(target.src, { text: body, note: note.value.trim(), tags: tags.get(), page: target.page, via: target.src.kind === "thoughts" && via === "photo" ? "manual" : via });
      draftSet({});
      toast(`Saved to ${target.src.title}`);
      render();
    };
    const keepDraft = () => draftSet({ text: text.value, note: note.value });
    text.addEventListener("input", keepDraft); note.addEventListener("input", keepDraft);
    ui.editors = 1;   // typing here must never be redrawn by a background sync
    return el("div", {},
      el("label", { class: "lbl", text: "Passage or thought" }), text,
      el("p", { class: "hint", text: "Tip: tap the microphone on your keyboard to dictate." }),
      el("label", { class: "lbl", text: "Where is it from?" }), picker.node,
      el("label", { class: "lbl", text: "My note" }), note,
      el("label", { class: "lbl", text: "Tags" }), tags.node,
      el("div", { class: "row", style: "margin-top:18px" },
        el("button", { class: "btn primary", type: "button", text: "Save", onclick: save }),
        el("a", { class: "btn", href: "#import", text: "Import Kindle clippings" })));
  }

  // ---------- Search ----------
  function searchView() {
    const s = ui.search;
    const results = el("div"), filters = el("div", { class: "filters" });
    const input = el("input", { type: "search", placeholder: "Search highlights, notes, books, tags", value: s.q, "aria-label": "Search", autocomplete: "off" });
    function drawFilters() {
      const tags = [...CP.allTags()].sort((a, b) => b[1] - a[1]).slice(0, 40);
      filters.replaceChildren(...tags.map(([t, n]) => el("button", { type: "button", class: "tag", "aria-pressed": String(s.tags.has(t)),
        onclick: () => { s.tags.has(t) ? s.tags.delete(t) : s.tags.add(t); s.shown = 40; drawFilters(); drawResults(); } }, t, el("span", { class: "count", text: n }))));
    }
    function drawResults() {
      const hits = CP.search(s.q, [...s.tags]);
      const terms = CP.norm(s.q).split(" ").filter(Boolean);
      results.replaceChildren(
        el("p", { class: "count-line", text: s.q || s.tags.size ? plural(hits.length, "result") : plural(hits.length, "highlight") }),
        el("div", { class: "stack" }, hits.slice(0, s.shown).map(({ h }) => highlightCard(h.id, { showSource: true, terms }))),
        hits.length > s.shown && el("div", { class: "row", style: "justify-content:center; margin-top:14px" },
          el("button", { class: "btn", type: "button", text: "Show more", onclick: () => { s.shown += 40; drawResults(); } })));
    }
    let t = null;
    input.addEventListener("input", () => { s.q = input.value; s.shown = 40; clearTimeout(t); t = setTimeout(drawResults, 100); });
    drawFilters(); drawResults();
    return el("div", {}, input, filters, results);
  }

  // ---------- Import (Kindle My Clippings.txt) ----------
  function importView() {
    const out = el("div");
    const pick = el("input", { type: "file", accept: ".txt,text/plain", id: "clip-file", "aria-label": "My Clippings.txt" });
    pick.addEventListener("change", async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      out.replaceChildren(el("p", { class: "hint", text: "Reading…" }));
      let parsed;
      try { parsed = CPKindle.parseClippings(await file.text()); } catch (e) { parsed = null; }
      if (!parsed || !parsed.entries.length) return out.replaceChildren(el("div", { class: "panel" }, el("p", { text: "That doesn't look like a Kindle My Clippings.txt file. Nothing was changed." })));
      const plan = CPKindle.planImport(CPKindle.buildBooks(parsed.entries, CP), CP), t = plan.totals;
      const changed = plan.books.filter(b => b.add.length || b.edit.length || b.noteFill.length);
      const extras = [t.edited && `${plural(t.edited, "edited passage")} updated`, t.notes && `${plural(t.notes, "note")} attached`,
        t.removed && `${t.removed} you deleted stay deleted`, parsed.skipped.bookmarks && `${plural(parsed.skipped.bookmarks, "bookmark")} skipped`].filter(Boolean);
      const nothing = !t.new && !t.edited && !changed.some(b => b.noteFill.length);
      // Notes typed on the Kindle's keyboard: offer to have Claude fix the spelling (the original is kept).
      const notes = CPKindle.kindleNotes(plan, CP);
      const canTidy = notes.length > 0 && window.CPSuggest && CPSuggest.hasKey();
      const tidy = canTidy && el("input", { type: "checkbox", id: "tidy-notes", checked: true });
      out.replaceChildren(el("div", { class: "panel" },
        el("p", { class: "big-num", text: `${plural(t.highlights, "highlight")} in ${plural(t.books, "book")}, ${t.new} new` }),
        extras.length > 0 && el("p", { class: "hint", text: extras.join(" · ") }),
        changed.length > 0 && el("ul", { class: "imp-list" }, changed.slice(0, 14).map(b => el("li", {}, el("span", { text: b.book.title }), el("span", { text: `+${b.add.length}` }))),
          changed.length > 14 && el("li", {}, el("span", { text: `and ${changed.length - 14} more books` }), el("span"))),
        canTidy && el("label", { class: "row", for: "tidy-notes", style: "gap:8px; font-size:15px; margin-top:14px; flex-wrap:nowrap; align-items:flex-start" }, tidy,
          `Tidy ${plural(notes.length, "note")} typed on the Kindle with Claude: fixes spelling and shorthand, keeps your words. The original is kept underneath.`),
        notes.length > 0 && !canTidy && window.CPSuggest && el("p", { class: "hint", style: "margin-top:12px", text: "To have Claude tidy notes typed on the Kindle, add your Anthropic key on this device first (open a book → Suggest tags)." }),
        el("div", { class: "row", style: "margin-top:16px" },
          el("button", { class: "btn primary", type: "button", disabled: nothing, text: nothing ? "Nothing new to save" : t.new ? `Save ${plural(t.new, "new highlight")}` : "Save updates", onclick: async e => {
            if (tidy && tidy.checked) {
              const b = e.currentTarget; b.disabled = true; b.textContent = "Tidying notes…";
              try {
                const clean = await CPSuggest.tidyNotes(notes);
                clean.forEach((v, i) => { if (v && v !== notes[i].note) notes[i].set(v); });
              } catch (err) { toast(err.message + " Notes saved as typed."); }
            }
            CPKindle.applyImport(plan, CP);
            CP.fillCovers();
            out.replaceChildren(el("div", { class: "panel" }, el("p", { class: "big-num", text: "Saved" }), el("p", { class: "hint", text: "Your notes and tags on existing highlights were left alone." }),
              el("a", { class: "btn primary", href: "#library", text: "Open Library" })));
          } }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => { pick.value = ""; out.replaceChildren(); } }))));
    });
    return el("div", {},
      el("a", { class: "back", href: "#library", text: "← Library" }),
      el("h2", { class: "section", text: "Import Kindle clippings" }),
      el("p", { class: "hint", text: "Connect your Kindle to your Mac, open its documents folder, and choose My Clippings.txt. It lists everything you've ever highlighted, so it's safe to import again whenever you like: only new highlights are added, and your own notes and tags are never changed." }),
      el("div", { class: "panel" }, pick), out);
  }

  render();
  CP.init();
})();
