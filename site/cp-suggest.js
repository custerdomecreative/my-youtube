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
  ];
  const PERSONAL = new Set(["quotable", "writing-craft", "essay-idea"]);
  const BATCH = 40, MAX_CHARS = 1500;

  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const pending = () => { try { return JSON.parse(get(PENDING)) || null; } catch (e) { return null; } };
  const hasPending = sourceId => { const p = pending(); return !!(p && p.sourceId === sourceId && Object.keys(p.results).length); };
  const model = () => (MODELS[get(MODEL_KEY)] ? get(MODEL_KEY) : "claude-haiku-5-5");
  const money = usd => (usd < 0.01 ? "under $0.01" : "$" + usd.toFixed(2));
  const costOf = (m, inTok, outTok) => (inTok * MODELS[m].inM + outTok * MODELS[m].outM) / 1e6;

  // Themes, plus any tags Aaron already uses (they join the list automatically).
  function vocabulary() {
    const known = new Set(THEMES.map(t => t[0]));
    const extra = [...CP.allTags().keys()].filter(t => !known.has(t) && !PERSONAL.has(t)).sort();
    return [...THEMES, ...extra.map(t => [t, "one of Aaron's own tags"])];
  }

  const SYSTEM = vocab => `You tag highlights in Aaron's commonplace book. He reads history, politics and fiction, and writes essays that use history, power and conflict as a lens on AI. Tags help him gather passages by theme when he writes.

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
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        });
      } catch (e) { throw new Error("Couldn't reach Anthropic. Check your connection and try again."); }
      if (res.ok) {
        const data = await res.json();
        const call = (data.content || []).find(c => c.type === "tool_use" && c.name === "record_tags");
        let passages = call && call.input && call.input.passages;
        if (!Array.isArray(passages)) {   // no tool call: look for the JSON in the text
          const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
          const a = text.indexOf("{"), b = text.lastIndexOf("}");
          try { passages = JSON.parse(text.slice(a, b + 1)).passages; } catch (e) { passages = null; }
        }
        if (!Array.isArray(passages)) throw new Error("Claude's reply couldn't be read. Try again, or try the other model.");
        const allowed = new Set(vocab.map(v => v[0]));
        const out = {};
        for (const p of passages) {
          const h = batch[p.i];
          if (!h || !Array.isArray(p.tags)) continue;
          const tags = [...new Set(p.tags.map(CP.normTag))].filter(t => allowed.has(t) && !h.tags.includes(t)).slice(0, 3);
          if (tags.length) out[h.id] = tags;
        }
        return { out, usage: data.usage || {} };
      }
      const msg = await res.json().then(j => (j.error && j.error.message) || "", () => "");
      if (res.status === 401 || res.status === 403) { const e = new Error("Anthropic didn't accept that API key."); e.badKey = true; throw e; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 6000 * (attempt + 1))); continue; }
      throw new Error(msg ? `Anthropic said: ${msg}` : `Anthropic returned an error (${res.status}).`);
    }
  }

  // The panel on a book's page: key entry, then options, then a run, then review and apply.
  function panel(src, box, onApplied) {
    const { el, toast, hold } = window.CPUI;
    const release = hold();   // keep background syncs from redrawing the page under the panel
    let stop = false;
    const close = () => { stop = true; release(); box.replaceChildren(); box.dataset.open = ""; };
    box.dataset.open = "suggest";
    const wrap = el("div", { class: "panel" });
    box.replaceChildren(wrap);

    function keyView(message) {
      const input = el("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off", "aria-label": "Anthropic API key" });
      wrap.replaceChildren(
        el("p", { class: "big-num", style: "font-size:20px", text: "Suggested tags" }),
        message && el("p", { class: "warn", style: "margin:0 0 8px", text: message }),
        el("p", { class: "hint", text: "Paste your Anthropic API key. It's kept on this device only, never synced or published, and only sent to Anthropic. Enter it once on each device (and once in Safari if you use Shortcuts)." }),
        input,
        el("div", { class: "row", style: "margin-top:12px" },
          el("button", { class: "btn primary small", type: "button", text: "Save key", onclick: () => {
            const v = input.value.trim();
            if (!/^sk-ant-/.test(v)) return toast("That doesn't look like an Anthropic key (they start sk-ant-).");
            set(KEY, v); setupView();
          } }),
          el("button", { class: "btn small", type: "button", text: "Cancel", onclick: close })));
      input.focus();
    }

    function setupView() {
      if (!get(KEY)) return keyView();
      if (hasPending(src.id)) return reviewView();
      const onlyNew = el("input", { type: "checkbox", id: "sg-only", checked: true });
      const pick = el("select", { class: "field", "aria-label": "Model" }, Object.entries(MODELS).map(([id, m]) => el("option", { value: id, text: m.label })));
      pick.value = model();
      const info = el("p", { class: "hint" });
      const targets = () => src.highlights.filter(h => !onlyNew.checked || !h.tags.length);
      const describe = () => {
        const list = targets(), chars = list.reduce((n, h) => n + Math.min(h.text.length, MAX_CHARS) + (h.note || "").length, 0);
        const batches = Math.ceil(list.length / BATCH);
        const est = costOf(pick.value, chars / 3.5 + batches * 900, list.length * 30);
        info.textContent = list.length ? `${list.length} passage${list.length === 1 ? "" : "s"} to tag. Estimated cost: ${money(est)}.` : "Every passage here already has tags. Untick the box to suggest more.";
      };
      onlyNew.addEventListener("change", describe);
      pick.addEventListener("change", () => { set(MODEL_KEY, pick.value); describe(); });
      describe();
      wrap.replaceChildren(
        el("p", { class: "big-num", style: "font-size:20px", text: "Suggested tags" }),
        el("p", { class: "hint", text: "Claude reads this book's passages and suggests themes from your tag list. Nothing changes until you approve it." }),
        el("label", { class: "row", for: "sg-only", style: "gap:8px; font-size:15px" }, onlyNew, "Only passages without tags"),
        el("label", { class: "lbl", text: "Model" }), pick, info,
        el("div", { class: "row", style: "margin-top:6px" },
          el("button", { class: "btn primary small", type: "button", text: "Suggest tags", onclick: () => { const list = targets(); if (list.length) run(list, pick.value); } }),
          el("button", { class: "btn small", type: "button", text: "Cancel", onclick: close }),
          el("button", { class: "btn small", type: "button", text: "Forget API key", onclick: () => { if (confirm("Remove the API key from this device?")) { set(KEY, null); keyView(); } } })));
    }

    async function run(list, m) {
      const vocab = vocabulary(), key = get(KEY);
      const state = { sourceId: src.id, model: m, results: {}, inTok: 0, outTok: 0, at: new Date().toISOString() };
      const progress = el("p", { class: "hint" });
      wrap.replaceChildren(el("p", { class: "big-num", style: "font-size:20px", text: "Suggesting tags…" }), progress,
        el("button", { class: "btn small", type: "button", text: "Stop", onclick: () => { stop = true; progress.textContent = "Stopping after this batch…"; } }));
      const batches = [];
      for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
      try {
        for (let b = 0; b < batches.length && !stop; b++) {
          progress.textContent = `Batch ${b + 1} of ${batches.length}…`;
          const { out, usage } = await callClaude(key, m, src, batches[b], vocab);
          Object.assign(state.results, out);
          state.inTok += usage.input_tokens || 0; state.outTok += usage.output_tokens || 0;
          set(PENDING, JSON.stringify(state));   // paid-for results survive a reload
        }
      } catch (e) {
        if (e.badKey) { set(KEY, null); return keyView(e.message + " Paste it again (or a new one)."); }
        if (!Object.keys(state.results).length) {
          wrap.replaceChildren(el("p", { class: "warn", style: "margin:0 0 10px", text: e.message }),
            el("div", { class: "row" }, el("button", { class: "btn small", type: "button", text: "Back", onclick: setupView }), el("button", { class: "btn small", type: "button", text: "Close", onclick: close })));
          return;
        }
        toast(e.message + " Showing what came back.");
      }
      if (!box.isConnected) return;
      if (!Object.keys(state.results).length) {
        set(PENDING, null);
        wrap.replaceChildren(el("p", { class: "hint", text: `No tags suggested. Cost ${money(costOf(m, state.inTok, state.outTok))}.` }), el("button", { class: "btn small", type: "button", text: "Close", onclick: close }));
        return;
      }
      reviewView();
    }

    function reviewView() {
      const p = pending();
      const chosen = {};   // hid -> Set of ticked tags
      const items = Object.entries(p.results).map(([hid, tags]) => ({ hid, tags, f: CP.findHighlight(hid) })).filter(x => x.f && x.f.src.id === src.id);
      for (const { hid, tags } of items) chosen[hid] = new Set(tags);
      const cost = costOf(p.model in MODELS ? p.model : "claude-haiku-5-5", p.inTok, p.outTok);
      const card = ({ hid, tags, f }) => {
        const passage = el("p", { class: "passage clamp", text: f.h.text, onclick: () => passage.classList.toggle("clamp") });
        return el("div", { class: "hl" }, passage,
          f.h.note && el("div", { class: "note", text: f.h.note }),
          el("div", { class: "tags" },
            f.h.tags.map(t => el("span", { class: "tag", text: t })),
            tags.map(t => {
              const b = el("button", { type: "button", class: "tag", "aria-pressed": "true", text: "+ " + t });
              b.addEventListener("click", () => { const s = chosen[hid]; s.has(t) ? s.delete(t) : s.add(t); b.setAttribute("aria-pressed", String(s.has(t))); });
              return b;
            })));
      };
      const apply = () => {
        const map = Object.fromEntries(Object.entries(chosen).map(([h, s]) => [h, [...s]]));
        const n = CP.bulkTag(src.id, map);
        set(PENDING, null); close();
        toast(n ? `Tagged ${n} passage${n === 1 ? "" : "s"}` : "No tags applied");
        onApplied();
      };
      const actions = () => el("div", { class: "row", style: "margin:12px 0" },
        el("button", { class: "btn primary small", type: "button", text: "Apply ticked tags", onclick: apply }),
        el("button", { class: "btn small", type: "button", text: "Discard", onclick: () => { if (confirm("Discard these suggestions?")) { set(PENDING, null); close(); onApplied(); } } }));
      wrap.replaceChildren(
        el("p", { class: "big-num", style: "font-size:20px", text: `Suggestions for ${items.length} passage${items.length === 1 ? "" : "s"}` }),
        el("p", { class: "hint", text: `Tap a suggested tag to untick it. Tap a passage to see all of it. ${cost < 0.01 ? "This run cost under $0.01." : `This run cost about ${money(cost)}.`}` }),
        actions(), el("div", { class: "stack" }, items.map(card)), actions());
    }

    setupView();
  }

  window.CPSuggest = { panel, hasPending };
})();
