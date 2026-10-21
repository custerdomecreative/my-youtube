// Loaded in <head> on every page. Adds two buttons beside the section switch:
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
  const isBlocked = () => blockedUntil() > Date.now();
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
    if (!confirm(`Block Videos, Channels and News until ${fmt(until)}?\n\nThis can't be undone, and it applies to your other devices too.`)) return;
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
  let reloadBtn = null;
  async function checkVersion(onOpen) {
    if (!build || build.startsWith("__")) return;  // local copy, not a published build
    try {
      const latest = (await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json())).build;
      if (!latest || latest === build) return;
      const flag = `reloaded-for-${latest}`;
      let tried = false;
      try { tried = !!sessionStorage.getItem(flag); sessionStorage.setItem(flag, "1"); } catch (e) {}
      if (!tried && (onOpen || !busy())) return reloadFresh();
      if (reloadBtn) { reloadBtn.textContent = "⟳ New version"; reloadBtn.classList.add("attention"); }
    } catch (e) { /* offline: check again later */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isBlocked()) showBlock();
    const nav = document.querySelector("nav.switch");
    if (nav) {
      const bar = document.createElement("div");
      bar.className = "topbar";
      nav.replaceWith(bar);
      const tools = document.createElement("div");
      tools.className = "top-tools";
      reloadBtn = Object.assign(document.createElement("button"), {
        className: "top-btn", textContent: "⟳", title: "Reload app (get the latest version)", ariaLabel: "Reload app",
      });
      reloadBtn.addEventListener("click", reloadFresh);
      const blockBtn = Object.assign(document.createElement("button"), {
        className: "top-btn", textContent: "Block 1 hr", title: "Block these pages for 1 hour",
      });
      blockBtn.addEventListener("click", startBlock);
      tools.append(reloadBtn, blockBtn);
      bar.append(nav, tools);
    }
    checkVersion(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (isBlocked()) showBlock();
    checkVersion(false);
  });
})();
