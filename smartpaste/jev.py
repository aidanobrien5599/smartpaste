"""Thin client for the TypeSafe System One API (Jev).

Stdlib only. The API is a single POST: you send `state` plus a map of typed
questions, and get back one answer per question. Questions are evaluated in
parallel, so asking twenty costs about as much wall time as asking one.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"

# No documented cap on questions per call, so batch conservatively.
BATCH_SIZE = 24


class JevError(RuntimeError):
    pass


class MissingKey(JevError):
    pass


def choice(instructions, criteria):
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def score(instructions, criteria):
    return {"type": "score", "instructions": instructions, "criteria": criteria}


def noul(instructions):
    return {"type": "noul", "instructions": instructions}


def api_key():
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        raise MissingKey(
            "TYPESAFE_API_KEY is not set. Get a key at "
            "https://console.typesafe.ai/keys and export it in your shell."
        )
    return key


def ask(state, questions, model=DEFAULT_MODEL, timeout=30, attempts=4):
    """POST one batch of questions. Retries 429 and 5xx with backoff."""
    if not questions:
        return {}
    payload = json.dumps(
        {"state": state, "model": model, "questions": questions}
    ).encode()
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
        },
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())["answers"]
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(2**attempt * 0.5)
                continue
            detail = exc.read().decode(errors="replace")[:400]
            raise JevError(f"TypeSafe API returned {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            if attempt < attempts - 1:
                time.sleep(2**attempt * 0.5)
                continue
            raise JevError(f"Could not reach the TypeSafe API: {exc.reason}") from exc
    raise JevError("Exhausted retries against the TypeSafe API.")


def ask_batched(state, questions, model=DEFAULT_MODEL, batch_size=BATCH_SIZE, _ask=ask):
    """Same as `ask`, but splits large question maps across several calls."""
    ids = list(questions)
    answers = {}
    for start in range(0, len(ids), batch_size):
        chunk = {k: questions[k] for k in ids[start : start + batch_size]}
        answers.update(_ask(state, chunk, model=model))
    return answers
