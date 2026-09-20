"""What an applicant tracking system sees when it reads your resume.

Every check here answers one question: does the information survive the trip
through a PDF text extractor? A resume that looks right in Preview can still
arrive at a parser with its links missing or its contact line scrambled, and
nothing tells you -- the rejection looks the same as any other rejection.

The checks take already-extracted text and links, so they are testable without
a PDF. Only `inspect` touches the file.
"""

from __future__ import annotations

import re
from collections import namedtuple

OK, WARN, FAIL = "ok", "warn", "fail"

Finding = namedtuple("Finding", "level check message fix")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"\+?\d[\d\s().-]{5,}\d")
# Glyphs with no ToUnicode mapping; every extractor emits these as junk.
_UNMAPPED = re.compile(r"\(cid:\d+\)|[-]")

# Headings a parser uses to segment a resume. Missing ones are not fatal, but
# a parser that cannot find EXPERIENCE may not attribute your jobs to you.
_SECTIONS = {
    "education": ("education",),
    "experience": ("experience", "employment", "work history"),
    "skills": ("skills", "technical skills"),
    "projects": ("projects", "personal projects"),
}


def check_text_layer(text):
    stripped = text.strip()
    if len(stripped) < 200:
        return Finding(
            FAIL, "text layer",
            f"only {len(stripped)} characters of text -- this looks like a scan "
            "or an image-only export",
            "Export from the source document rather than printing to image; a "
            "parser cannot read pixels.",
        )
    return Finding(OK, "text layer", f"{len(stripped)} characters extracted", "")


def check_contact(text):
    found = []
    if _EMAIL.search(text):
        found.append("email")
    if _PHONE.search(text):
        found.append("phone")
    if len(found) == 2:
        return Finding(OK, "contact", "email and phone both in the text", "")
    missing = {"email", "phone"} - set(found)
    return Finding(
        WARN, "contact", f"no {' or '.join(sorted(missing))} found in the text layer",
        "Contact details set in an icon font are often unreadable. Write them "
        "as plain text.",
    )


def check_email_link(text, links):
    visible = sorted(set(_EMAIL.findall(text)))
    linked = sorted({u[7:] for u in links if u.lower().startswith("mailto:")})
    if not linked:
        return Finding(OK, "email link", "no mailto link to disagree with", "")
    if visible and set(linked) - set(visible):
        return Finding(
            FAIL, "email link",
            f"the mailto link points to {', '.join(linked)} but the page reads "
            f"{', '.join(visible)}",
            "Anyone who clicks your email reaches the wrong inbox. Fix the href.",
        )
    return Finding(OK, "email link", "link matches the visible address", "")


def _bare(url):
    """The part of a URL a reader would recognise: host plus path, no scheme."""
    return re.sub(r"^https?://(?:www\.)?", "", url).rstrip("/").lower()


def check_link_visibility(text, links):
    low = text.lower()
    hidden = [
        u for u in links
        if not u.lower().startswith("mailto:") and _bare(u) not in low
    ]
    if not hidden:
        return Finding(OK, "links", "every link also appears as text", "")
    return Finding(
        WARN, "links",
        f"{len(hidden)} link(s) exist only as annotations: "
        + ", ".join(_bare(u) for u in hidden),
        "A hyperlinked word like \"LinkedIn\" carries no URL in the text layer. "
        "Parsers that skip annotations see nothing. Print the URL itself.",
    )


def check_sections(text):
    low = text.lower()
    missing = [
        name for name, aliases in _SECTIONS.items()
        if not any(alias in low for alias in aliases)
    ]
    if not missing:
        return Finding(OK, "sections", "all standard headings present", "")
    level = FAIL if {"education", "experience"} & set(missing) else WARN
    return Finding(
        level, "sections", "no heading found for: " + ", ".join(missing),
        "Parsers split a resume on its headings. Use the conventional words.",
    )


def check_glyphs(text):
    hits = _UNMAPPED.findall(text)
    if not hits:
        return Finding(OK, "glyphs", "no unmapped characters", "")
    return Finding(
        WARN, "glyphs", f"{len(hits)} icon glyph(s) extract as junk",
        "Decorative icons without a ToUnicode map become noise next to your "
        "contact details. Harmless in isolation, but drop them if the line "
        "already reads as text.",
    )


def audit(text, links):
    return [
        check_text_layer(text),
        check_contact(text),
        check_email_link(text, links),
        check_link_visibility(text, links),
        check_sections(text),
        check_glyphs(text),
    ]


def inspect(path):
    """Extract text and links the way a parser would, then run every check."""
    try:
        from pdfminer.high_level import extract_text
    except ImportError as exc:
        raise RuntimeError(
            "sp doctor needs pdfminer.six (it models what a parser sees "
            "far better than pypdf): pip install pdfminer.six"
        ) from exc
    from pypdf import PdfReader

    text = extract_text(path)
    links = []
    for page in PdfReader(path).pages:
        for annot in page.get("/Annots", None) or []:
            try:
                action = annot.get_object().get("/A", None)
                uri = action.get("/URI", "") if action else ""
            except Exception:
                continue
            if uri and uri not in links:
                links.append(uri)
    return audit(text, links)
