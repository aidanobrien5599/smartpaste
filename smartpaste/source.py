"""Getting resume text in, from the clipboard or a file.

PDF is the common case -- almost nobody keeps their resume as plain text -- so
`sp init --file` accepts one. pypdf is an optional dependency: everything else
in this package is stdlib, and clipboard input still works without it.
"""

from __future__ import annotations

import os
import re
import unicodedata

from . import clipboard

# Resume headers set contact details in an icon font, so the glyphs arrive as
# private-use codepoints or arbitrary dingbats wrapped around the real value.
_GLYPHS = re.compile(r"[\ue000-\uf8ff\u2190-\u2bff\u2600-\u27bf]+")

_MONTHS = (
    "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|"
    "January|February|March|April|June|July|August|September|October|"
    "November|December"
)
# PDF kerning drops the space before a date: "MadisonSep 2023", "InternMay 2026".
_GLUED_DATE = re.compile(rf"(?<=[a-z])(?=(?:{_MONTHS})\b)")
# ...and inside all-caps names: "AIDANO'BRIEN" -> "AIDAN O'BRIEN".
_GLUED_NAME = re.compile(r"(?<=[A-Z]{2})(?=[A-Z][\u2019'][A-Z])")
# What is left of an icon glyph once the font mapping is gone: a slash and a
# few stray lowercase letters welded to the real value ("/gtbGithub").
_G = "\ue000-\uf8ff\u2190-\u2bff\u2600-\u27bf"
# Debris always carries at least one lowercase letter. Without that floor the
# pattern matches a bare slash and eats the one in "TCP/IP" or "3.9/4.00".
_GLYPH_RESIDUE = re.compile(
    rf"/(?:[a-z]{{1,4}}[{_G}]?[a-z]{{0,4}}|[{_G}][a-z]{{1,4}})(?=[A-Z0-9])"
)


def _strip_glyphs(text):
    """Drop icon-font debris wherever it appears, including mid-line after a
    separator -- which is exactly where a resume's contact row puts it."""
    # PDF fonts emit ligatures as single codepoints: "identiﬁes" reaches a
    # keyword search as one unsearchable glyph unless it is decomposed.
    text = unicodedata.normalize("NFKC", text)
    lines = []
    for line in text.splitlines():
        line = _GLYPH_RESIDUE.sub("", line)
        line = _GLYPHS.sub(" ", line)
        line = re.sub(r"\(cid:\d+\)", "", line)
        lines.append(re.sub(r"[ \t]{2,}", " ", line).strip())
    return "\n".join(lines)


def _repair(text):
    """Undo the damage a PDF's layout does to a resume's text layer."""
    lines = []
    for line in text.splitlines():
        line = _GLYPHS.sub(" ", line)
        line = _GLYPH_RESIDUE.sub("", line)
        line = _GLUED_DATE.sub(" ", line)
        line = _GLUED_NAME.sub(" ", line)
        lines.append(re.sub(r"[ \t]{2,}", " ", line).strip())
    return "\n".join(lines)


def _annotation_links(reader):
    """Recover hyperlinks, which live in annotations and never in the text layer."""
    seen, links = set(), []
    for page in reader.pages:
        for annot in page.get("/Annots", None) or []:
            try:
                action = annot.get_object().get("/A", None)
                uri = action.get("/URI", "") if action else ""
            except Exception:
                continue
            if uri and uri not in seen and not uri.startswith("mailto:"):
                seen.add(uri)
                links.append(uri)
    return links


class SourceError(RuntimeError):
    pass


def _read_pdf_pdfminer(path):
    """Preferred reader. pdfminer does real layout analysis, so it keeps the
    spaces pypdf drops -- "AIDAN O'BRIEN", not "AIDANO'BRIEN"."""
    from pdfminer.high_level import extract_text

    return extract_text(path)


def _read_pdf(path):
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise SourceError(
            f"Reading {os.path.basename(path)} needs pypdf: pip install pypdf\n"
            "Or copy the resume text and run `sp init` with no --file."
        ) from exc
    try:
        reader = PdfReader(path)
        links = _annotation_links(reader)
        try:
            text = _read_pdf_pdfminer(path)
        except ImportError:
            # Fall back to pypdf, which needs the repairs in _repair() to undo
            # the spaces its weaker layout analysis drops.
            text = _repair("\n".join(page.extract_text() or "" for page in reader.pages))
    except Exception as exc:
        raise SourceError(f"Could not read {path}: {exc}") from exc
    text = _strip_glyphs(text) + "\n" + "\n".join(links)
    if len(text.strip()) < 80:
        raise SourceError(
            f"{os.path.basename(path)} yielded almost no text -- it is probably a "
            "scan. Copy the text manually and run `sp init` with no --file."
        )
    return text


def resume_text(path=None):
    """Resume text from `path` if given, otherwise from the clipboard."""
    if path is None:
        text = clipboard.read()
        if len(text.strip()) < 80:
            raise SourceError(
                "Clipboard does not look like a resume. Copy it and re-run "
                "`sp init`, or pass `sp init --file resume.pdf`."
            )
        return text

    path = os.path.expanduser(path)
    if not os.path.exists(path):
        raise SourceError(f"No such file: {path}")
    if path.lower().endswith(".pdf"):
        return _read_pdf(path)
    with open(path, errors="replace") as handle:
        return handle.read()
