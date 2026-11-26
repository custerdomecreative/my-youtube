// Commonplace: suggested tags from Claude (Anthropic API), applied only when Aaron approves them.
//
// Self-contained: delete this file and its <script> tag to switch the feature off.
// The API key is kept in this device's storage only: never synced, committed or published.
// Calls go straight from the browser to api.anthropic.com.
(() => {
  "use strict";
  const KEY = "cp-anthropic-key-v1", MODEL_KEY = "cp-suggest-model-v1", PENDING = "cp-suggest-pending-v1";
  // USD per million tokens (Nov 2026), only for the cost estimate shown after a run.
  const MODELS = {
    "claude-haiku-5-5": { label: "Haiku (cheapest)", inM: 0.10, outM: 0.50 },
    "claude-sonnet-5-5": { label: "Sonnet (sharper, about 20x the cost)", inM: 2, outM: 10 },
  };
  // The themes Claude may suggest. Aaron's own judgement tags are never suggested.
  const THEMES = [
    ["power", "how power is gained, used, kept and lost"],
    ["leadership", "decisions, character, how leaders handle people and crises"],
    ["ambition", "drive, motive, what people will trade to get ahead"],
    ["institutions", "bureaucracies, parties, courts; how systems shape people"],
    ["persuasion", "rhetoric, negotiation, winning people over"],
    ["corruption", "abuse of power, money and influence"],
    ["war", "military conflict and its costs"],
    ["geopolitics", "states, alliances, strategy, rivalry between powers"],
    ["middle-east", "anything about the Middle East"],
    ["ai", "anything directly about artificial intelligence"],
    ["technology", "earlier technologies changing society (railways, electricity, nuclear, printing, etc.)"],
    ["ai-parallel", "history that clearly rhymes with something happening in AI now: a disruptive technology, concentration of power, an arms race, regulation catching up, work being displaced"],
    ["human-nature", "moral, psychological or 'this is how people are' passages, often from fiction"],
    // Living and working well: most of the library (habits, focus, psychology, careers, running).
    ["habits", "routines, consistency, discipline, small actions repeated"],
    ["focus", "attention, deep work, distraction, priorities, saying no"],
    ["mastery", "skill, practice, growth mindset, doing work well"],
    ["career", "choosing and building a working life"],
    ["decisions", "judgement, process over outcomes, trade-offs, when to quit"],
    ["data", "statistics, measurement, evidence, numbers"],
    ["adversity", "setbacks, failure, hardship and how to respond to them"],
    ["emotions", "anxiety, anger, happiness, handling feelings"],
    ["mindfulness", "meditation, presence, stillness"],
    ["stoicism", "Stoic ideas and the Stoic teachers"],
    ["relationships", "other people, family, recognition, empathy"],
    ["meaning", "purpose, identity, what a life is for"],
    ["running", "running itself"],
    ["writing", "the practice of writing (not prose Aaron admires: he tags that himself)"],
  ];
  const PERSONAL = new Set(["quotable", "writing-craft", "essay-idea"]);
  const BATCH = 40, MAX_CHARS = 1500, CONCURRENCY = 3;

  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const pending = () => { try { return JSON.parse(get(PENDING)) || null; } catch (e) { return null; } };
  // One set of waiting suggestions at a time, for one book ("src_…") or for every book ("all").
  const scopeOf = p => (p ? p.scope || p.sourceId : null);
  const pendingFor = id => { const p = pending(); return p && scopeOf(p) === id ? p : null; };
  const hasPending = sourceId => !!pendingFor(sourceId || "all");
  const model = () => (MODELS[get(MODEL_KEY)] ? get(MODEL_KEY) : "claude-haiku-5-5");
  const money = usd => (usd < 0.01 ? "under $0.01" : "$" + usd.toFixed(2));
  const costOf = (m, inTok, outTok) => (inTok * MODELS[m].inM + outTok * MODELS[m].outM) / 1e6;

  // Themes, plus any tags Aaron already uses (they join the list automatically).
  function vocabulary() {
    const known = new Set(THEMES.map(t => t[0]));
    const extra = [...CP.allTags().keys()].filter(t => !known.has(t) && !PERSONAL.has(t)).sort();
    return [...THEMES, ...extra.map(t => [t, "one of Aaron's own tags"])];
  }

  const SYSTEM = vocab => `You tag highlights in Aaron's commonplace book. He reads history, politics and fiction, and a lot about living and working well (habits, focus, psychology, careers, running). He writes essays that use history, power and conflict as a lens on AI. Tags help him gather passages by theme.

Give each passage the tags that clearly fit, from this list only:
${vocab.map(([t, d]) => `- ${t}: ${d}`).join("\n")}

Rules:
- Usually 1 or 2 tags, never more than 3. An empty list is fine when nothing clearly fits.
- Tag what the passage is about, not the book's general subject.
- Use ai-parallel only when the historical dynamic plainly maps onto something in AI today.
- Aaron's note on a passage, if present, shows why he saved it; weigh it.
Call the record_tags tool once with every passage's index. If you can't use the tool, reply with only the JSON {"passages": [{"i": 0, "tags": ["..."]}]} and nothing else.`;

  async function callClaude(key, m, src, batch, vocab) {
    const body = {
      model: m, max_tokens: 4096, system: SYSTEM(vocab),
      tools: [{
        name: "record_tags", description: "Record the suggested tags for each passage.",
        input_schema: { type: "object", required: ["passages"], properties: { passages: { type: "array", items: {
          type: "object", required: ["i", "tags"],
          properties: { i: { type: "integer" }, tags: { type: "array", maxItems: 3, items: { type: "string", enum: vocab.map(v => v[0]) } } },
        } } } },
      }],
      messages: [{ role: "user", content: `Book: ${src.title}${src.author ? " by " + src.author : ""}\n\nPassages (JSON):\n` +
        JSON.stringify(batch.map((h, i) => ({ i, text: h.text.slice(0, MAX_CHARS), ...(h.note ? { note: h.note.slice(0, 600) } : {}) }))) }],
    };
    return readTool(await request(key, body), "record_tags", "passages", batch, vocab);
  }

  // One Messages API call, with a couple of retries for busy/overloaded responses.
  async function request(key, body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        });
      } catch (e) { throw new Error("Couldn't reach Anthropic. Check your connection and try again."); }
      if (res.ok) return res.json();
      const msg = await res.json().then(j => (j.error && j.error.message) || "", () => "");
      if (res.status === 401 || res.status === 403) { const e = new Error("Anthropic didn't accept that API key."); e.badKey = true; throw e; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 6000 * (attempt + 1))); continue; }
      throw new Error(msg ? `Anthropic said: ${msg}` : `Anthropic returned an error (${res.status}).`);
    }
  }
  // The tool call's list (or the same JSON written as text, if the model answered that way).
  function toolList(data, tool, field) {
    const call = (data.content || []).find(c => c.type === "tool_use" && c.name === tool);
    let list = call && call.input && call.input[field];
    if (!Array.isArray(list)) {
      const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
      try { list = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))[field]; } catch (e) { list = null; }
    }
    if (!Array.isArray(list)) throw new Error("Claude's reply couldn't be read. Try again, or try the other model.");
    return list;
  }
  function readTool(data, tool, field, batch, vocab) {
    const allowed = new Set(vocab.map(v => v[0]));
    const out = {};
    for (const p of toolList(data, tool, field)) {
      const h = batch[p.i];
      if (!h || !Array.isArray(p.tags)) continue;
      const tags = [...new Set(p.tags.map(CP.normTag))].filter(t => allowed.has(t) && !h.tags.includes(t)).slice(0, 3);
      if (tags.length) out[h.id] = tags;
    }
    return { out, usage: data.usage || {} };
  }

  // Notes typed on the Kindle's keyboard: fix spelling and shorthand, keep Aaron's words. Returns tidied texts in order.
  const TIDY = `These are quick notes Aaron typed on a Kindle's on-screen keyboard while reading, so they're full of typos. For each note, fix spelling, typos, spacing, capitalisation and punctuation, and expand shorthand only when it's unambiguous (w → with, bc → because). Keep his words, meaning, tone and length: don't add ideas, don't explain, don't make it formal and don't finish his sentences. Use the book and the highlighted passage only to work out names and words he meant. Leave anything you can't work out as he typed it. Call record_notes once with every note's index.`;
  async function tidyNotes(notes) {
    const key = get(KEY);
    if (!key) throw new Error("No Anthropic key on this device.");
    const out = notes.map(n => n.note);
    for (let i = 0; i < notes.length; i += 40) {
      const batch = notes.slice(i, i + 40);
      const data = await request(key, {
        model: model(), max_tokens: 4096, system: TIDY,
        tools: [{ name: "record_notes", description: "Record the tidied notes.", input_schema: { type: "object", required: ["notes"], properties: { notes: { type: "array", items: {
          type: "object", required: ["i", "text"], properties: { i: { type: "integer" }, text: { type: "string" } } } } } } }],
        messages: [{ role: "user", content: "Notes (JSON):\n" + JSON.stringify(batch.map((n, j) => ({ i: j, book: n.book, passage: (n.passage || "").slice(0, 600), note: n.note }))) }],
      });
      for (const r of toolList(data, "record_notes", "notes")) if (batch[r.i] && typeof r.text === "string" && r.text.trim()) out[i + r.i] = r.text.trim();
    }
    return out;
  }

  // The panel: key entry, options, a run, then review and apply. `scope` is one source, or null for every book.
  function panel(scope, box, onApplied) {
    const { el, toast, hold } = window.CPUI;
    const id = scope ? scope.id : "all";
    const release = hold();   // keep background syncs from redrawing the page under the panel
    let stop = false;
    const close = () => { stop = true; release(); box.replaceChildren(); box.dataset.open = ""; };
    box.dataset.open = "suggest";
    const wrap = el("div", { class: "panel" });
    box.replaceChildren(wrap);
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const heading = text => el("p", { class: "big-num", style: "font-size:20px", text });
    const btn = (text, onclick, primary) => el("button", { class: "btn small" + (primary ? " primary" : ""), type: "button", text, onclick });
    const sources = () => (scope ? [CP.getSource(scope.id)].filter(Boolean) : CP.allSources().filter(s => s.highlights.length));
    const targets = (onlyNew, skip = new Set()) => sources().flatMap(src => src.highlights
      .filter(h => (!onlyNew || !h.tags.length) && !skip.has(h.id)).map(h => ({ src, h })));
    const discard = () => { if (confirm("Discard these suggestions?")) { set(PENDING, null); close(); onApplied(); } };

    function keyView(message) {
      const input = el("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off", "aria-label": "Anthropic API key" });
      wrap.replaceChildren(heading("Suggested tags"),
        message && el("p", { class: "warn", style: "margin:0 0 8px", text: message }),
        el("p", { class: "hint", text: "Paste your Anthropic API key. It's kept on this device only, never synced or published, and only sent to Anthropic. Enter it once on each device (and once in Safari if you use Shortcuts)." }),
        input,
        el("div", { class: "row", style: "margin-top:12px" },
          btn("Save key", () => {
            const v = input.value.trim();
            if (!/^sk-ant-/.test(v)) return toast("That doesn't look like an Anthropic key (they start sk-ant-).");
            set(KEY, v); setupView();
          }, true),
          btn("Cancel", close)));
      input.focus();
    }

    function setupView(problem) {
      if (!get(KEY)) return keyView();
      const p = pending();
      if (p && scopeOf(p) === id) {
        if (p.done) return reviewView();
        // A run that was interrupted (phone locked, page reloaded): carry on or look at what came back.
        const left = targets(p.onlyNew !== false, new Set(p.seen || [])).length;
        return wrap.replaceChildren(heading("Suggesting tags was interrupted"),
          typeof problem === "string" && el("p", { class: "warn", style: "margin:0 0 8px", text: problem }),
          el("p", { class: "hint", text: `${plural((p.seen || []).length, "passage")} checked, ${left} still to go.` }),
          el("div", { class: "row" },
            left > 0 && btn("Continue", () => run(targets(p.onlyNew !== false, new Set(p.seen || [])), p.model, p), true),
            Object.keys(p.results).length > 0 && btn("Review what came back", () => { p.done = true; set(PENDING, JSON.stringify(p)); reviewView(); }),
            btn("Discard", discard)));
      }
      if (p) {
        const other = scopeOf(p) === "all" ? "all books" : ((CP.getSource(scopeOf(p)) || {}).title || "another book");
        return wrap.replaceChildren(heading("Suggestions are waiting"),
          el("p", { class: "hint", text: `You have suggested tags for ${other} that haven't been applied yet. Review or discard those first.` }),
          el("div", { class: "row" },
            el("a", { class: "btn small primary", href: scopeOf(p) === "all" ? "#library" : `#library/${encodeURIComponent(scopeOf(p))}`, text: "Go to them", onclick: close }),
            btn("Discard them", () => { if (confirm("Discard those suggestions?")) { set(PENDING, null); setupView(); } }),
            btn("Cancel", close)));
      }
      const onlyNew = el("input", { type: "checkbox", id: "sg-only", checked: true });
      const pick = el("select", { class: "field", "aria-label": "Model" }, Object.entries(MODELS).map(([mid, m]) => el("option", { value: mid, text: m.label })));
      pick.value = model();
      const info = el("p", { class: "hint" });
      const describe = () => {
        const list = targets(onlyNew.checked), books = new Set(list.map(x => x.src.id)).size;
        const chars = list.reduce((n, { h }) => n + Math.min(h.text.length, MAX_CHARS) + (h.note || "").length, 0);
        const batches = [...new Set(list.map(x => x.src.id))].reduce((n, sid) => n + Math.ceil(list.filter(x => x.src.id === sid).length / BATCH), 0);
        const est = costOf(pick.value, chars / 3.5 + batches * 1400, list.length * 30);
        const mins = Math.max(1, Math.round(batches / CONCURRENCY * 15 / 60));
        info.textContent = !list.length ? "Every passage already has tags. Untick the box to suggest more."
          : `${plural(list.length, "passage")}${scope ? "" : ` in ${plural(books, "book")}`} to tag. Estimated cost: ${money(est)}.` + (batches > 3 ? ` Takes about ${plural(mins, "minute")}: keep this page open.` : "");
      };
      onlyNew.addEventListener("change", describe);
      pick.addEventListener("change", () => { set(MODEL_KEY, pick.value); describe(); });
      describe();
      wrap.replaceChildren(heading(scope ? "Suggested tags" : "Suggested tags for all books"),
        el("p", { class: "hint", text: `Claude reads ${scope ? "this book's" : "every book's"} passages and suggests themes from your tag list. Nothing changes until you approve it.` }),
        el("label", { class: "row", for: "sg-only", style: "gap:8px; font-size:15px" }, onlyNew, "Only passages without tags"),
        el("label", { class: "lbl", text: "Model" }), pick, info,
        el("div", { class: "row", style: "margin-top:6px" },
          btn("Suggest tags", () => { const list = targets(onlyNew.checked); if (list.length) run(list, pick.value, null, onlyNew.checked); }, true),
          btn("Cancel", close),
          btn("Forget API key", () => { if (confirm("Remove the API key from this device?")) { set(KEY, null); keyView(); } })));
    }

    async function run(list, m, resume, onlyNew = true) {
      const vocab = vocabulary(), key = get(KEY);
      const state = resume || { scope: id, model: m, onlyNew, results: {}, seen: [], inTok: 0, outTok: 0, done: false, at: new Date().toISOString() };
      const save = () => set(PENDING, JSON.stringify(state));   // paid-for results survive a reload
      save();
      // Batches never mix books: the book's title goes in each request.
      const batches = [];
      for (const sid of [...new Set(list.map(x => x.src.id))]) {
        const mine = list.filter(x => x.src.id === sid);
        for (let i = 0; i < mine.length; i += BATCH) batches.push({ src: mine[0].src, items: mine.slice(i, i + BATCH).map(x => x.h) });
      }
      const total = list.length;
      let checked = 0, next = 0, failure = null;
      const progress = el("p", { class: "hint" });
      const paint = () => { progress.textContent = stop && !failure ? "Stopping after the current batches…" : `${checked} of ${total} passages checked…`; };
      wrap.replaceChildren(heading("Suggesting tags…"), progress,
        el("p", { class: "hint", text: "Keep this page open. If it gets interrupted, you can carry on from where it stopped." }),
        btn("Stop", () => { stop = true; paint(); }));
      paint();
      const worker = async () => {
        while (!stop && next < batches.length) {
          const b = batches[next++];
          try {
            const { out, usage } = await callClaude(key, m, b.src, b.items, vocab);
            Object.assign(state.results, out);
            state.seen.push(...b.items.map(h => h.id));
            state.inTok += usage.input_tokens || 0; state.outTok += usage.output_tokens || 0;
            checked += b.items.length; save(); paint();
          } catch (e) { failure = failure || e; stop = true; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
      if (failure && failure.badKey) { set(KEY, null); return keyView(failure.message + " Paste it again (or a new one). What came back so far is kept."); }
      // Any failure (network, page closing, an API error) leaves the run resumable: it isn't marked done.
      if (failure) { if (box.isConnected) setupView(failure.message); return; }
      if (!box.isConnected) return;
      state.done = true; save();
      if (!Object.keys(state.results).length) {
        set(PENDING, null);
        wrap.replaceChildren(el("p", { class: "hint", text: `No tags suggested. Cost ${money(costOf(m, state.inTok, state.outTok))}.` }), btn("Close", close));
        return;
      }
      reviewView(checked < total ? total - checked : 0);
    }

    function reviewView(unchecked = 0) {
      const p = pendingFor(id);
      if (!p) return setupView();
      const chosen = {};   // hid -> Set of ticked tags
      const items = Object.entries(p.results).map(([hid, tags]) => ({ hid, tags, f: CP.findHighlight(hid) }))
        .filter(x => x.f && (!scope || x.f.src.id === scope.id));
      for (const { hid, tags } of items) chosen[hid] = new Set(tags);
      const cost = costOf(p.model in MODELS ? p.model : "claude-haiku-5-5", p.inTok, p.outTok);
      const card = ({ hid, tags, f }) => {
        const passage = el("p", { class: "passage clamp", text: f.h.text, onclick: () => passage.classList.toggle("clamp") });
        return el("div", { class: "hl" }, passage,
          f.h.note && el("div", { class: "note", text: f.h.note }),
          el("div", { class: "tags" },
            f.h.tags.map(t => el("span", { class: "tag", text: t })),
            tags.map(t => {
              const b = el("button", { type: "button", class: "tag", "aria-pressed": String(chosen[hid].has(t)), text: "+ " + t });
              b.addEventListener("click", () => { const s = chosen[hid]; s.has(t) ? s.delete(t) : s.add(t); b.setAttribute("aria-pressed", String(s.has(t))); });
              return b;
            })));
      };
      const apply = () => {
        const bySource = {};
        for (const { hid, f } of items) (bySource[f.src.id] = bySource[f.src.id] || {})[hid] = [...chosen[hid]];
        let n = 0;
        for (const [sid, map] of Object.entries(bySource)) n += CP.bulkTag(sid, map);
        set(PENDING, null); close();
        toast(n ? `Tagged ${plural(n, "passage")}` : "No tags applied");
        onApplied();
      };
      const actions = () => el("div", { class: "row", style: "margin:12px 0" },
        btn(scope ? "Apply ticked tags" : "Apply all ticked tags", apply, true), btn("Discard", discard));
      // All books: one collapsed section per book, drawn when opened (there can be a thousand cards).
      const groups = [];
      for (const it of items) { let g = groups.find(x => x.src.id === it.f.src.id); if (!g) groups.push(g = { src: it.f.src, items: [] }); g.items.push(it); }
      const body = scope ? el("div", { class: "stack" }, items.map(card))
        : el("div", { class: "stack" }, groups.map(g => {
          const inner = el("div", { class: "stack", style: "margin-top:10px" });
          const d = el("details", { class: "sg-book" }, el("summary", { text: `${g.src.title} · ${plural(g.items.length, "passage")}` }), inner);
          d.addEventListener("toggle", () => { if (d.open && !inner.firstChild) inner.append(...g.items.map(card)); });
          return d;
        }));
      wrap.replaceChildren(
        heading(`Suggestions for ${plural(items.length, "passage")}` + (scope ? "" : ` in ${plural(groups.length, "book")}`)),
        el("p", { class: "hint", text: (scope ? "Tap a suggested tag to untick it. Tap a passage to see all of it. " : "Open a book to check its suggestions and untick any you don't want, or apply them all as they are. ")
          + (cost < 0.01 ? "This run cost under $0.01." : `This run cost about ${money(cost)}.`)
          + (unchecked ? ` ${plural(unchecked, "passage")} weren't checked; run it again later to cover them.` : "") }),
        actions(), body, actions());
    }

    setupView();
  }

  window.CPSuggest = { panel, hasPending, tidyNotes, hasKey: () => !!get(KEY) };
})();
