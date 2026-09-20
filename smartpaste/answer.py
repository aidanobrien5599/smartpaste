"""Turning Jev's probability distribution into something to paste.

Jev decides which snippet answers a field. Everything after that is ordinary
code: pulling the email out of a contact line, or the surname out of a resume
header, is a regex's job, and regexes do not hallucinate. Jev picks the right
line; this module extracts the right substring. It never invents either.
"""

from __future__ import annotations

import re

from .profile import NONE

# Above AUTO we paste silently; below MENU we do not offer a guess at all.
AUTO = 0.85
MENU = 0.40

AUTO_FILL = "auto"
NEEDS_PICK = "pick"
NO_ANSWER = "none"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"(?:https?://|www\.)\S+|(?:[\w-]+\.)+(?:com|io|dev|org|net|ai)/\S+")
_PHONE = re.compile(r"\+?\d[\d\s().-]{5,}\d")

# A phone number is defined by how many digits it carries, not how long the
# match is -- separators vary far too much to encode in the pattern.
_MIN_PHONE_DIGITS = 7

_MONTHS = (
    r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
    r"Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|"
    r"Spring|Summer|Fall|Autumn|Winter"
)
_DATE = re.compile(rf"(?:{_MONTHS})\.?\s+\d{{4}}|\d{{1,2}}/\d{{4}}|\b(?:19|20)\d{{2}}\b", re.I)

# Clauses a resume appends to a degree that a "Degree" field does not want.
_DEGREE_TAIL = re.compile(
    r"\s*[,;(]?\s*\b(?:expected|expecting|anticipated|graduating|grad(?:uation)?|"
    r"class of|in progress|gpa)\b.*$",
    re.I,
)
_GPA = re.compile(r"\d\.\d+\s*(?:/\s*\d(?:\.\d+)?)?")
# A resume glues the attendance range onto the institution: "Madison Sep 2023 - May 2027".
_TRAILING_RANGE = re.compile(
    rf"\s*(?:{_MONTHS})\.?\s*\d{{4}}\s*(?:[-\u2012-\u2015]\s*"
    rf"(?:(?:{_MONTHS})\.?\s*)?(?:\d{{4}}|present|current)\s*)?$",
    re.I,
)
_NAME_SUFFIX = frozenset({"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d."})


# A date range reads "Sep 2023 - May 2027": the graduation is the end of it.
_END_DATE_WORDS = ("graduation", "grad date", "completion", "end", "expected")


def _looks_like_a_name(snippet):
    if any(char.isdigit() for char in snippet) or "@" in snippet:
        return False
    return 1 < len(snippet.split()) <= 5


def _name_parts(snippet):
    parts = [p for p in snippet.split() if p.casefold().strip(",") not in _NAME_SUFFIX]
    # Resume headers are often set in all caps; restore normal casing.
    if snippet.isupper():
        parts = [p.title() for p in parts]
    return parts


def _first_name(snippet, label):
    return _name_parts(snippet)[0] if _looks_like_a_name(snippet) else None


def _last_name(snippet, label):
    return _name_parts(snippet)[-1] if _looks_like_a_name(snippet) else None


def _full_name(snippet, label):
    return " ".join(_name_parts(snippet)) if _looks_like_a_name(snippet) else None


def _matcher(pattern, min_digits=0):
    def extract(snippet, label):
        found = [
            value
            for match in pattern.finditer(snippet)
            for value in [match.group(0).strip().rstrip(".,;")]
            if not min_digits or sum(c.isdigit() for c in value) >= min_digits
        ]
        if not found:
            return None
        # "Sep 2023 - May 2027" answers a graduation date with its last value.
        if pattern is _DATE and any(word in label for word in _END_DATE_WORDS):
            return found[-1]
        return found[0]

    return extract


def _degree(snippet, label):
    trimmed = _DEGREE_TAIL.sub("", snippet).strip().rstrip(",;-")
    return trimmed or None


def _institution(snippet, label):
    trimmed = _TRAILING_RANGE.sub("", snippet).strip().rstrip(",;-")
    return trimmed or None


# Label keyword -> extractor, applied to the snippet Jev chose. Order matters:
# "first name" must be tested before the generic full-name rule.
_EXTRACTORS = (
    (("first name", "given name", "forename", "preferred name"), _first_name),
    (("last name", "surname", "family name"), _last_name),
    (("full name", "legal name", "your name"), _full_name),
    (("email", "e-mail"), _matcher(_EMAIL)),
    (("phone", "mobile", "telephone", "cell"), _matcher(_PHONE, _MIN_PHONE_DIGITS)),
    (
        ("graduation", "grad date", "start date", "available", "date"),
        _matcher(_DATE),
    ),
    (("gpa", "grade point"), _matcher(_GPA)),
    (("degree", "major", "discipline", "field of study"), _degree),
    (("school", "university", "college", "institution"), _institution),
    (
        ("website", "url", "link", "portfolio", "github", "linkedin", "twitter"),
        _matcher(_URL),
    ),
)


def refine(label, snippet):
    """Pull the exact value out of a snippet that holds more than the field wants."""
    low = label.casefold()
    for keywords, extract in _EXTRACTORS:
        if any(word in low for word in keywords):
            value = extract(snippet, low)
            if value:
                return value
            break
    return snippet


def resolve(label, answer, snippets, auto=AUTO, menu=MENU):
    """Classify one Jev answer into fill / pick / none, with ranked alternatives."""
    probabilities = answer.get("probabilities", {})
    ranked = [
        (snippets[key], probability)
        for key, probability in sorted(probabilities.items(), key=lambda kv: -kv[1])
        if key != NONE and key in snippets
    ]
    choice = answer.get("choice")
    confidence = float(answer.get("confidence", 0.0))

    if choice == NONE or choice not in snippets:
        return {
            "label": label,
            "status": NO_ANSWER,
            "value": None,
            "confidence": confidence,
            "alternatives": ranked[:3],
        }

    value = refine(label, snippets[choice])
    top = float(probabilities.get(choice, confidence))
    certainty = min(top, confidence)
    if certainty < menu:
        return {
            "label": label,
            "status": NO_ANSWER,
            "value": None,
            "confidence": certainty,
            "alternatives": ranked[:3],
        }
    return {
        "label": label,
        "status": AUTO_FILL if certainty >= auto else NEEDS_PICK,
        "value": value,
        "confidence": certainty,
        "alternatives": ranked[:3],
    }
