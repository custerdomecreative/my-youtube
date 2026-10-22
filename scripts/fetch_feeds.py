"""Fetch the latest long-form uploads for the channels in channels.json.

Writes site/videos.json, which the web page reads. Standard library only.
Each channel needs a "name" plus either an "id" (starts with UC) or a
"handle" (like "@SpawnWave"), which is resolved to an id on each run.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANNELS_FILE = ROOT / "channels.json"
OUTPUT_FILE = ROOT / "site" / "videos.json"

MAX_PER_CHANNEL = 8      # newest videos kept per channel
MAX_AGE_DAYS = 45        # older videos drop off the page

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (personal feed reader)",
    "Accept-Language": "en",
    # Skips the EU cookie-consent interstitial if the runner hits it.
    "Cookie": "CONSENT=YES+1; SOCS=CAI",
}


PUBLISHED = "https://custerdomecreative.github.io/my-youtube/videos.json"


def get(url: str, attempts: int = 3) -> str:
    """GET with retries: YouTube's feeds have brief outages."""
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            if exc.code == 404 or attempt == attempts - 1:
                raise
        except Exception:
            if attempt == attempts - 1:
                raise
        time.sleep(3 * (attempt + 1))


def previous_list() -> dict:
    """The currently published list, used for any channel that fails."""
    try:
        req = urllib.request.Request(f"{PUBLISHED}?t={int(time.time())}", headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        print(f"Couldn't load the published list ({type(exc).__name__})", file=sys.stderr)
        return {}


def resolve_handle(handle: str) -> str:
    html = get(f"https://www.youtube.com/{handle.lstrip('/')}")
    for pattern in (
        r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"',
        r'"externalId":"(UC[\w-]{22})"',
        r'"channelId":"(UC[\w-]{22})"',
    ):
        match = re.search(pattern, html)
        if match:
            return match.group(1)
    raise ValueError(f"Couldn't find a channel id for {handle}")


def parse_feed(xml_text: str, channel_name: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    videos = []
    for entry in root.findall("atom:entry", NS):
        video_id = entry.findtext("yt:videoId", namespaces=NS)
        link = entry.find("atom:link", NS)
        href = link.get("href", "") if link is not None else ""
        if not video_id or "/shorts/" in href:
            continue
        thumb = entry.find("media:group/media:thumbnail", NS)
        videos.append({
            "id": video_id,
            "title": entry.findtext("atom:title", default="", namespaces=NS),
            "channel": channel_name,
            "published": entry.findtext("atom:published", default="", namespaces=NS),
            "thumbnail": thumb.get("url") if thumb is not None
                         else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        })
    return videos


def fetch_channel(channel: dict) -> list[dict]:
    name = channel["name"]
    channel_id = channel.get("id") or resolve_handle(channel["handle"])
    # "UULF" is the channel's long-form uploads playlist: no Shorts or live
    # streams. Fall back to the full channel feed if it isn't available.
    try:
        xml_text = get("https://www.youtube.com/feeds/videos.xml"
                       f"?playlist_id=UULF{channel_id[2:]}")
    except Exception:
        xml_text = get("https://www.youtube.com/feeds/videos.xml"
                       f"?channel_id={channel_id}")
    return parse_feed(xml_text, name)[:MAX_PER_CHANNEL]


def main() -> int:
    channels = json.loads(CHANNELS_FILE.read_text())
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    videos, errors = [], []
    previous = None

    for channel in channels:
        try:
            found = fetch_channel(channel)
            print(f"{channel['name']}: {len(found)} videos")
            videos.extend(found)
        except Exception as exc:  # one broken channel shouldn't sink the rest
            print(f"{channel['name']}: FAILED ({exc}); keeping its previous videos", file=sys.stderr)
            errors.append(channel["name"])
            if previous is None:
                previous = previous_list()
            videos.extend(v for v in previous.get("videos", []) if v.get("channel") == channel["name"])

    videos = [v for v in videos
              if not v["published"]
              or datetime.fromisoformat(v["published"]) >= cutoff]
    videos.sort(key=lambda v: v["published"], reverse=True)

    all_failed = bool(channels) and len(errors) == len(channels)
    if all_failed and not (previous or {}).get("videos"):
        print("Every channel failed and there's no previous list to fall back on.", file=sys.stderr)
        return 1
    # If nothing could be fetched, keep the old timestamp so pages know the
    # list is stale and try again.
    updated = (previous or {}).get("updated") if all_failed else None
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps({
        "updated": updated or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "errors": errors,
        "videos": videos,
    }, indent=2))
    print(f"Wrote {len(videos)} videos to {OUTPUT_FILE.relative_to(ROOT)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
