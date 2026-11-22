"""Collects recent AI headlines from headline-feeds.json for the Learn tab.

Writes headline-candidates/candidates.json: titles, links and short feed
summaries from the last few days (no article text). The Mon/Wed/Fri
headlines task reads it, picks the five that matter most and writes them up.
Feeds marked "filter" (general pharma or tech news) only keep stories that
mention AI, or one of the feed's own extra keywords.
"""
import calendar
import html
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests

ROOT = Path(__file__).resolve().parent.parent
FEEDS_FILE = ROOT / "headline-feeds.json"
OUT = ROOT / "headline-candidates" / "candidates.json"
MAX_AGE = timedelta(hours=80)   # Monday's run covers the weekend
PER_FEED = 15
AI_WORDS = re.compile(r"\b(AI|A\.I\.|artificial intelligence|machine learning|LLMs?|generative|GenAI|ChatGPT|Claude|"
                      r"Gemini|Copilot|OpenAI|Anthropic|DeepMind|neural|deep learning|agentic|chatbot|algorithm)\b")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def clean(text: str, limit: int = 300) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def main() -> int:
    feeds = json.loads(FEEDS_FILE.read_text())
    now = datetime.now(timezone.utc)
    items, report = [], []
    for feed in feeds:
        try:
            res = requests.get(feed["url"], headers={"User-Agent": UA}, timeout=30)
            res.raise_for_status()
            parsed = feedparser.parse(res.content)
            if not parsed.version:
                raise ValueError("not a feed")
        except Exception as exc:
            report.append({"name": feed["name"], "kept": 0, "error": f"{type(exc).__name__}: {str(exc)[:80]}"})
            print(f"{feed['name']}: ERROR {type(exc).__name__}: {str(exc)[:80]}")
            continue
        extra = re.compile(feed["keywords"], re.I) if feed.get("keywords") else None
        kept = 0
        for e in parsed.entries:
            stamp = e.get("published_parsed") or e.get("updated_parsed")
            when = datetime.fromtimestamp(calendar.timegm(stamp), timezone.utc) if stamp else None
            if not when or now - when > MAX_AGE:
                continue
            title, summary = clean(e.get("title", ""), 200), clean(e.get("summary", ""))
            if feed.get("filter") and not (AI_WORDS.search(f"{title} {summary}")
                                           or (extra and extra.search(f"{title} {summary}"))):
                continue
            items.append({"source": feed["name"], "group": feed.get("group", ""), "title": title,
                          "url": e.get("link", ""), "published": when.isoformat(timespec="minutes"),
                          "summary": summary})
            kept += 1
            if kept >= PER_FEED:
                break
        report.append({"name": feed["name"], "kept": kept, "error": None})
        print(f"{feed['name']}: {kept} kept of {len(parsed.entries)} ({parsed.version})")
    items.sort(key=lambda i: i["published"], reverse=True)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"gathered": now.isoformat(timespec="minutes"), "feeds": report,
                               "items": items}, indent=1, ensure_ascii=False))
    print(f"Wrote {len(items)} candidates")
    return 0 if items else 1


if __name__ == "__main__":
    sys.exit(main())
