// "Update now" button, shared by all pages. It asks GitHub to run the same
// update job as the twice-daily schedule, then reloads once it has finished.
//
// It needs a GitHub fine-grained token with only "Actions: read and write"
// on this one repository. The token is pasted in once and kept on this
// device only; it is never part of the repository or the published site.
(() => {
  const REPO = "custerdomecreative/my-youtube";
  const WORKFLOW = "update.yml";
  const COOLDOWN_MINUTES = 60;          // per device; change or set to 0
  const KEYS = { token: "gh-token-v1", last: "update-last-v1", running: "update-running-v1" };
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const api = (path, opts = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${get(KEYS.token)}`, ...(opts.headers || {}) },
  });

  const header = document.querySelector("header");
  if (!header) return;
  const btn = document.createElement("button");
  btn.className = "update-btn";
  const updated = document.getElementById("updated");
  const box = document.createElement("div");
  box.className = "update-box";
  updated.replaceWith(box);
  box.append(updated, btn);

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

  async function poll(startedAt) {
    paint("Updating… (2–4 min)");
    const deadline = startedAt + 12 * 60000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const res = await api(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=1`);
        if (!res.ok) continue;
        const run = (await res.json()).workflow_runs?.[0];
        if (!run || new Date(run.created_at).getTime() < startedAt - 60000) continue;  // ours hasn't appeared yet
        if (run.status !== "completed") continue;
        set(KEYS.running, null);
        if (run.conclusion === "success") { location.reload(); return; }
        paint("Update failed — try later");
        setTimeout(() => paint(), 15000);
        return;
      } catch (e) { /* keep waiting */ }
    }
    set(KEYS.running, null);
    paint();
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
    paint("Starting…");
    let res;
    try {
      res = await api(`/actions/workflows/${WORKFLOW}/dispatches`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main" }),
      });
    } catch (e) { paint("Couldn't reach GitHub"); setTimeout(() => paint(), 8000); return; }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      set(KEYS.token, null);
      alert("GitHub didn't accept that token. Check it has \"Actions: Read and write\" on this repository, then try again.");
      return paint();
    }
    if (!res.ok) { paint("Update failed — try later"); setTimeout(() => paint(), 8000); return; }
    const now = Date.now();
    set(KEYS.last, String(now));
    set(KEYS.running, String(now));
    poll(now);
  });

  // Keep waiting if an update was started on another page or before a reload.
  const running = Number(get(KEYS.running) || 0);
  if (running && Date.now() - running < 12 * 60000) poll(running); else { set(KEYS.running, null); paint(); }
  setInterval(() => { if (!btn.textContent.startsWith("Updating")) paint(); }, 60000);
})();
