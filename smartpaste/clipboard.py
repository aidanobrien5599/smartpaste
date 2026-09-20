"""macOS clipboard access."""

from __future__ import annotations

import subprocess


def read():
    return subprocess.run(
        ["pbpaste"], capture_output=True, text=True, check=True
    ).stdout


def write(text):
    subprocess.run(["pbcopy"], input=text, text=True, check=True)
