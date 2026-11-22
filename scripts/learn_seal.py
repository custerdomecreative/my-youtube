"""Seal a lesson or a headline digest for the Learn tab, using learn/public-key.txt.

  python scripts/learn_seal.py lesson PATH.md      -> learn/lessons/NNN.json
  python scripts/learn_seal.py headlines PATH.json -> learn/headlines/YYYY-MM-DD.json

Keep the plain versions out of the repository (it's public).

Lesson files are a small header, then the lesson in simple Markdown:

    n: 1
    title: What a language model actually does
    minutes: 7
    ---
    Paragraphs, "## Heading", "- bullet" lists, ``` code blocks ```,
    **bold** and `code` inline.
    ===check===
    Q: A question?
    A: Its answer.
    ===sources===
    - Title | https://example.com

Headline digests are JSON:
    {"date": "2026-11-23", "intro": "...", "items": [
      {"title": "...", "source": "...", "url": "https://...", "summary": "...", "why": "..."}]}
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # works with python -I too
from learn_crypto import seal

ROOT = Path(__file__).resolve().parent.parent
LEARN = ROOT / "learn"


def blocks_from_markdown(text: str) -> list:
    blocks, para, items, code = [], [], [], None
    def flush():
        nonlocal para, items
        if para:
            blocks.append({"p": " ".join(para)}); para = []
        if items:
            blocks.append({"ul": items}); items = []
    for line in text.splitlines():
        if code is not None:
            if line.strip().startswith("```"):
                blocks.append({"code": "\n".join(code)}); code = None
            else:
                code.append(line)
            continue
        s = line.strip()
        if s.startswith("```"):
            flush(); code = []
        elif not s:
            flush()
        elif s.startswith("## "):
            flush(); blocks.append({"h": s[3:].strip()})
        elif re.match(r"^[-*] ", s):
            if para:
                blocks.append({"p": " ".join(para)}); para = []
            items.append(s[2:].strip())
        elif items and line.startswith("  "):
            items[-1] += " " + s           # continuation of a bullet
        else:
            if items:
                blocks.append({"ul": items}); items = []
            para.append(s)
    flush()
    return blocks


def parse_lesson(text: str) -> dict:
    head, _, rest = text.partition("\n---\n")
    meta = dict(line.split(":", 1) for line in head.strip().splitlines())
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    body, _, tail = rest.partition("===check===")
    check_text, _, sources_text = tail.partition("===sources===")
    check = [{"q": q.strip(), "a": a.strip()}
             for q, a in re.findall(r"Q:\s*(.+?)\s*\nA:\s*(.+?)(?=\nQ:|\Z)", check_text.strip(), re.S)]
    sources = []
    for line in sources_text.strip().splitlines():
        if "|" in line:
            title, url = line.lstrip("-* ").rsplit("|", 1)
            if not url.strip().startswith("https://"):
                sys.exit(f"Source URL must be https: {url.strip()}")
            sources.append({"title": title.strip(), "url": url.strip()})
    lesson = {"n": int(meta["n"]), "title": meta["title"], "minutes": int(meta.get("minutes", 7)),
              "body": blocks_from_markdown(body), "check": check, "sources": sources}
    if not lesson["body"] or not check or not sources:
        sys.exit("A lesson needs a body, at least one Q/A and at least one source.")
    return lesson


def main() -> int:
    kind, path = sys.argv[1], Path(sys.argv[2])
    public = (LEARN / "public-key.txt").read_text().strip()
    if kind == "lesson":
        lesson = parse_lesson(path.read_text())
        out = LEARN / "lessons" / f"{lesson['n']:03d}.json"
    elif kind == "headlines":
        lesson = json.loads(path.read_text())
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", lesson.get("date", "")) or not lesson.get("items"):
            sys.exit("A digest needs a date (YYYY-MM-DD) and items.")
        for item in lesson["items"]:
            if not str(item.get("url", "")).startswith("https://"):
                sys.exit(f"Headline URL must be https: {item.get('url')}")
        out = LEARN / "headlines" / f"{lesson['date']}.json"
    else:
        sys.exit("Usage: learn_seal.py lesson|headlines PATH")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(seal(lesson, public)))
    print(f"Sealed {path.name} -> {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
