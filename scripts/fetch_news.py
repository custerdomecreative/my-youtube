"""Build the private news feed for the News page.

Reads feeds.json, collects recent stories from each RSS feed, extracts the
readable article text for sources marked "fulltext", then encrypts the
result with the NEWS_PASSWORD secret before it is published:

  site/news.enc.json  encrypted stories (unreadable without the password)
  site/status.json    per-source counts and errors only, no story content

Article text is cached between runs (.cache/articles) so each story is
downloaded once. Nothing from the articles is ever printed to the log,
because this repository's Actions logs are public.
"""

import base64
import hashlib
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import feedparser
import requests
import trafilatura
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
FEEDS_FILE = ROOT / "feeds.json"
SITE = ROOT / "site"
CACHE = ROOT / ".cache" / "articles"

MAX_PER_SOURCE = 25        # newest stories kept per source
MAX_AGE_HOURS = 48         # older stories drop off the page
MAX_NEW_FETCHES = 150      # article downloads per run, all sources
FETCH_DELAY = 1.0          # seconds between article downloads
# Must match news.html. The salt isn't secret; it just has to stay fixed so
# a device that has unlocked the page once stays unlocked.
KDF_SALT = b"my-youtube-news-v1"
KDF_ITERATIONS = 250_000

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en-IE,en;q=0.9",
})
# Pages that aren't a single article (live blogs, video pages, galleries).
SKIP_FULLTEXT = re.compile(r"/(live|videos?|av|watch|gallery|pictures|in-pictures)/", re.I)


def strip_tags(text: str, limit: int = 420) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def published(entry) -> datetime | None:
    for key in ("published", "updated", "created"):
        value = entry.get(key)
        if not value:
            continue
        try:
            dt = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def image_for(entry) -> str:
    for key in ("media_thumbnail", "media_content"):
        for media in entry.get(key) or []:
            url = media.get("url", "")
            if url and ("image" in media.get("type", "image") or key == "media_thumbnail"):
                return url
    for link in entry.get("links", []):
        if link.get("rel") == "enclosure" and link.get("type", "").startswith("image"):
            return link.get("href", "")
    match = re.search(r'<img[^>]+src="([^"]+)"', entry.get("summary", "") or "")
    return match.group(1) if match else ""


IMAGE = re.compile(r"!\[(.*?)\]\((\S+?)\)")
HEADING_LINE = re.compile(r"^#{1,6}\s+(.*)$")
LIST_MARKER = re.compile(r"^(?:[-*+]|\d+[.)])\s+")
JUNK_IMAGE = re.compile(r"placeholder|pixel|spacer|1x1|logo|icon|\.svg|\.gif|^data:", re.I)
# Page furniture that extraction sometimes keeps: timestamp labels, share
# buttons, picture credits. Matched against a whole line.
JUNK_LINE = re.compile(
    r"^(published|updated|share|save|listen|watch|close|advertisement|related topics|"
    r"more on this story|top stories|features|most read|getty images|reuters|pa media|epa|afp)\.?$"
    r"|^(image source|image caption|media caption|video caption|copyright)\s*[,:]"
    r"|^\d+ (minutes?|mins?|hours?|hrs?|days?) ago$"
    r"|^\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* \d{4}$",
    re.I)


def unescape(text: str) -> str:
    return re.sub(r"\\([\\`*_{}\[\]()#+\-.!>])", r"\1", text)


def to_blocks(markdown: str) -> list:
    """Article markdown -> list of blocks: a string is a paragraph,
    {"img": url, "alt": text} an image, {"h": text} a subheading."""
    blocks, seen = [], set()
    for raw in markdown.split("\n"):
        line = raw.strip()
        if not line:
            continue
        heading = HEADING_LINE.match(line)
        if heading:
            if blocks:  # a heading before any text is just the headline again
                blocks.append({"h": unescape(heading.group(1).strip())})
            continue
        is_item = bool(LIST_MARKER.match(line))
        line = LIST_MARKER.sub("", line)
        # A line that is only images (photo galleries come through as lists).
        images = IMAGE.findall(line)
        if images and not IMAGE.sub("", line).strip():
            for alt, src in images:
                if src.startswith("http") and not JUNK_IMAGE.search(src) and src not in seen:
                    seen.add(src)
                    blocks.append({"img": src, "alt": unescape(alt.strip())})
            continue
        line = unescape(IMAGE.sub("", line)).strip()
        if line and not JUNK_LINE.search(line):
            blocks.append(f"• {line}" if is_item else line)
    return blocks


