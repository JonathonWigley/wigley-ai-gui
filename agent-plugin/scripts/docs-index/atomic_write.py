"""Writes a file through a temp file and os.replace, so a reader never sees a half-written one."""

from __future__ import annotations

import os
from pathlib import Path


def write_through_temp(path: Path, tmp: Path, text: str) -> None:
    """Write text to tmp, creating path's folder, then replace path with it.
    When the write or the replace raises, tmp is removed and the error raised."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
