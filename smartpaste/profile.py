"""Your answers, as a flat library of atomic snippets.

A resume is already a list of atomic facts, one per line, so splitting it needs
no extraction model at all -- which matters, because Jev cannot emit strings.
It can only *select* among options you give it. The snippets are those options.
"""

from __future__ import annotations

import json
import os
import re

CONFIG_DIR = os.path.expanduser("~/.config/smartpaste")
PROFILE_PATH = os.path.join(CONFIG_DIR, "profile.json")

# A Choice takes at most 255 options and one slot goes to the "none" escape.
MAX_SNIPPETS = 254

NONE = "__none__"

# Bullet glyphs and inline separators that delimit facts on a single resume line.
_SPLIT = re.compile(r"\s*(?:[|•·▪●‣]|\s[–—]\s)\s*")
_BULLET_PREFIX = re.compile(r"^\s*(?:[-*•·▪●‣]|\d+[.)])\s+")

# Fields a resume never contains but applications always ask for. Phrase each
# answer as a complete statement -- these become Choice options alongside every
# resume line, and a bare "June 2027" cannot be told apart from a grad date.
SUPPLEMENTARY = {
    "work_auth": "",
    "sponsorship": "",
    "start_date": "",
    "pronouns": "",
    "why_us": "",
    "salary_expectation": "",
}

EXAMPLES = {
    "work_auth": "Yes, I am legally authorized to work in the United States",
    "sponsorship": "No, I will not require visa sponsorship now or in the future",
    "start_date": "Available to start full-time in June 2027",
    "pronouns": "he/him",
    "why_us": "Two or three sentences you are happy to reuse",
    "salary_expectation": "Negotiable / open to discussion",
}


def snippets_from_resume(text, max_snippets=MAX_SNIPPETS):
    """Split raw resume text into atomic, deduplicated snippets."""
    found = []
    seen = set()
    for line in text.splitlines():
        line = _BULLET_PREFIX.sub("", line.strip())
        if not line:
            continue
        for part in _SPLIT.split(line):
            part = part.strip().strip(",;")
            # Single characters and bare section headings carry no answer.
            if len(part) < 2:
                continue
            key = part.casefold()
            if key in seen:
                continue
            seen.add(key)
            found.append(part)
            if len(found) >= max_snippets:
                return {f"s{i:03d}": s for i, s in enumerate(found, 1)}
    return {f"s{i:03d}": s for i, s in enumerate(found, 1)}


def as_criteria(snippets):
    """Snippets as Choice options, plus the escape hatch that stops invention."""
    criteria = dict(snippets)
    criteria[NONE] = "None of the snippets answers this field"
    return criteria


def load(path=PROFILE_PATH):
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No profile at {path}. Run `sp init` with your resume on the clipboard."
        )
    with open(path) as handle:
        data = json.load(handle)
    if not data.get("snippets"):
        raise ValueError(f"Profile at {path} has no snippets. Re-run `sp init`.")
    return data


def save(data, path=PROFILE_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        json.dump(data, handle, indent=2)
    os.chmod(path, 0o600)
    return path
