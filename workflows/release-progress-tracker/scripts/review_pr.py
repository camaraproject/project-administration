"""Pure parsing of Release Review PR content.

No GitHub API dependency — operates on pre-fetched PR body text and review
lists only, mirroring state_deriver.py. Feeds the Review Queue view: the
codeowner readiness gate, the codeowner/Release-Management checkbox progress,
and the PR review decision.
"""

import re
from typing import Dict, List, Optional

# Section headings in release_review_pr.mustache. Checkbox counting is scoped
# between headings so nested "What to do" bullets and the assets table never
# get mistaken for action checkboxes.
_CODEOWNER_HEADING = "Codeowner Actions"
_RM_HEADING = "Release Management Actions"

# A GitHub task-list checkbox at the start of a line: "- [ ]" / "* [x]".
# The nested instruction bullets carry no "[ ]" and so never match.
_CHECKBOX_RE = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s*(.*)$")

# The explicit readiness box (mustache box 3). Gating on this box — not on
# "all three" — is correct because box 2 is optional for alpha releases.
_READINESS_MARKER = "ready for release management review"


def parse_review_pr_body(body: Optional[str]) -> Dict:
    """Parse codeowner / Release-Management action state from a Review PR body.

    Returns a dict with:
    - codeowner_total / codeowner_checked: the three Codeowner Actions boxes.
    - ready_for_review: the explicit "ready for Release Management review" box.
    - rm_total / rm_checked: the four Release Management Actions boxes.
    """
    empty = {
        "codeowner_total": 0,
        "codeowner_checked": 0,
        "ready_for_review": False,
        "rm_total": 0,
        "rm_checked": 0,
    }
    if not body:
        return empty

    codeowner_boxes = _checkboxes(_section(body, _CODEOWNER_HEADING))
    rm_boxes = _checkboxes(_section(body, _RM_HEADING))

    ready = any(
        checked and _READINESS_MARKER in label.lower()
        for checked, label in codeowner_boxes
    )

    return {
        "codeowner_total": len(codeowner_boxes),
        "codeowner_checked": sum(1 for checked, _ in codeowner_boxes if checked),
        "ready_for_review": ready,
        "rm_total": len(rm_boxes),
        "rm_checked": sum(1 for checked, _ in rm_boxes if checked),
    }


def _section(body: str, heading: str) -> str:
    """Return the text of the ``### <heading>`` section up to the next ``###``."""
    lines = body.splitlines()
    start = None
    heading_re = re.compile(rf"^\s*###\s+{re.escape(heading)}\s*$")
    for i, line in enumerate(lines):
        if heading_re.match(line):
            start = i + 1
            break
    if start is None:
        return ""

    end = len(lines)
    for j in range(start, len(lines)):
        if re.match(r"^\s*###\s+", lines[j]):
            end = j
            break
    return "\n".join(lines[start:end])


def _checkboxes(section: str) -> List[tuple]:
    """Extract (checked, label) for each task-list checkbox in a section."""
    boxes = []
    for line in section.splitlines():
        m = _CHECKBOX_RE.match(line)
        if m:
            boxes.append((m.group(1).lower() == "x", m.group(2).strip()))
    return boxes


# Review states that carry a verdict; COMMENTED / PENDING are advisory only.
_VERDICT_STATES = frozenset({"APPROVED", "CHANGES_REQUESTED", "DISMISSED"})


def derive_review_decision(
    reviews: List[Dict], assignees: List[str]
) -> Optional[str]:
    """Reduce a PR's reviews to the verdict of its *assigned* reviewer(s).

    The assignee is the concrete RM reviewer (issue design D2), so RM approval
    means an assigned reviewer approved — not a checkbox (which codeowners can
    also tick) nor mere team membership. Reviews by anyone who is not an
    assignee are ignored. With no assignee there is no RM verdict.

    Considers each assigned reviewer's latest verdict review (APPROVED /
    CHANGES_REQUESTED / DISMISSED); a trailing DISMISSED clears that reviewer.
    Any outstanding CHANGES_REQUESTED dominates, else any APPROVED wins, else
    None (assigned but not yet reviewed). Advisory (COMMENTED / PENDING)
    reviews are ignored.
    """
    assignee_set = {a for a in (assignees or []) if a}
    if not assignee_set:
        return None

    latest: Dict[str, str] = {}
    for review in reviews:
        user = review.get("user")
        state = (review.get("state") or "").upper()
        if user in assignee_set and state in _VERDICT_STATES:
            latest[user] = state

    effective = [state for state in latest.values() if state != "DISMISSED"]
    if "CHANGES_REQUESTED" in effective:
        return "CHANGES_REQUESTED"
    if "APPROVED" in effective:
        return "APPROVED"
    return None


def derive_review_state(reviews: List[Dict], assignees: List[str]) -> Optional[str]:
    """Reduce a PR's reviews to APPROVED / CHANGES_REQUESTED / COMMENTED / None.

    Layers a "review comments" interim state onto derive_review_decision's
    verdict reduction: a comment-only review never clears a standing verdict
    (matches GitHub's own semantics), so COMMENTED is only surfaced when the
    assignee has never submitted a verdict-bearing review.
    """
    verdict = derive_review_decision(reviews, assignees)
    if verdict:
        return verdict

    assignee_set = {a for a in (assignees or []) if a}
    if not assignee_set:
        return None

    has_comment = any(
        review.get("user") in assignee_set
        and (review.get("state") or "").upper() == "COMMENTED"
        for review in reviews
    )
    return "COMMENTED" if has_comment else None


# The tooling `/publish-release` gate's CODEOWNERS wildcard-line pattern
# (release-automation-reusable.yml): a line that is exactly "*" or starts
# with "* " (the root wildcard applying to all files).
_CODEOWNERS_WILDCARD_RE = re.compile(r"^\*(\s|$)")
_CODEOWNERS_USERNAME_RE = re.compile(r"@(\S+)")


def parse_codeowners(content: Optional[str]) -> set:
    """Extract the codeowner set from a CODEOWNERS file.

    Mirrors tooling's `/publish-release` CODEOWNERS gate exactly: skip
    comments and blank lines, take only the first line matching the root
    wildcard pattern (``* @user1 @user2``), and lower-case the extracted
    usernames. No path-aware matching or team-entry resolution.
    """
    if not content:
        return set()

    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _CODEOWNERS_WILDCARD_RE.match(stripped):
            return {m.lower() for m in _CODEOWNERS_USERNAME_RE.findall(stripped)}
    return set()


def derive_codeowner_decision(
    reviews: List[Dict], codeowners: set, assignees: List[str]
) -> Optional[str]:
    """Latest non-dismissed APPROVED from a codeowner who isn't an assignee.

    Separation of duties: the RM-assigned reviewer's own approval never
    double-counts as the codeowner approval, even when that person is also
    listed in CODEOWNERS — the codeowner axis requires a second, distinct
    codeowner to approve.
    """
    assignee_set = {a.lower() for a in (assignees or []) if a}
    eligible = {c.lower() for c in (codeowners or [])} - assignee_set
    if not eligible:
        return None

    latest: Dict[str, str] = {}
    for review in reviews:
        user = (review.get("user") or "").lower()
        state = (review.get("state") or "").upper()
        if user in eligible and state in _VERDICT_STATES:
            latest[user] = state

    if "APPROVED" in latest.values():
        return "APPROVED"
    return None
