// Shared by the Videos and Channels pages: small helpers and the embedded
// player with its click shields and custom fullscreen button.
if (/[?&]debug\b/.test(location.search)) document.body.classList.add("debug");

function ago(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function setFsIcon(btn, on) {
  btn.textContent = on ? "✕" : "⤢";
  btn.ariaLabel = on ? "Exit fullscreen" : "Fullscreen";
}
function toggleFullscreen(player, btn) {
  if (player.classList.contains("pseudo-fs")) {
    player.classList.remove("pseudo-fs"); document.body.classList.remove("no-scroll");
    return setFsIcon(btn, false);
  }
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
  const pseudo = () => {
    player.classList.add("pseudo-fs"); document.body.classList.add("no-scroll"); setFsIcon(btn, true);
  };
  const request = player.requestFullscreen || player.webkitRequestFullscreen;
  if (!request) return pseudo();  // iPhone: no fullscreen API for page elements
  try {
    const result = request.call(player);
    if (result && result.catch) result.catch(pseudo);
  } catch (e) { pseudo(); }
}
["fullscreenchange", "webkitfullscreenchange"].forEach(evt => document.addEventListener(evt, () => {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  document.querySelectorAll(".player .fs").forEach(b => setFsIcon(b, b.parentElement === fsEl));
}));
document.addEventListener("keydown", e => {
  const open = document.querySelector(".player.pseudo-fs");
  if (e.key === "Escape" && open) toggleFullscreen(open, open.querySelector(".fs"));
});


// --- Resume where you left off, and the Playing tab ---
// Positions are saved as { videoId: [seconds, duration, details, savedAt] }
// and synced between devices by sync.js. Uses YouTube's iframe player API.
const PROGRESS_KEY = "progress-v1";
function getProgress() { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); } catch (e) { return {}; } }
function writeProgress(all) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) {} }
function saveProgress(v, seconds, duration) {
  const all = getProgress();
  // Near the end counts as finished: forget it, so it starts from the beginning next time.
  if (!seconds || seconds < 10 || (duration && seconds > duration - 20)) delete all[v.id];
  else all[v.id] = [Math.floor(seconds), Math.floor(duration || 0),
    { t: v.title, c: v.channel, th: v.thumbnail, p: v.published || "" }, Date.now()];
  const ids = Object.keys(all);
  if (ids.length > 300) ids.sort((a, b) => (all[a][3] || 0) - (all[b][3] || 0)).slice(0, ids.length - 300).forEach(k => delete all[k]);
  writeProgress(all);
}
function clearProgress(id) {
  const all = getProgress();
  if (id in all) { delete all[id]; writeProgress(all); }
}
// Partly watched videos, most recently played first.
function getPlaying() {
  return Object.entries(getProgress())
    .filter(([, p]) => p[2])
    .sort((a, b) => (b[1][3] || 0) - (a[1][3] || 0))
    .map(([id, p]) => ({ id, title: p[2].t, channel: p[2].c, thumbnail: p[2].th || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, published: p[2].p }));
}
function clock(s) {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// --- Favourites: videos kept long term (synced by sync.js, never pruned) ---
const FAV_KEY = "favourites-v1";
function getFavourites() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch (e) { return []; } }
const isFavourite = id => getFavourites().some(x => x.id === id);
function toggleFavourite(v) {
  let favs = getFavourites();
  if (favs.some(x => x.id === v.id)) favs = favs.filter(x => x.id !== v.id);
  else favs.push({ id: v.id, title: v.title, channel: v.channel, thumbnail: v.thumbnail, published: v.published || "", secs: v.secs || 0 });
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) {}
}
// A star button for any card. `onChange` lets the page redraw if needed.
function favButton(v, onChange) {
  const btn = el("button", { className: "tick fav" });
  const paint = () => {
    const on = isFavourite(v.id);
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★ Favourite" : "☆ Favourite";
  };
  btn.addEventListener("click", () => { toggleFavourite(v); paint(); if (onChange) onChange(); });
  paint();
  return btn;
}

