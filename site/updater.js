// Update button and auto-update, shared by all pages. Both ask GitHub to run
// the same update job as the schedule, then reload once fresh data is live.
//
// GitHub runs scheduled jobs late or not at all, so when a page is opened
// and the data is more than STALE_MINUTES old, it starts an update itself
// (if this device has a token and isn't in its cooldown). If another device
// already started one, it waits for that instead of starting a second.
//
// The token is a GitHub fine-grained token with "Actions: Read and write" on
// this repository, pasted in once and kept on this device only.
(() => {
  const REPO = "custerdomecreative/my-youtube";
  const WORKFLOW = "update.yml";
  const COOLDOWN_MINUTES = 120;         // per device; change or set to 0
  const STALE_MINUTES = 120;            // auto-update when data is older than this
  const KEYS = { token: "gh-token-v1", last: "update-last-v1", running: "update-running-v1", lock: "update-lock-v1" };
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const api = (path, opts = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
    cache: "no-store", ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${get(KEYS.token)}`, ...(opts.headers || {}) },
  });
  const dataUpdatedAt = async () => {
    const data = await fetch(`videos.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
    return data.updated ? new Date(data.updated).getTime() : 0;
  };

  const header = document.querySelector("header");
  if (!header) return;
  const btn = document.createElement("button");
  btn.className = "update-btn";
  const updated = document.getElementById("updated");
  const box = document.createElement("div");
  box.className = "update-box";
  updated.replaceWith(box);
  box.append(updated, btn);

  let polling = false;
  const minutesLeft = () => {
    const last = Number(get(KEYS.last) || 0);
    return Math.ceil((last + COOLDOWN_MINUTES * 60000 - Date.now()) / 60000);
  };
  function paint(text) {
    if (text) { btn.textContent = text; btn.disabled = true; return; }
    const left = minutesLeft();
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Update available in ${left} min` : "↻ Update now";
  }

  // GitHub's servers can keep serving the previous files for a few minutes
  // after an update, so check the published data is newer than the request.
  async function waitForFreshData(since) {
    paint("Almost done…");
    const until = Date.now() + 5 * 60000;
    while (Date.now() < until) {
      try { if (await dataUpdatedAt() >= since - 60000) return; } catch (e) { /* keep trying */ }
      await sleep(5000);
    }
  }

  // Wait for the update: any run created after `since` (ours, another tab's
  // or another device's). Duplicate requests get cancelled by GitHub, so a
  // cancelled run isn't a failure as long as another one succeeds.
  async function poll(since) {
    if (polling) return;
    polling = true;
    paint("Updating… (2–4 min)");
    const deadline = since + 12 * 60000;
    try {
      while (Date.now() < deadline) {
        await sleep(10000);
        try {
          const res = await api(`/actions/workflows/${WORKFLOW}/runs?per_page=10`);
          if (!res.ok) continue;
          const runs = ((await res.json()).workflow_runs || []).filter(r => new Date(r.created_at).getTime() >= since - 60000);
          if (!runs.length) continue;                                                        // not started yet
          if (runs.some(r => r.status === "completed" && r.conclusion === "success")) {
            set(KEYS.running, null);
            await waitForFreshData(since);
            location.reload();
            return;
          }
          if (runs.some(r => r.status !== "completed")) continue;                            // still going
          set(KEYS.running, null);
          paint("Update failed — try later");
          setTimeout(() => paint(), 15000);
          return;
        } catch (e) { /* keep waiting */ }
      }
      set(KEYS.running, null);
      paint();
    } finally {
      polling = false;
    }
  }

  // Only one tab starts an update: claim it, wait a moment, check we still hold it.
  const me = Math.random().toString(36).slice(2);
  async function claimUpdate() {
    const held = () => { try { return JSON.parse(get(KEYS.lock) || "null"); } catch (e) { return null; } };
    const current = held();
    if (current && current.o !== me && Date.now() - current.t < 30000) return false;
    set(KEYS.lock, JSON.stringify({ o: me, t: Date.now() }));
    await sleep(300 + Math.random() * 300);
    return held()?.o === me;
  }
  // Another tab started or is waiting on an update: wait with it.
  function joinRunning() {
    const running = Number(get(KEYS.running) || 0);
    if (running && Date.now() - running < 12 * 60000) { poll(running); return true; }
    return false;
  }

  // Start an update run. `auto` runs stay silent on problems.
  async function start(auto) {
    paint(auto ? "Fetching new videos…" : "Starting…");
    let res;
    try {
      res = await api(`/actions/workflows/${WORKFLOW}/dispatches`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main" }),
      });
    } catch (e) {
      if (!auto) { paint("Couldn't reach GitHub"); setTimeout(() => paint(), 8000); } else paint();
      return;
    }
    if (res.status === 401) {
      // Only forget a token GitHub says is invalid or expired.
      set(KEYS.token, null);
      if (!auto) alert("GitHub says that token is invalid or expired. Tap Update now again to enter a new one.");
      return paint();
    }
    if (res.status === 403 || res.status === 404) {
      if (!auto) alert("GitHub accepted the token but it can't run the update. Check it has access to my-youtube with \"Actions: Read and write\".");
      return paint();
    }
    if (!res.ok) {
      if (!auto) { paint("Update failed — try later"); setTimeout(() => paint(), 8000); } else paint();
      return;
    }
    const now = Date.now();
    set(KEYS.last, String(now));
    set(KEYS.running, String(now));
    poll(now);
  }

  // On opening or returning to a page: update if the data is stale.
  let checking = false;
  async function autoUpdate() {
    if (checking || polling || !get(KEYS.token) || minutesLeft() > 0) return;
    checking = true;
    try {
      if (joinRunning()) return;
      const age = Date.now() - await dataUpdatedAt();
      if (age < STALE_MINUTES * 60000) return;
      if (!(await claimUpdate())) return;                 // another tab is handling it
      if (joinRunning() || minutesLeft() > 0) return;     // it may have just started one
      // Another device may already be updating: join that run instead.
      const res = await api(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
      if (res.ok) {
        const run = (await res.json()).workflow_runs?.[0];
        const created = run ? new Date(run.created_at).getTime() : 0;
        if (run && run.status !== "completed" && Date.now() - created < 10 * 60000) {
          set(KEYS.running, String(created));
          return poll(created);
        }
      }
      await start(true);
    } catch (e) {
      /* offline or GitHub unreachable: try again next time */
    } finally {
      checking = false;
    }
  }

  btn.addEventListener("click", async () => {
    if (!get(KEYS.token)) {
      const token = prompt(
        "Paste your GitHub update token. It's stored on this device only.\n\n" +
        "Create one at GitHub → Settings → Developer settings → Fine-grained tokens, " +
        `with access to ${REPO} only and "Actions: Read and write".`);
      if (!token || !token.trim()) return;
      set(KEYS.token, token.trim());
    }
    if (minutesLeft() > 0) return paint();
    start(false);
  });

  // Keep waiting if an update was started on another page or before a reload.
  const running = Number(get(KEYS.running) || 0);
  if (running && Date.now() - running < 12 * 60000) poll(running);
  else { set(KEYS.running, null); paint(); autoUpdate(); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) autoUpdate(); });
  // An update started in another tab: show it here too, and reload when it lands.
  window.addEventListener("storage", e => { if (e.key === KEYS.running && e.newValue) joinRunning(); });
  setInterval(() => { if (!polling) paint(); }, 60000);
})();
