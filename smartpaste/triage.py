"""Scoring a job posting against your own criteria.

Same call shape as autofill, different questions. The point is the routing
decision at the end: cold-applying to a posting that will never read your
resume is the expensive mistake this is meant to catch.
"""

from __future__ import annotations

from . import jev

APPLY, WARM, SKIP = "apply", "warm_intro", "skip"

DEFAULT_CRITERIA = {
    "graduating": "May 2027",
    "needs_sponsorship": False,
    "wants": "small, early-stage startups where shipped work reaches users quickly",
}


def questions(criteria):
    return {
        "eligible": jev.noul(
            {
                "applicant": criteria,
                "ask": "This posting is open to a new graduate with no full-time "
                "industry experience, graduating in the stated term.",
            }
        ),
        "sponsorship_blocked": jev.noul(
            {
                "applicant": criteria,
                "ask": "This posting would exclude THIS applicant on work "
                "authorization grounds -- for example it requires a "
                "citizenship or clearance they do not have, or it refuses "
                "sponsorship and they need it. A posting that refuses "
                "sponsorship does NOT exclude an applicant who needs none.",
            }
        ),
        "stage": jev.choice(
            "What stage is the hiring company at",
            {
                "seed": "Pre-seed or seed, roughly under 30 people",
                "early": "Series A/B, roughly 30-200 people",
                "late": "Series C+ or pre-IPO, several hundred to a few thousand",
                "public": "Large public company",
                "unclear": "The posting does not say",
            },
        ),
        "fit": jev.score(
            {
                "prefers": criteria.get("wants", DEFAULT_CRITERIA["wants"]),
                "ask": "How well the role matches what the applicant wants",
            },
            [
                "Wrong kind of work entirely",
                "Adjacent, some overlap",
                "Solidly in the target",
                "Exactly the kind of role described",
            ],
        ),
        "volume": jev.score(
            "How many applicants this posting will likely draw, judged from the "
            "company's visibility and how broadly the role is written",
            [
                "Niche, a handful of applicants",
                "Moderate",
                "High, hundreds",
                "Flooded, thousands per opening",
            ],
        ),
    }


def route(answers, contacts=0):
    """Turn the scores into one recommendation. The weights live here, in code."""
    if answers["sponsorship_blocked"]["noul"] >= 0.5:
        return SKIP, "excluded by work-authorization requirements"
    if answers["eligible"]["noul"] < 0.4:
        return SKIP, "not open to new graduates"
    if answers["fit"]["score"] < 1:
        return SKIP, "not the kind of work you want"
    if contacts:
        return WARM, f"you know {contacts} {'person' if contacts == 1 else 'people'} here"
    if answers["volume"]["score"] >= 2:
        return WARM, "cold applications drown at this volume -- find an intro"
    return APPLY, "eligible, on-target, and not flooded"


def triage(posting, prof, model=jev.DEFAULT_MODEL, _ask=None):
    ask = _ask or jev.ask_batched
    criteria = {**DEFAULT_CRITERIA, **prof.get("triage", {})}
    answers = ask(posting, questions(criteria), model=model)
    contacts = _contacts_at(posting, prof)
    decision, why = route(answers, contacts)
    return {"answers": answers, "decision": decision, "why": why}


def _contacts_at(posting, prof):
    """Count known contacts whose company name appears in the posting."""
    low = posting.casefold()
    return sum(
        len(people)
        for company, people in prof.get("network", {}).items()
        if company.casefold() in low
    )
