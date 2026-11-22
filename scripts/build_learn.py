"""Builds the Learn tab (AI section) for the site.

Opens the sealed lessons (learn/lessons/*.json) and headline digests
(learn/headlines/*.json) with the key derived from NEWS_PASSWORD, works out
each lesson's release date from learn/course.json (one per weekday from the
start date), and writes everything password-encrypted like the news:

  site/learn.enc.json   lessons released so far, upcoming titles, headlines
  site/learn-status.json  counts only, no content
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # works with python -I too
from learn_crypto import encrypt, open_sealed, private_key, public_key_b64

ROOT = Path(__file__).resolve().parent.parent
LEARN = ROOT / "learn"
SITE = ROOT / "site"
HEADLINE_DIGESTS = 6   # newest digests to publish


def release_dates(start: date, count: int) -> list:
    """Lesson n (1-based) comes out on the nth weekday from the start date."""
    out, day = [], start
    while len(out) < count:
        if day.weekday() < 5:
            out.append(day)
        day += timedelta(days=1)
    return out


def main() -> int:
    password = os.environ.get("NEWS_PASSWORD", "")
    status_file = SITE / "learn-status.json"
    if not password:
        status_file.write_text(json.dumps({"configured": False}))
        print("NEWS_PASSWORD isn't set; Learn not built.")
        return 0

    public = public_key_b64(password)
    print(f"Learn public key: {public}")
    key_file = LEARN / "public-key.txt"
    if not key_file.exists() or key_file.read_text().strip() != public:
        print("WARNING: learn/public-key.txt doesn't match this password; new files can't be opened.")

    priv = private_key(password)
    course = json.loads((LEARN / "course.json").read_text())
    plan = course["lessons"]
    # "early" releases a lesson on a set date (e.g. a preview at the weekend);
    # the rest follow one per weekday from the start date.
    early = {int(n): date.fromisoformat(d) for n, d in course.get("early", {}).items()}
    weekdays = iter(release_dates(date.fromisoformat(course["start"]), len(plan) - len(early)))
    dates = [early[i + 1] if (i + 1) in early else next(weekdays) for i in range(len(plan))]
    today = datetime.now(timezone.utc).date()

    lessons, errors = [], []
    for path in sorted((LEARN / "lessons").glob("*.json")):
        try:
            lesson = open_sealed(json.loads(path.read_text()), priv)
            n = int(lesson["n"])
            lesson["release"] = dates[n - 1].isoformat()
            lesson["track"] = plan[n - 1]["track"]
            if dates[n - 1] <= today:
                lessons.append(lesson)
        except Exception as exc:  # one bad file shouldn't hide the rest
            errors.append(f"{path.name}: {type(exc).__name__}")
    lessons.sort(key=lambda l: l["n"])
    written = {int(p.stem) for p in (LEARN / "lessons").glob("*.json") if p.stem.isdigit()}

    upcoming = [{"n": i + 1, "title": p["title"], "track": p["track"], "release": dates[i].isoformat(),
                 "written": (i + 1) in written}
                for i, p in enumerate(plan) if dates[i] > today][:5]

    digests = []
    for path in sorted((LEARN / "headlines").glob("*.json"), reverse=True)[:HEADLINE_DIGESTS]:
        try:
            digests.append(open_sealed(json.loads(path.read_text()), priv))
        except Exception as exc:
            errors.append(f"{path.name}: {type(exc).__name__}")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {"updated": now, "tracks": course["tracks"], "total": len(plan),
               "lessons": lessons, "upcoming": upcoming, "headlines": digests}
    (SITE / "learn.enc.json").write_text(json.dumps(encrypt(payload, password)))
    status_file.write_text(json.dumps({"configured": True, "updated": now, "lessons": len(lessons),
                                       "headlines": len(digests), "errors": errors}))
    print(f"Learn: {len(lessons)} lessons released, {len(digests)} headline digests, errors: {errors or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
