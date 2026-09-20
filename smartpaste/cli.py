"""sp -- fill a job application from your own resume, one paste at a time."""

from __future__ import annotations

import argparse
import os
import sys

from . import answer, clipboard, fill, jev, profile, source, triage

DIM, BOLD, GREEN, YELLOW, RED, OFF = (
    "\033[2m", "\033[1m", "\033[32m", "\033[33m", "\033[31m", "\033[0m",
)

_MARK = {answer.AUTO_FILL: f"{GREEN}●{OFF}", answer.NEEDS_PICK: f"{YELLOW}●{OFF}",
         answer.NO_ANSWER: f"{DIM}○{OFF}"}


def _truncate(text, width):
    return text if len(text) <= width else text[: width - 1] + "…"


def cmd_init(args):
    resume = source.resume_text(args.file)
    snippets = profile.snippets_from_resume(resume)
    existing = {}
    try:
        existing = profile.load().get("supplementary", {})
    except (FileNotFoundError, ValueError):
        pass
    supplementary = {**profile.SUPPLEMENTARY, **existing}
    merged = dict(snippets)
    for i, (name, value) in enumerate(supplementary.items(), 1):
        if value:
            merged[f"x{i:03d}"] = value
    path = profile.save(
        {"snippets": merged, "supplementary": supplementary,
         "triage": triage.DEFAULT_CRITERIA, "network": {}}
    )
    print(f"{GREEN}✓{OFF} {len(snippets)} snippets from your resume → {path}")
    blank = [name for name, value in supplementary.items() if not value]
    if blank:
        print(
            f"\n{DIM}A resume never contains these, but applications always ask.\n"
            f"Fill them in {path} and re-run `sp init`. Write each as a complete\n"
            f"statement -- a bare \"June 2027\" competes with your graduation date:{OFF}"
        )
        for name in blank:
            print(f"  {name:<20} {DIM}e.g. {profile.EXAMPLES.get(name, '')}{OFF}")


LAST_FORM = os.path.join(profile.CONFIG_DIR, "last_form.txt")


def cmd_fill(args):
    prof = profile.load()
    if args.again:
        try:
            with open(LAST_FORM) as handle:
                form = handle.read()
        except OSError:
            sys.exit("No previous form to re-run.")
    else:
        form = clipboard.read()
        if not form.strip():
            sys.exit("Clipboard is empty. Copy the application page's text first.")
        # The run below overwrites the clipboard with its own answers, so keep
        # the form to make `sp --again` possible.
        os.makedirs(profile.CONFIG_DIR, exist_ok=True)
        with open(LAST_FORM, "w") as handle:
            handle.write(form)
    results = fill.fill(form, prof, model=args.model)
    if not results:
        sys.exit("Found no form fields in the clipboard text.")

    width = min(max(len(r["label"]) for r in results), 44)
    print()
    for r in results:
        label = _truncate(r["label"], width).ljust(width)
        if r["status"] == answer.NO_ANSWER:
            value, conf = f"{DIM}— no snippet —{OFF}", ""
        else:
            value = _truncate(r["value"], 40)
            conf = f"{DIM}{r['confidence']:.2f}{OFF}"
        print(f"  {_MARK[r['status']]} {label}  {value}  {conf}")

    filled = [r for r in results if r["status"] != answer.NO_ANSWER]
    missing = len(results) - len(filled)
    uncertain = sum(1 for r in filled if r["status"] == answer.NEEDS_PICK)
    block = fill.as_block(results)
    if block:
        clipboard.write(block)
    summary = f"\n{GREEN}✓{OFF} {len(filled)} filled"
    if uncertain:
        summary += f", {YELLOW}{uncertain} worth checking{OFF}"
    if missing:
        summary += f", {DIM}{missing} need you{OFF}"
    print(summary + f" → copied as a block\n")


def cmd_triage(args):
    prof = profile.load()
    posting = clipboard.read()
    if not posting.strip():
        sys.exit("Clipboard is empty. Copy the job posting first.")
    out = triage.triage(posting, prof, model=args.model)
    a = out["answers"]
    rows = [
        ("new-grad eligible", "yes" if a["eligible"]["noul"] >= 0.5 else "no",
         a["eligible"]["noul"]),
        ("work auth blocked", "yes" if a["sponsorship_blocked"]["noul"] >= 0.5 else "no",
         a["sponsorship_blocked"]["noul"]),
        ("stage", a["stage"]["choice"], a["stage"]["confidence"]),
        ("fit", f"{int(a['fit']['score']) + 1}/4", a["fit"]["confidence"]),
        ("applicant volume", f"{int(a['volume']['score']) + 1}/4",
         a["volume"]["confidence"]),
    ]
    print()
    for name, value, conf in rows:
        print(f"  {name:<20} {value:<10} {DIM}{conf:.2f}{OFF}")
    colour = {triage.APPLY: GREEN, triage.WARM: YELLOW, triage.SKIP: RED}[out["decision"]]
    print(
        f"\n  {colour}{BOLD}→ {out['decision'].replace('_', ' ').upper()}{OFF}"
        f"  {DIM}({out['why']}){OFF}\n"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="sp", description="Fill a job application from your own resume."
    )
    parser.add_argument("--model", default=jev.DEFAULT_MODEL)
    parser.set_defaults(file=None)
    parser.add_argument(
        "--again", action="store_true",
        help="re-run on the last form, since a fill overwrites the clipboard",
    )
    sub = parser.add_subparsers(dest="command")
    init = sub.add_parser("init", help="build your snippet library from your resume")
    init.add_argument(
        "--file", help="read the resume from a .pdf/.txt/.md instead of the clipboard"
    )
    sub.add_parser("triage", help="score a copied job posting")
    args = parser.parse_args(argv)

    handler = {"init": cmd_init, "triage": cmd_triage}.get(args.command, cmd_fill)
    try:
        handler(args)
    except (jev.JevError, source.SourceError, FileNotFoundError, ValueError) as exc:
        sys.exit(f"{RED}✗{OFF} {exc}")


if __name__ == "__main__":
    main()