def article_text(url: str, story_id: str, budget: list) -> list | None:
    """Readable blocks for one article. The raw extracted markdown is cached,
    so changes to to_blocks() apply without downloading articles again."""
    path = CACHE / f"{story_id}.v3.json"
    if path.exists():
        markdown = json.loads(path.read_text()).get("markdown")
    else:
        if budget[0] <= 0:
            return None  # try again next run
        budget[0] -= 1
        markdown = None
        try:
            time.sleep(FETCH_DELAY)
            resp = SESSION.get(url, timeout=25)
            resp.raise_for_status()
            markdown = trafilatura.extract(resp.text, url=url, output_format="markdown",
                                           include_images=True, include_links=False,
                                           include_comments=False, include_tables=False,
                                           favor_precision=True)
        except Exception:
            markdown = None
        path.write_text(json.dumps({"markdown": markdown}))
    if not markdown:
        return None
    blocks = to_blocks(markdown)
    prose = [b for b in blocks if isinstance(b, str)]
    return blocks if len(prose) >= 3 and sum(len(x) for x in prose) >= 400 else None


def collect(source: dict, cutoff: datetime, budget: list) -> tuple[list, dict]:
    status = {"name": source["name"], "stories": 0, "fulltext": 0, "error": None}
    resp = SESSION.get(source["url"], timeout=25)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    if not feed.entries:
        raise ValueError("feed had no stories")
    stories = []
    for entry in feed.entries:
        link = entry.get("link", "")
        when = published(entry)
        if not link or (when and when < cutoff):
            continue
        story_id = hashlib.sha1(link.split("?")[0].encode()).hexdigest()[:16]
        story = {
            "id": story_id,
            "source": source["name"],
            "title": strip_tags(entry.get("title", ""), 300),
            "link": link,
            "published": when.isoformat() if when else "",
            "summary": strip_tags(entry.get("summary", "")),
            "image": image_for(entry),
            "text": None,
        }
        if source.get("fulltext") and not SKIP_FULLTEXT.search(link):
            story["text"] = article_text(link, story_id, budget)
            if story["text"]:
                status["fulltext"] += 1
        stories.append(story)
        if len(stories) >= MAX_PER_SOURCE:
            break
    status["stories"] = len(stories)
    return stories, status


def encrypt(payload: dict, password: str) -> dict:
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=KDF_SALT,
                     iterations=KDF_ITERATIONS).derive(password.encode())
    iv = os.urandom(12)
    data = AESGCM(key).encrypt(iv, json.dumps(payload).encode(), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "iterations": KDF_ITERATIONS, "salt": b64(KDF_SALT), "iv": b64(iv), "data": b64(data)}


def main() -> int:
    password = os.environ.get("NEWS_PASSWORD", "")
    now = datetime.now(timezone.utc)
    SITE.mkdir(exist_ok=True)
    if not password:
        print("NEWS_PASSWORD secret not set; skipping news.")
        (SITE / "status.json").write_text(json.dumps(
            {"updated": now.isoformat(timespec="seconds"), "configured": False, "sources": []}, indent=2))
        return 0

    CACHE.mkdir(parents=True, exist_ok=True)
    cutoff = now - timedelta(hours=MAX_AGE_HOURS)
    budget = [MAX_NEW_FETCHES]
    stories, statuses = [], []
    for source in json.loads(FEEDS_FILE.read_text()):
        try:
            found, status = collect(source, cutoff, budget)
            stories.extend(found)
        except Exception as exc:
            status = {"name": source["name"], "stories": 0, "fulltext": 0,
                      "error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        statuses.append(status)
        print(f"{status['name']}: {status['stories']} stories, "
              f"{status['fulltext']} with full text" + (f", ERROR {status['error']}" if status["error"] else ""))

    stories.sort(key=lambda s: s["published"], reverse=True)
    updated = now.isoformat(timespec="seconds")
    (SITE / "news.enc.json").write_text(json.dumps(encrypt({"updated": updated, "stories": stories}, password)))
    (SITE / "status.json").write_text(json.dumps(
        {"updated": updated, "configured": True, "sources": statuses}, indent=2))

    # Drop cached articles that have aged out.
    keep = {s["id"] for s in stories}
    for path in CACHE.glob("*.json"):
        if path.name.split(".")[0] not in keep and path.stat().st_mtime < time.time() - 4 * 86400:
            path.unlink()
    return 1 if statuses and all(s["error"] for s in statuses) else 0


if __name__ == "__main__":
    sys.exit(main())
