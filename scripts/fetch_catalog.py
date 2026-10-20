"""Build the full video catalogue for each channel in channels.json.

Uses the YouTube Data API (YOUTUBE_API_KEY secret) to list every long-form
upload, with its duration and view count. Writes:

  site/catalog/index.json         channel names, ids and video counts
  site/catalog/<channel id>.json  every video: [id, title, published, seconds, views]

The catalogue is cached between runs (.cache/catalog), so normally only new
uploads are requested; view counts are refreshed weekly. A full first build
of ~20 channels uses a few hundred of the API's 10,000 free daily units.
The API key is never printed, since this repository's logs are public.
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CHANNELS_FILE = ROOT / "channels.json"
OUT = ROOT / "site" / "catalog"
CACHE = ROOT / ".cache" / "catalog"
API = "https://www.googleapis.com/youtube/v3"
STATS_MAX_AGE = timedelta(days=7)
SHORTS_MAX_SECONDS = 60   # only used if a channel's long-form playlist is unavailable

KEY = os.environ.get("YOUTUBE_API_KEY", "")
units_used = 0


class ApiError(Exception):
    pass


def api(endpoint: str, **params) -> dict:
    """GET from the API. Errors never include the URL, which holds the key."""
    global units_used
    units_used += 1
    try:
        resp = requests.get(f"{API}/{endpoint}", params={**params, "key": KEY}, timeout=30)
    except requests.RequestException as exc:
        raise ApiError(f"network error ({type(exc).__name__})") from None
    if resp.status_code != 200:
        try:
            reason = resp.json()["error"]["errors"][0]["reason"]
        except Exception:
            reason = "unknown"
        raise ApiError(f"HTTP {resp.status_code} ({reason})")
    return resp.json()


def seconds(iso_duration: str) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso_duration or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def playlist_pages(playlist_id: str):
    token = None
    while True:
        params = {"part": "snippet,contentDetails", "maxResults": 50, "playlistId": playlist_id}
        if token:
            params["pageToken"] = token
        data = api("playlistItems", **params)
        yield data.get("items", [])
        token = data.get("nextPageToken")
        if not token:
            return


def fetch_stats(ids: list) -> dict:
    stats = {}
    for i in range(0, len(ids), 50):
        data = api("videos", part="contentDetails,statistics", id=",".join(ids[i:i + 50]), maxResults=50)
        for item in data.get("items", []):
            stats[item["id"]] = (seconds(item.get("contentDetails", {}).get("duration")),
                                 int(item.get("statistics", {}).get("viewCount", 0) or 0))
    return stats


def update_channel(channel: dict, cache: dict) -> dict:
    """Bring one channel's cached catalogue up to date. Returns the cache."""
    channel_id = channel["id"]
    videos = cache.setdefault("videos", {})        # id -> [title, published, seconds, views]
    long_form = cache.get("long_form", True)
    playlist = ("UULF" if long_form else "UU") + channel_id[2:]

    def walk(playlist_id: str):
        new_ids, stopped_early = [], False
        for items in playlist_pages(playlist_id):
            for item in items:
                vid = item["contentDetails"]["videoId"]
                title = item["snippet"].get("title", "")
                if title in ("Private video", "Deleted video"):
                    continue
                if vid in videos and cache.get("complete"):
                    stopped_early = True
                    break
                if vid not in videos:
                    published = item["contentDetails"].get("videoPublishedAt") or item["snippet"].get("publishedAt", "")
                    videos[vid] = [title, published, 0, 0]
                    new_ids.append(vid)
            if stopped_early:
                break
        return new_ids

    try:
        new_ids = walk(playlist)
    except ApiError as exc:
        if long_form and "404" in str(exc):
            # No long-form playlist for this channel: use all uploads, drop Shorts below.
            cache["long_form"] = long_form = False
            new_ids = walk("UU" + channel_id[2:])
        else:
            raise
    cache["complete"] = True

    stale = datetime.fromisoformat(cache.get("stats_at", "2000-01-01T00:00:00+00:00")) < datetime.now(timezone.utc) - STATS_MAX_AGE
    to_refresh = list(videos) if stale else new_ids
    stats = fetch_stats(to_refresh)
    for vid, (secs, views) in stats.items():
        videos[vid][2], videos[vid][3] = secs, views
    if stale:
        cache["stats_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not long_form:
        for vid in [v for v, row in videos.items() if 0 < row[2] <= SHORTS_MAX_SECONDS]:
            del videos[vid]
    return cache


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if not KEY:
        print("YOUTUBE_API_KEY secret not set; skipping channel catalogue.")
        (OUT / "index.json").write_text(json.dumps({"configured": False, "channels": []}))
        return 0
    CACHE.mkdir(parents=True, exist_ok=True)
    channels = json.loads(CHANNELS_FILE.read_text())
    index, failures = [], 0
    for channel in channels:
        cache_file = CACHE / f"{channel['id']}.json"
        cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
        error = None
        try:
            cache = update_channel(channel, cache)
        except ApiError as exc:
            error = str(exc)
            failures += 1
        cache_file.write_text(json.dumps(cache))
        rows = sorted(([vid, *row] for vid, row in cache.get("videos", {}).items()),
                      key=lambda r: r[2], reverse=True)
        (OUT / f"{channel['id']}.json").write_text(json.dumps(
            {"name": channel["name"], "id": channel["id"], "videos": rows}, separators=(",", ":")))
        index.append({"name": channel["name"], "id": channel["id"], "count": len(rows), "error": error})
        print(f"{channel['name']}: {len(rows)} videos" + (f" (ERROR {error})" if error else ""))
    (OUT / "index.json").write_text(json.dumps({
        "configured": True,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "channels": index,
    }, indent=1))
    print(f"API units used this run: {units_used}")
    return 1 if failures == len(channels) else 0


if __name__ == "__main__":
    sys.exit(main())