let ytApi = null;
function loadYouTubeApi() {
  if (!ytApi) ytApi = new Promise(resolve => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (previous) previous(); resolve(window.YT); };
    document.head.append(Object.assign(document.createElement("script"), { src: "https://www.youtube.com/iframe_api" }));
  });
  return ytApi;
}
const activePlayers = new Set();
function saveAll() {
  activePlayers.forEach(p => {
    try { saveProgress(p.video, p.getCurrentTime(), p.getDuration()); } catch (e) {}
  });
}
// Save when you leave the page or lock the phone, and every few seconds while playing.
document.addEventListener("visibilitychange", () => { if (document.hidden) saveAll(); });
window.addEventListener("pagehide", saveAll);
setInterval(() => activePlayers.forEach(p => {
  try { if (p.getPlayerState() === 1) saveProgress(p.video, p.getCurrentTime(), p.getDuration()); } catch (e) {}
}), 5000);

// A thumbnail that becomes the embedded player when tapped.
function makePlayer(v) {
  const player = el("div", { className: "player" });
  const saved = getProgress()[v.id];
  const resumeAt = saved ? saved[0] : 0;
  const thumb = [el("img", { src: v.thumbnail, alt: "", loading: "lazy" }), el("span", { className: "play" })];
  if (saved) {
    const pct = saved[1] ? Math.min(100, Math.round(saved[0] / saved[1] * 100)) : 0;
    thumb.push(el("span", { className: "resume-label", textContent: `Resume ${clock(saved[0])}` }));
    if (pct) thumb.push(el("span", { className: "progress-bar" }, [el("span", { style: `width:${pct}%` })]));
  }
  const playBtn = el("button", { ariaLabel: saved ? `Resume ${v.title}` : `Play ${v.title}` }, thumb);
  playBtn.addEventListener("click", () => {
    // rel=0 limits end-screen suggestions to the same channel.
    // youtube.com (not youtube-nocookie.com) so a signed-in Premium
    // session can apply where the browser shares YouTube's cookies.
    // fs=0 hides YouTube's own fullscreen button; ours makes the whole
    // player box fullscreen so the shields come along.
    // enablejsapi lets the page read the position, for resuming later.
    const params = new URLSearchParams({ autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, fs: 0, enablejsapi: 1, origin: location.origin });
    if (resumeAt) params.set("start", resumeAt);
    const fsBtn = el("button", { className: "fs", ariaLabel: "Fullscreen", textContent: "⤢" });
    fsBtn.addEventListener("click", () => toggleFullscreen(player, fsBtn));
    const iframe = el("iframe", {
      src: `https://www.youtube.com/embed/${v.id}?${params}`, title: v.title,
      allow: "autoplay; encrypted-media; picture-in-picture",
    });
    player.replaceChildren(iframe, el("div", { className: "shield shield-title", ariaHidden: "true" }),
      el("div", { className: "shield shield-logo", ariaHidden: "true" }), fsBtn);
    loadYouTubeApi().then(YT => {
      const yt = new YT.Player(iframe, {
        events: {
          onStateChange: e => {
            if (e.data === 2) saveProgress(v, yt.getCurrentTime(), yt.getDuration());   // paused
            if (e.data === 0) saveProgress(v, 0, 0);                                       // finished
          },
        },
      });
      yt.video = v;
      activePlayers.add(yt);
    }).catch(() => { /* still plays; just no resume */ });
  });
  player.append(playBtn);
  return player;
}

// Opens the video in the YouTube Music app, which plays in the background
// and with the screen locked (a Premium perk the web player doesn't get).
// Shown on touch devices only; see .music-link in style.css.
function musicLink(v) {
  return el("a", {
    className: "tick music-link", textContent: "♫ YT Music",
    href: `https://music.youtube.com/watch?v=${v.id}`, target: "_blank", rel: "noopener",
    title: "Play in YouTube Music (works with the screen locked)",
  });
}
