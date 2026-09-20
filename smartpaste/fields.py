"""Finding the form's questions in a blob of pasted page text.

Two stages. Local heuristics propose candidate label lines -- cheap, and they
keep obvious prose out of the call. Then a Noul fan-out asks Jev which
candidates are really fields the applicant fills in. Wrong guesses here are
cheap: an extra question costs a few tokens and no extra wall time.
"""

from __future__ import annotations

import re

MAX_LABEL_LEN = 250
MAX_CANDIDATES = 60

# "Required" markers and trailing punctuation that are not part of the label.
_REQUIRED_SUFFIX = re.compile(
    r"\s*(?:\*+|\(required\)|\(optional\)|\brequired\b|\boptional\b)\s*$", re.I
)
_BULLET_PREFIX = re.compile(r"^\s*(?:[-*•·▪●‣]|\d+[.)])\s+")

# Lines that are navigation or page furniture, not questions.
_CHROME = frozenset(
    {
        "submit", "apply", "next", "back", "cancel", "save", "continue",
        "sign in", "log in", "upload", "attach", "browse", "choose file",
        "drag and drop", "autofill with greenhouse", "autofill", "clear",
        "yes", "no", "select...", "select", "please select",
    }
)


def normalize(line):
    line = _BULLET_PREFIX.sub("", line.strip())
    line = _REQUIRED_SUFFIX.sub("", line)
    return line.rstrip(":").strip()


def looks_like_label(line):
    if not (2 <= len(line) <= MAX_LABEL_LEN):
        return False
    if line.casefold() in _CHROME:
        return False
    if line.endswith("?"):
        return True
    # A trailing period means prose; labels do not end in one.
    if line.endswith("."):
        return False
    # Short, non-sentence lines on a form page are overwhelmingly labels.
    return len(line) <= 80


def candidate_labels(form_text, limit=MAX_CANDIDATES):
    """Heuristic first pass over pasted page text."""
    found = []
    seen = set()
    for raw in form_text.splitlines():
        label = normalize(raw)
        if not looks_like_label(label):
            continue
        key = label.casefold()
        if key in seen:
            continue
        seen.add(key)
        found.append(label)
        if len(found) >= limit:
            break
    return found


def confirm_questions(labels):
    """Noul per candidate: is this really a field the applicant fills in?"""
    from . import jev

    return {
        f"is_field_{i}": jev.noul(
            {
                "line": label,
                "ask": "This line is a labeled input field on a job application "
                "form that the applicant must fill in, not a heading, "
                "instruction, button, or page navigation.",
            }
        )
        for i, label in enumerate(labels)
    }


def keep_confirmed(labels, answers, threshold=0.5):
    kept = []
    for i, label in enumerate(labels):
        answer = answers.get(f"is_field_{i}")
        if answer is None or answer.get("noul", 0.0) >= threshold:
            kept.append(label)
    return kept
