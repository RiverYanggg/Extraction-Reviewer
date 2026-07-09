"""Per-reviewer paper assignment loading."""
from __future__ import annotations

from .auth import User
from .utils import try_read_json


def load_assigned_papers(user: User) -> list[str]:
    """Return paper IDs assigned to a user.

    Missing assignment files intentionally mean "no papers" so a new account
    cannot see every extracted paper by accident.
    """
    data = try_read_json(user.assignments_path)
    papers = data.get("papers") if isinstance(data, dict) else []
    if not isinstance(papers, list):
        return []
    return [str(p).strip() for p in papers if str(p).strip()]


def is_assigned(user: User, paper_id: str) -> bool:
    return paper_id in set(load_assigned_papers(user))
