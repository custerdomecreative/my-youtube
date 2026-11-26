// Loaded in <head> on every page. Builds the shared chrome of The Margin:
//
//  - Masthead: date, "The Margin", the section bar (desktop) and a ⟳ button
//    (desktop) plus Menu. On phones a tab bar sits at the bottom instead of
//    the section bar.
//  - Menu: sync status, Reload app, and Block 1 hr (only here).
//
//  ⟳ Reload app  - reloads the page from GitHub, skipping cached copies, so
//                  a home-screen app picks up new versions without being
//                  reinstalled. The page also does this by itself when it
//                  notices a new version has been published.
//  Block 1 hour  - hides every page behind a "come back later" screen until
//                  the time is up. Synced to other devices by sync.js.
(() => {
  const BLOCK_KEY = "block-until-v1";
  const BLOCK_MINUTES = 60;
  const build = document.querySelector('meta[name="build"]')?.content || "";
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const blockedUntil = () => Number(get(BLOCK_KEY) || 0);
  // Commonplace Book is the healthy alternative to scrolling, so it opts out (<html data-no-block>).
  const isBlocked = () => !document.documentElement.hasAttribute("data-no-block") && blockedUntil() > Date.now();
  const fmt = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const busy = () => document.querySelector(".player iframe, .reader, .pseudo-fs");

  // --- Block ---
  // Applied before the page draws, so there's no flash of content.
  if (isBlocked()) document.documentElement.classList.add("blocked");

  let screen = null, countdown = null;
  function showBlock() {
    document.documentElement.classList.add("blocked");
    document.querySelectorAll("iframe").forEach(f => f.remove());  // stop anything playing
    if (!document.body) return;
    if (!screen) {
      screen = document.createElement("div");
      screen.className = "blocked-screen";
      screen.innerHTML = '<div><div class="blocked-icon">⏸</div><h1>Taking a break</h1><p class="blocked-until"></p><p class="blocked-left"></p></div>';
      document.body.append(screen);
    }
    const tick = () => {
      const left = blockedUntil() - Date.now();
      if (left <= 0) return location.reload();
      screen.querySelector(".blocked-until").textContent = `Back at ${fmt(blockedUntil())}.`;
      const mins = Math.ceil(left / 60000);
      screen.querySelector(".blocked-left").textContent = `${mins} minute${mins === 1 ? "" : "s"} to go. Go do something else.`;
    };
    tick();
    clearInterval(countdown);
    countdown = setInterval(tick, 15000);
  }
  function startBlock() {
    const until = Date.now() + BLOCK_MINUTES * 60000;
    if (!confirm(`Block Watch, News and AI until ${fmt(until)}?\n\nThis can't be undone, and it applies to your other devices too.`)) return;
    try { localStorage.setItem(BLOCK_KEY, String(until)); } catch (e) {}
    showBlock();
  }
  // A block started on another device arrives through sync.js.
  setInterval(() => { if (isBlocked() && !screen) showBlock(); }, 5000);

  // --- Reload / new versions ---
  function reloadFresh() {
    const url = new URL(location.href);
    url.searchParams.set("r", Date.now());
    location.replace(url.toString());
  }
  let newVersion = false;
  function flagNewVersion() {
    newVersion = true;
    document.querySelectorAll(".js-reload, .js-flag").forEach(b => b.classList.add("attention"));
    document.querySelectorAll(".js-reload").forEach(b => {
      b.setAttribute("aria-label", "New version available: reload app");
      b.title = "New version available: reload app";
    });
    const label = document.querySelector(".js-reload-label");
    if (label) label.textContent = "New version: reload app";
  }
  async function checkVersion(onOpen) {
    if (!build || build.startsWith("__")) return;  // local copy, not a published build
    try {
      const latest = (await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json())).build;
      if (!latest || latest === build) return;
      const flag = `reloaded-for-${latest}`;
      let tried = false;
      try { tried = !!sessionStorage.getItem(flag); sessionStorage.setItem(flag, "1"); } catch (e) {}
      if (!tried && (onOpen || !busy())) return reloadFresh();
      flagNewVersion();
    } catch (e) { /* offline: check again later */ }
  }

  // --- Chrome: masthead, section bar, tab bar, Menu ---
  const ICONS = {
    sync: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"></path><path d="M20 4v5h-5"></path></svg>',
    menu: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
    block: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>',
    tab: d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`,
  };
  const SECTIONS = {
    today: { label: "Today", tab: "Today", href: "today.html", icon: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" },
    book: { label: "Commonplace Book", tab: "Book", href: "commonplace.html", icon: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 5.5v16" },
    news: { label: "News", tab: "News", href: "news.html", icon: "M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5" },
    ai: { label: "AI", tab: "AI", href: "./?s=ai", icon: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6zM10 10h4v4h-4z" },
    watch: { label: "Watch", tab: "Watch", href: "./", icon: "M3 6h18v12H3zM10 9.5v5l4.5-2.5z" },
  };
  const DESKTOP_ORDER = ["today", "book", "news", "ai", "watch"];
  const PHONE_ORDER = ["book", "news", "today", "ai", "watch"];

  function currentSection() {
    const page = location.pathname.split("/").pop() || "index.html";
    const ai = new URLSearchParams(location.search).get("s") === "ai";
    if (page === "commonplace.html") return "book";
    if (page === "today.html") return "today";
    if (page === "news.html") return ai ? "ai" : "news";
    if (page === "channels.html") return "watch";
    return ai ? "ai" : "watch";
  }

  function h(tag, props = {}, html) {
    const el = Object.assign(document.createElement(tag), props);
    if (html != null) el.innerHTML = html;
    return el;
  }

  function dateParts() {
    const now = new Date();
    const f = (opts) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", opts).formatToParts(now).map(p => [p.type, p.value]));
    const l = f({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const s = f({ weekday: "short", day: "numeric", month: "short" });
    return { long: `${l.weekday}, ${l.day} ${l.month} ${l.year}`, short: `${s.weekday} ${s.day} ${s.month}` };
  }

  function syncStatusText() {
    const node = document.querySelector(".sync-status") || document.getElementById("sync-status");
    const t = node?.textContent.trim();
    return t ? `Sync: ${t}` : "Sync: nothing to report yet";
  }

  function buildChrome() {
    document.querySelectorAll("nav.switch:not(.sub)").forEach(n => n.remove());  // old section switch
    const here = currentSection();

    // Top row: date + tools
    const dates = dateParts();
    const date = h("div", { className: "chrome-date" });
    const longEl = h("b", { className: "long", textContent: dates.long });
    const subEl = h("span", { textContent: "Today's edition" });
    const shortEl = h("span", { className: "short", textContent: dates.short });
    date.append(longEl, subEl, shortEl);

    const reloadBtn = h("button", { type: "button", className: "chrome-btn icon reload js-reload", title: "Reload app (get the latest version)" }, ICONS.sync);
    reloadBtn.setAttribute("aria-label", "Reload app");
    reloadBtn.addEventListener("click", reloadFresh);

    const menuBtn = h("button", { type: "button", className: "chrome-btn menu js-flag", id: "menu-btn" }, `${ICONS.menu}<span class="lbl">Menu</span>`);
    menuBtn.setAttribute("aria-label", "Menu");
    menuBtn.setAttribute("aria-haspopup", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-controls", "menu-panel");

    const panel = h("div", { className: "menu-panel", id: "menu-panel", hidden: true });
    panel.setAttribute("aria-label", "Menu");
    const status = h("div", { className: "menu-status", role: "status" });
    const reloadItem = h("button", { type: "button", className: "menu-item" }, `${ICONS.sync}<span class="js-reload-label">Reload app</span>`);
    reloadItem.addEventListener("click", reloadFresh);
    const blockItem = h("button", { type: "button", className: "menu-item" }, `${ICONS.block}<span>Block 1 hr</span>`);
    blockItem.addEventListener("click", () => { closeMenu(); startBlock(); });
    panel.append(status, reloadItem, blockItem);

    function openMenu() {
      status.textContent = syncStatusText();
      panel.hidden = false;
      menuBtn.setAttribute("aria-expanded", "true");
    }
    function closeMenu(refocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
      if (refocus) menuBtn.focus();
    }
    menuBtn.addEventListener("click", () => (panel.hidden ? openMenu() : closeMenu()));
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(true); });
    document.addEventListener("click", e => { if (!panel.hidden && !e.target.closest(".chrome-tools")) closeMenu(); });
    panel.addEventListener("focusout", e => { if (!panel.hidden && e.relatedTarget && !e.relatedTarget.closest(".chrome-tools")) closeMenu(); });

    const tools = h("div", { className: "chrome-tools" });
    tools.append(reloadBtn, menuBtn, panel);
    const top = h("div", { className: "chrome-top" });
    top.append(date, tools);

    // Masthead + section bar (desktop) + double rule
    const mast = h("a", { className: "masthead", href: SECTIONS.today.href, textContent: "The Margin" });
    const bar = h("nav", { className: "sections" });
    bar.setAttribute("aria-label", "Sections");
    DESKTOP_ORDER.forEach(id => {
      const a = h("a", { href: SECTIONS[id].href, textContent: SECTIONS[id].label });
      if (id === here) a.setAttribute("aria-current", "page");
      bar.append(a);
    });
    const chrome = h("div", { className: "chrome" });
    chrome.append(top, mast, bar, h("div", { className: "dbl-rule" }));
    document.body.prepend(chrome);

    // Phone tab bar
    const tabbar = h("nav", { className: "tabbar" });
    tabbar.setAttribute("aria-label", "Sections");
    PHONE_ORDER.forEach(id => {
      const s = SECTIONS[id];
      const a = h("a", { href: s.href }, `${ICONS.tab(s.icon)}<span>${s.tab}</span>`);
      if (id === here) a.setAttribute("aria-current", "page");
      tabbar.append(a);
    });
    document.body.append(tabbar);

    // Keep the date right if the app stays open past midnight.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      const d = dateParts();
      longEl.textContent = d.long;
      shortEl.textContent = d.short;
    });
    if (newVersion) flagNewVersion();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isBlocked()) showBlock();
    buildChrome();
    checkVersion(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (isBlocked()) showBlock();
    checkVersion(false);
  });
})();
