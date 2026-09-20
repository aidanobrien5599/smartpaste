"""Orchestration: pasted form text in, resolved answers out."""

from __future__ import annotations

from . import answer as answer_mod
from . import fields, jev, profile


def _question_for(label, criteria):
    return jev.choice(
        {
            "field": label,
            "ask": "Which snippet from the applicant's resume contains the "
            "answer to this job application field? The snippet need not "
            "equal the answer exactly -- a contact line containing the "
            "email, or a full name containing the surname, is the right "
            "pick, because code extracts the exact substring afterwards. "
            "Choose the escape option only if no snippet contains it.",
        },
        criteria,
    )


def fill(form_text, prof, model=jev.DEFAULT_MODEL, _ask=None):
    """Answer every field found in `form_text`. Two calls: detect, then answer."""
    ask = _ask or jev.ask_batched
    snippets = prof["snippets"]
    state = {"resume_snippets": snippets}

    candidates = fields.candidate_labels(form_text)
    if not candidates:
        return []
    # Detection judges lines of the form, so the form is the context -- passing
    # the resume here asks the model to rate a form line against a CV.
    confirmed = fields.keep_confirmed(
        candidates, ask(form_text, fields.confirm_questions(candidates), model=model)
    )
    if not confirmed:
        return []

    criteria = profile.as_criteria(snippets)
    questions = {
        f"f{i}": _question_for(label, criteria)
        for i, label in enumerate(confirmed)
    }
    answers = ask(state, questions, model=model)

    return [
        answer_mod.resolve(label, answers[f"f{i}"], snippets)
        for i, label in enumerate(confirmed)
        if f"f{i}" in answers
    ]


def as_block(results):
    """The filled fields as a paste-ready block."""
    return "\n".join(
        f"{r['label']}: {r['value']}"
        for r in results
        if r["status"] in (answer_mod.AUTO_FILL, answer_mod.NEEDS_PICK) and r["value"]
    )
