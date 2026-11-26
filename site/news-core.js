// What News and the AI desk share: unlocking and decrypting the story files, the reader that shows an
// article's text, and the story card with its Read / Read later / Mark read buttons.
// Everything stays on this device. The password is turned into a key that is kept in this browser only.
const NewsCore = (() => {
  const KEY = "news-key-v1";
  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  function ago(iso) {
    if (!iso) return "";
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  // --- Decryption (AES-GCM, key from the password via PBKDF2) ---
  async function keyFromPassword(enc, password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iterations, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function decrypt(enc, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function savedKey() {
    const raw = load(KEY, null);
    if (!raw) return null;
    try { return await crypto.subtle.importKey("raw", b64(raw), { name: "AES-GCM" }, true, ["decrypt"]); }
    catch (e) { return null; }
  }
  const forgetKey = () => { try { localStorage.removeItem(KEY); } catch (e) {} };
  // The unlock form: on the right password, remember the key and hand over the decrypted data.
  function wireUnlock({ form, input, errorEl, getEnc, onData }) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const enc = getEnc();
      if (!input.value || !enc) return;
      errorEl.textContent = "Unlocking…";
      try {
        const key = await keyFromPassword(enc, input.value);
        const data = await decrypt(enc, key);
        store(KEY, toB64(await crypto.subtle.exportKey("raw", key)));
        input.value = "";
        errorEl.textContent = "";
        onData(data);
      } catch (err) {
        errorEl.textContent = "That password didn't work.";
      }
    });
  }

  // --- The reader: article text. Strings are paragraphs, {img, alt} images, {h} subheadings. ---
  function figure(src, alt) {
    const img = el("img", { src, alt: alt || "", loading: "lazy" });
    const fig = el("figure", {}, [img]);
    if (alt) fig.append(el("figcaption", { textContent: alt }));
    img.addEventListener("error", () => fig.remove());
    return fig;
  }
  // Formatted text arrives as [[text, style], ...]; style is "", "b", "i", "bi" or "c".
  function inline(runs) {
    return runs.map(([text, style]) => {
      if (style === "b") return el("strong", { textContent: text });
      if (style === "i") return el("em", { textContent: text });
      if (style === "bi") return el("strong", {}, [el("em", { textContent: text })]);
      if (style === "c") return el("code", { textContent: text });
      return document.createTextNode(text);
    });
  }
  function readerBlocks(s) {
    const blocks = [];
    let list = null;   // consecutive list items share one <ul>/<ol>
    for (const b of s.text) {
      if (b && b.li) {
        const tag = b.n ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = el(tag);
          if (b.n && b.n !== 1) list.start = b.n;
          blocks.push(list);
        }
        list.append(el("li", {}, inline(b.li)));
        continue;
      }
      list = null;
      if (typeof b === "string") blocks.push(el("p", { textContent: b }));
      else if (b.p) blocks.push(el("p", {}, inline(b.p)));
      else if (b.img) blocks.push(figure(b.img, b.alt));
      else if (b.h) blocks.push(el("h3", { textContent: b.h }));
    }
    // No photos in the article text: lead with the story's own picture.
    // BBC feed thumbnails are small, so ask for a larger size of the same image.
    if (!s.text.some(b => b && b.img) && s.image) {
      blocks.unshift(figure(s.image.replace(/(ichef\.bbci\.co\.uk\/[^/]+\/[^/]+\/)240\//, "$1976/"), ""));
    }
    return blocks;
  }

  // One story. `st` is the page's state: st.read (a Set of ids), st.later (saved stories, oldest first),
  // st.save() to write both, and st.changed(story, paint) which the page uses to repaint after a change.
  function storyCard(s, st) {
    const isLater = () => st.later.some(x => x.id === s.id);
    const readBtn = s.text
      ? el("button", { className: "tick", textContent: "Read" })
      : el("a", { className: "tick", textContent: `Read on ${s.source} ↗`, href: s.link, target: "_blank", rel: "noopener" });
    const laterBtn = el("button", { className: "tick later" });
    const doneBtn = el("button", { className: "tick" });
    const top = el("div", { className: "story-top" }, [
      el("div", { className: "text" }, [
        el("div", { className: "sub", textContent: `${s.source} · ${ago(s.published)}` }),
        el("p", { className: "title", textContent: s.title }),
        el("p", { className: "summary", textContent: s.summary }),
      ]),
    ]);
    if (s.image) {
      const img = el("img", { className: "thumb", src: s.image, alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.remove());
      top.append(img);
    }
    const node = el("article", { className: "card story" }, [
      top, el("div", { className: "story-actions" }, [readBtn, laterBtn, doneBtn]),
    ]);
    node.dataset.id = s.id;

    let reader = null;
    if (s.text) readBtn.addEventListener("click", () => {
      if (reader) { reader.remove(); reader = null; readBtn.textContent = "Read"; return; }
      const finish = el("button", { className: "tick done", textContent: "Done — mark as read" });
      finish.addEventListener("click", () => markRead(true));
      reader = el("div", { className: "reader" }, [...readerBlocks(s), finish]);
      node.append(reader);
      readBtn.textContent = "Close";
    });

    function paint() {
      const r = st.read.has(s.id), l = isLater();
      node.classList.toggle("watched", r);
      doneBtn.textContent = r ? "Read ✓" : "Mark read";
      laterBtn.classList.toggle("on", l);
      laterBtn.textContent = l ? "Saved ✓" : "Read later";
    }
    function afterChange() { st.save(); st.changed(s, paint); }
    function markRead(value) {
      if (value) { st.read.add(s.id); st.later = st.later.filter(x => x.id !== s.id); } else st.read.delete(s.id);
      afterChange();
    }
    laterBtn.addEventListener("click", () => {
      if (isLater()) st.later = st.later.filter(x => x.id !== s.id);
      else { st.later.push(s); st.read.delete(s.id); }
      afterChange();
    });
    doneBtn.addEventListener("click", () => markRead(!st.read.has(s.id)));
    paint();
    return node;
  }

  return { load, store, el, ago, keyFromPassword, decrypt, savedKey, forgetKey, wireUnlock, readerBlocks, storyCard };
})();
