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


// A thumbnail that becomes the embedded player when tapped.
function makePlayer(v) {
  const player = el("div", { className: "player" });
  const playBtn = el("button", { ariaLabel: `Play ${v.title}` }, [
    el("img", { src: v.thumbnail, alt: "", loading: "lazy" }),
    el("span", { className: "play" }),
  ]);
  playBtn.addEventListener("click", () => {
    // rel=0 limits end-screen suggestions to the same channel.
    // youtube.com (not youtube-nocookie.com) so a signed-in Premium
    // session can apply where the browser shares YouTube's cookies.
    // fs=0 hides YouTube's own fullscreen button; ours makes the whole
    // player box fullscreen so the shields come along.
    const src = `https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1&modestbranding=1&fs=0`;
    const fsBtn = el("button", { className: "fs", ariaLabel: "Fullscreen", textContent: "⤢" });
    fsBtn.addEventListener("click", () => toggleFullscreen(player, fsBtn));
    player.replaceChildren(el("iframe", {
      src, title: v.title,
      allow: "autoplay; encrypted-media; picture-in-picture",
    }), el("div", { className: "shield shield-title", ariaHidden: "true" }),
      el("div", { className: "shield shield-logo", ariaHidden: "true" }), fsBtn);
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
