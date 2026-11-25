// Commonplace: Kindle "My Clippings.txt" import.
//
// The file is append-only and holds everything ever highlighted, so import has to
// be safe to repeat: the same highlight is never added twice, a passage edited on
// the Kindle updates the existing highlight (keeping its note, tags and review
// history), and Aaron's own notes and tags are never overwritten.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CPKindle = factory();
})(this, function () {
  "use strict";

  const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  const monthIndex = s => { const k = String(s).toLowerCase(); return k in MONTHS ? MONTHS[k] : Object.entries(MONTHS).find(([name]) => k.length >= 3 && name.startsWith(k.slice(0, 3)))?.[1]; };

  // "Monday, 3 November 2025 10:22:15" or "Monday, November 3, 2025 10:22:15 AM" -> ISO time, or null.
  function parseDate(s) {
    if (!s) return null;
    let y, m, d;
    let r = s.match(/(\d{1,2})\.?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
    if (r) { d = +r[1]; m = monthIndex(r[2]); y = +r[3]; }
    else if ((r = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/))) { m = monthIndex(r[1]); d = +r[2]; y = +r[3]; }
    else if ((r = s.match(/(\d{4})-(\d{2})-(\d{2})/))) { y = +r[1]; m = +r[2] - 1; d = +r[3]; }
    if (y == null || m == null || Number.isNaN(m) || m === undefined) return null;
    let hh = 0, mm = 0, ss = 0;
    const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (t) {
      hh = +t[1]; mm = +t[2]; ss = +(t[3] || 0);
      if (t[4]) { const pm = t[4].toUpperCase() === "PM"; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    }
    const date = new Date(y, m, d, hh, mm, ss);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // "The Power Broker (Robert A. Caro)" -> title and author. Handles "Caro, Robert A." and "(Kindle Edition)".
  function splitTitle(line) {
    let t = line.replace(/^﻿/, "").trim();
    let author = "";
    for (let i = 0; i < 3; i++) {
      const m = t.match(/^(.*\S)\s+\(([^()]*)\)\s*$/);
      if (!m) break;
      if (/^(kindle edition|z-lib|.*z-library.*|.*\bepub\b.*|.*\bmobi\b.*)$/i.test(m[2].trim())) { t = m[1]; continue; }
      t = m[1]; author = m[2].trim(); break;
    }
    const tidy = a => (a.includes(",") ? a.split(",").map(x => x.trim()).reverse().join(" ") : a);
    author = author.split(/\s*;\s*/).filter(Boolean).map(tidy).join(" & ");
    return { title: t, author };
  }

  // One result per usable clipping, in file order (which is oldest first).
  function parseClippings(raw) {
    const text = String(raw).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const entries = [];
    const skipped = { bookmarks: 0, empty: 0, other: 0 };
    text.split(/^={5,}[ \t]*$/m).forEach(block => {
      const lines = block.replace(/﻿/g, "").split("\n");
      while (lines.length && !lines[0].trim()) lines.shift();
      if (!lines.length) return;
      const meta = lines[1] || "";
      const kind = (meta.match(/Your\s+(Highlight|Note|Bookmark|Clip)/i) || [])[1];
      if (!kind) { skipped.other++; return; }
      if (/bookmark/i.test(kind)) { skipped.bookmarks++; return; }
      const body = lines.slice(2).join("\n").trim();
      if (!body || /^<?\s*You have reached the clipping limit/i.test(body)) { skipped.empty++; return; }
      const { title, author } = splitTitle(lines[0]);
      if (!title) { skipped.other++; return; }
      const pageM = meta.match(/\bpage\s+(\d+|[ivxlcdm]+)\b/i);
      const locM = meta.match(/\blocation\s+(\d+)(?:\s*[-–]\s*(\d+))?/i);
      let loc = null;
      if (locM) {
        const a = +locM[1]; let b = locM[2] ? +locM[2] : a;
        if (b < a) b = +(String(a).slice(0, String(a).length - String(b).length) + b);   // "1802-05"
        loc = [a, b];
      }
      entries.push({
        title, author, type: /note/i.test(kind) ? "note" : "highlight", text: body,
        page: pageM ? (/^\d+$/.test(pageM[1]) ? +pageM[1] : pageM[1]) : null, loc,
        date: parseDate((meta.match(/Added on\s+(.+?)\s*$/i) || [])[1]),
      });
    });
    return { entries, skipped };
  }

  const locString = loc => (loc ? (loc[0] === loc[1] ? `Loc ${loc[0]}` : `Loc ${loc[0]}-${loc[1]}`) : null);
  const overlaps = (a, b) => !!(a && b) && a[0] <= b[1] && b[0] <= a[1];
  // Two passages that are versions of one another: one contains the other, or they share an end.
  function similar(x, y) {
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    if (!s) return false;
    if (l.includes(s)) return true;
    const n = Math.min(40, s.length);
    return l.includes(s.slice(0, n)) || l.includes(s.slice(-n));
  }
  // Same highlight, or an edited version of it (a Kindle keeps both, with overlapping locations).
  function related(a, b, norm) {
    const x = norm(a.text), y = norm(b.text);
    if (x === y) return true;
    if (a.loc && b.loc) return overlaps(a.loc, b.loc) && similar(x, y);
    return !a.loc && !b.loc && a.page != null && a.page === b.page && similar(x, y);
  }

  // Group clippings by book; drop earlier versions of edited highlights; attach notes.
  function buildBooks(entries, lib) {
    const books = new Map();
    for (const e of entries) {
      const id = lib.sourceIdFor(e.title, e.author);
      if (!books.has(id)) books.set(id, { id, title: lib.cleanTitle(e.title, e.author), author: lib.cleanAuthor(e.author), entries: [] });
      books.get(id).entries.push(e);
    }
    const out = [];
    for (const book of books.values()) {
      const kept = [];
      for (const e of book.entries.filter(x => x.type === "highlight")) {
        const i = kept.findIndex(k => related(k, e, lib.norm));
        if (i >= 0) kept[i] = { ...e, note: kept[i].note || "" };   // the newer one wins
        else kept.push({ ...e, note: "" });
      }
      const loose = new Map();
      for (const n of book.entries.filter(x => x.type === "note")) {
        let target = null;
        if (n.loc) target = kept.find(h => h.loc && n.loc[0] >= h.loc[0] && n.loc[0] <= h.loc[1] + 1);
        else if (n.page != null) { const same = kept.filter(h => !h.loc && h.page === n.page); if (same.length === 1) target = same[0]; }
        if (target) target.note = n.text;
        else loose.set(n.loc ? n.loc.join("-") : lib.norm(n.text), n);   // a note whose highlight was deleted; newest wins
      }
      const items = kept.map(h => ({ text: h.text, note: h.note, page: h.page, location: locString(h.loc), created: h.date }));
      for (const n of loose.values()) items.push({ text: n.text, note: "", page: n.page, location: locString(n.loc), created: n.date, loose: true });
      out.push({ id: book.id, title: book.title, author: book.author, items });
    }
    return out;
  }

  // Compare with what's already saved. Nothing is written here.
  function planImport(books, lib) {
    const plan = { books: [], totals: { highlights: 0, books: books.length, new: 0, edited: 0, notes: 0, unchanged: 0, removed: 0 } };
    for (const book of books) {
      const src = lib.getSource(book.id);
      const existing = src ? src.highlights : [];
      const claimed = new Set();
      const p = { book, add: [], edit: [], noteFill: [], unchanged: 0 };
      for (const item of book.items) {
        plan.totals.highlights++;
        const id = lib.highlightId(book.id, item.text);
        if (src && src.deleted && src.deleted[id]) { plan.totals.removed++; continue; }   // deleted in the app: stays deleted
        const nt = lib.norm(item.text);
        const ex = existing.find(h => h.id === id || lib.norm(h.text) === nt);
        if (ex) {
          // A Kindle note fills an empty note, but never replaces one Aaron has written or edited.
          if (item.note && item.note !== ex.note && !ex.noteEdited) p.noteFill.push({ id: ex.id, note: item.note });
          else p.unchanged++;
          continue;
        }
        const loc = lib.locRange(item.location);
        const prior = existing.find(h => h.via === "kindle" && !claimed.has(h.id)
          && related({ text: h.text, loc: lib.locRange(h.location), page: h.page }, { text: item.text, loc, page: item.page }, lib.norm));
        if (prior) {
          claimed.add(prior.id);
          if (prior.edited) p.unchanged++;   // Aaron changed this text himself: leave it
          else p.edit.push({ id: prior.id, item });
          continue;
        }
        p.add.push({ id, item });
      }
      plan.totals.new += p.add.length; plan.totals.edited += p.edit.length;
      plan.totals.notes += p.noteFill.length + p.add.filter(a => a.item.note).length; plan.totals.unchanged += p.unchanged;
      plan.books.push(p);
    }
    return plan;
  }

  // Save the plan: one write per book that changed.
  function applyImport(plan, lib) {
    let saved = 0;
    for (const p of plan.books) {
      if (!p.add.length && !p.edit.length && !p.noteFill.length) continue;
      const src = lib.ensureSource({ id: p.book.id, kind: "book", title: p.book.title, author: p.book.author });
      for (const { id, item } of p.add) {
        if (src.highlights.some(h => h.id === id)) continue;
        src.highlights.push(lib.makeHighlight({ id, text: item.text, note: item.note, location: item.location, page: item.page, via: "kindle", created: item.created || undefined }));
        saved++;
      }
      for (const { id, item } of p.edit) {
        const h = src.highlights.find(x => x.id === id);
        if (!h) continue;
        h.text = item.text; h.location = item.location; h.page = item.page; if (item.note && !h.note) h.note = item.note;
        h.updated = new Date().toISOString(); saved++;
      }
      for (const { id, note } of p.noteFill) {
        const h = src.highlights.find(x => x.id === id);
        if (h && !h.noteEdited) { h.note = note; h.updated = new Date().toISOString(); saved++; }
      }
      lib.saveSource(src);
    }
    return saved;
  }

  return { parseClippings, buildBooks, planImport, applyImport, parseDate, splitTitle };
});
