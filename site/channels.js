// The Channels tab inside Watch: every channel's full catalogue, with search. watch.html calls
// Channels.route() whenever the address is #channels (the list) or #channels/<id> (one channel).
// Watched ticks and Watch Later are shared with the Watch list.
(() => {
  // Watched ticks and Watch Later are shared with the Watch list.
  const KEYS = { watched: "watched-v1", later: "later-v1", sort: "catalog-sort-v1", hideWatched: "catalog-hide-v1" };
  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const PAGE = 24;

  let index = null;          // catalog/index.json
  const loaded = {};         // channel id -> rows
  let state = { sort: load(KEYS.sort, "newest"), query: "", hideWatched: load(KEYS.hideWatched, false), shown: PAGE };

  // Re-read shared state each time, in case the Watch list changed it.
  const getWatched = () => new Set(load(KEYS.watched, []));
  // AI-section videos (from AI channels shown here) use the AI Watch Later list.
  const laterKey = v => (v && v.section === "ai") ? "ai-later-v1" : KEYS.later;
  const getLater = v => load(laterKey(v), []);

  function when(iso) {
    if (!iso) return "";
    const days = (Date.now() - new Date(iso)) / 86400000;
    return days < 30 ? ago(iso) : new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
  }
  function duration(s) {
    if (!s) return "";
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }
  function views(n) {
    if (!n) return "";
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M views`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K views`;
    return `${n} views`;
  }

  function card(v, meta) {
    const laterBtn = el("button", { className: "tick later" });
    const tick = el("button", { className: "tick" });
    const node = el("article", { className: "card" }, [
      makePlayer(v),
      el("div", { className: "meta" }, [
        el("div", { className: "text" }, [
          el("p", { className: "title", textContent: v.title }),
          el("div", { className: "sub", textContent: meta }),
        ]),
        el("div", { className: "actions" }, [laterBtn, tick, favButton(v), musicLink(v)]),
      ]),
    ]);
    function paint() {
      const w = getWatched().has(v.id), l = getLater(v).some(x => x.id === v.id);
      node.classList.toggle("watched", w);
      tick.textContent = w ? "Watched ✓" : "Mark watched";
      laterBtn.classList.toggle("on", l);
      laterBtn.textContent = l ? "Saved ✓" : "Watch later";
    }
    laterBtn.addEventListener("click", () => {
      let later = getLater(v);
      if (later.some(x => x.id === v.id)) later = later.filter(x => x.id !== v.id);
      else {
        later.push(v);
        const w = getWatched(); w.delete(v.id); store(KEYS.watched, [...w]);
      }
      store(laterKey(v), later);
      paint();
    });
    tick.addEventListener("click", () => {
      const w = getWatched();
      if (w.has(v.id)) w.delete(v.id);
      else { w.add(v.id); store(laterKey(v), getLater(v).filter(x => x.id !== v.id)); clearProgress(v.id); }
      store(KEYS.watched, [...w]);
      paint();
      if (state.hideWatched && w.has(v.id)) node.remove();
    });
    paint();
    return node;
  }

  function startTime(iso) {
    if (!iso || iso === "soon") return "soon";
    const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return today ? `today ${time}` : `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
  }
  const searchMeta = v => v.live ? `${v.channel} · 🔴 Live now`
    : v.upcoming ? `${v.channel} · Upcoming, starts ${startTime(v.upcoming)}`
    : [v.channel, when(v.published), duration(v.secs), views(v.views)].filter(Boolean).join(" · ");
  function showIndex() {
    document.title = "Channels · The Margin";
    const main = document.getElementById("channels-main");
    const search = searchPanel(card, searchMeta, () => (index?.channels || []).map(ch => ch.name));
    if (!index.configured) {
      main.replaceChildren(search, el("div", { className: "empty" }, [
        el("strong", { textContent: "Not set up yet." }),
        document.createTextNode("Add the YOUTUBE_API_KEY secret to the repository to browse full channel catalogues."),
      ]));
      return;
    }
    const rows = index.channels.map(c => el("a", { className: "channel-row", href: `#channels/${encodeURIComponent(c.id)}` }, [
      document.createTextNode(c.name),
      el("span", { textContent: c.error && !c.count ? "Couldn't load" : `${c.count.toLocaleString()} videos` }),
    ]));
    main.replaceChildren(search, el("div", { className: "channel-list" }, rows));
  }

  async function showChannel(id) {
    const info = index.channels.find(c => c.id === id);
    if (!info) return showIndex();
    document.title = `${info.name} · The Margin`;
    const main = document.getElementById("channels-main");
    main.replaceChildren(el("a", { className: "back", href: "#channels", textContent: "← All channels" }), el("h2", { textContent: info.name }),
      el("div", { className: "empty", textContent: "Loading…" }));
    if (!loaded[id]) {
      try {
        const data = await fetch(`catalog/${id}.json?v=${encodeURIComponent(index.updated || "")}`).then(r => r.json());
        loaded[id] = data.videos.map(([vid, title, published, secs, views]) => ({
          id: vid, title, published, secs, views, channel: info.name, ...(info.section ? { section: info.section } : {}),
          thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        }));
      } catch (e) {
        main.lastChild.textContent = "Couldn't load this channel. Try again in a bit.";
        return;
      }
    }
    if (hashId() !== id) return;  // navigated away while loading

    const search = el("input", { type: "search", placeholder: "Search this channel", value: state.query, ariaLabel: "Search this channel" });
    const sort = el("select", { ariaLabel: "Sort" }, [
      el("option", { value: "newest", textContent: "Newest" }),
      el("option", { value: "oldest", textContent: "Oldest" }),
      el("option", { value: "popular", textContent: "Most viewed" }),
    ]);
    sort.value = state.sort;
    const hide = el("input", { type: "checkbox", checked: state.hideWatched });
    const count = el("div", { className: "result-count" });
    const list = el("div", { className: "list" });
    const more = el("button", { className: "tick more", textContent: "Show more" });

    function results() {
      const q = state.query.trim().toLowerCase();
      const watched = getWatched();
      let rows = loaded[id].filter(v => (!q || v.title.toLowerCase().includes(q)) && !(state.hideWatched && watched.has(v.id)));
      if (state.sort === "oldest") rows = [...rows].reverse();
      if (state.sort === "popular") rows = [...rows].sort((a, b) => b.views - a.views);
      return rows;
    }
    function draw() {
      const rows = results();
      count.textContent = `${rows.length.toLocaleString()} video${rows.length === 1 ? "" : "s"}`;
      if (!rows.length) {
        list.replaceChildren(el("div", { className: "empty", textContent: "No videos match." }));
      } else {
        list.replaceChildren(...rows.slice(0, state.shown).map(v =>
          card(v, [when(v.published), duration(v.secs), views(v.views)].filter(Boolean).join(" · "))));
      }
      more.hidden = rows.length <= state.shown;
    }
    let timer;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.query = search.value; state.shown = PAGE; draw(); }, 200); });
    sort.addEventListener("change", () => { state.sort = sort.value; store(KEYS.sort, state.sort); state.shown = PAGE; draw(); });
    hide.addEventListener("change", () => { state.hideWatched = hide.checked; store(KEYS.hideWatched, state.hideWatched); state.shown = PAGE; draw(); });
    more.addEventListener("click", () => { state.shown += PAGE; draw(); });

    main.replaceChildren(
      el("a", { className: "back", href: "#channels", textContent: "← All channels" }),
      el("h2", { textContent: info.name }),
      el("div", { className: "controls" }, [search, sort, el("label", {}, [hide, document.createTextNode("Hide watched")])]),
      count, list, more);
    draw();
  }

  // The channel in the address: watch.html#channels is the list, watch.html#channels/<id> one channel.
  const hashId = () => { const m = location.hash.match(/^#channels\/(.+)$/); return m ? decodeURIComponent(m[1]) : ""; };
  function route() {
    if (!index) return start();
    state.query = ""; state.shown = PAGE;
    const id = hashId();
    id ? showChannel(id) : showIndex();
    window.scrollTo(0, 0);
  }
  // The catalogue is only fetched the first time the Channels tab is opened.
  let starting = false;
  function start() {
    if (starting) return;
    starting = true;
    fetch(`catalog/index.json?t=${Date.now()}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => { index = data; route(); })
      .catch(() => {
        starting = false;
        document.getElementById("channels-main").replaceChildren(el("div", { className: "empty" }, [
          el("strong", { textContent: "Couldn't load channels." }), document.createTextNode("Try again in a bit."),
        ]));
      });
  }
  window.Channels = { route };
})();
