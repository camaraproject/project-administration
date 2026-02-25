"""Pure state derivation from repository artifacts.

No GitHub API dependency — operates on pre-fetched data only.
"""

import re
from typing import List, Optional

from .models import ProgressState


def derive_state(
    target_release_type: Optional[str],
    target_release_tag: Optional[str],
    tag_exists: bool,
    snapshot_branches: List[str],
    draft_releases: List[dict],
) -> ProgressState:
    """Derive the progress state from repository artifacts.

    Priority order (highest first):
    1. target_release_type == "none" or missing tag → NOT_PLANNED
    2. Tag exists → PUBLISHED
    3. Snapshot branch + draft release → DRAFT_READY
    4. Snapshot branch only → SNAPSHOT_ACTIVE
    5. Has plan, no artifacts → PLANNED
    """
    if not target_release_type or target_release_type == "none":
        return ProgressState.NOT_PLANNED

    if tag_exists:
        return ProgressState.PUBLISHED

    snapshot = find_matching_snapshot(snapshot_branches, target_release_tag)
    if snapshot:
        if _has_matching_draft(draft_releases, target_release_tag):
            return ProgressState.DRAFT_READY
        return ProgressState.SNAPSHOT_ACTIVE

    return ProgressState.PLANNED


def find_matching_snapshot(
    branches: List[str], target_tag: Optional[str]
) -> Optional[str]:
    """Find a snapshot branch matching the target release tag.

    Snapshot branches follow the pattern: release-snapshot/{tag}-{suffix}
    e.g., release-snapshot/r4.2-abc123
    """
    if not target_tag:
        return None

    prefix = f"release-snapshot/{target_tag}-"
    for branch in branches:
        if branch.startswith(prefix):
            return branch
    return None


def _has_matching_draft(
    draft_releases: List[dict], target_tag: Optional[str]
) -> bool:
    """Check if any draft release matches the target release tag.

    Draft release names typically contain the release tag.
    """
    if not target_tag or not draft_releases:
        return False

    for release in draft_releases:
        name = release.get("name", "") or ""
        tag = release.get("tag_name", "") or ""
        if target_tag in name or target_tag in tag:
            return True
    return False
