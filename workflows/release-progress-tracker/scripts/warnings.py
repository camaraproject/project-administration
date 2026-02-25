"""Extensible validation warning infrastructure.

Warnings annotate progress entries without changing derived state.
Each check function follows the signature:
    (entry, repo_releases) -> List[ProgressWarning]

Add new checks by writing a _check_* function and appending to CHECKS.
"""

from typing import List

from .models import ProgressEntry, ProgressState, ProgressWarning


def generate_warnings(
    entry: ProgressEntry, repo_releases: List[dict]
) -> List[ProgressWarning]:
    """Generate validation warnings for a progress entry.

    Called after state derivation and releases-master cross-reference.
    Uses only already-collected data — no additional API calls.
    """
    warnings = []
    for check_fn in CHECKS:
        warnings.extend(check_fn(entry, repo_releases))
    return warnings


def _check_published_plan_diverged(
    entry: ProgressEntry, repo_releases: List[dict]
) -> List[ProgressWarning]:
    """W001: State=PUBLISHED but plan has different API versions than published release.

    This catches the case where a tag exists (so state=PUBLISHED) but the
    release-plan.yaml has been updated with new target versions for the next
    cycle. The plan has "moved on" but still points to the old release tag.
    """
    if entry.state != ProgressState.PUBLISHED:
        return []

    if not entry.target_release_tag or not entry.apis:
        return []

    # Find the published release matching the target tag
    published = None
    for rel in repo_releases:
        if rel.get("release_tag") == entry.target_release_tag:
            published = rel
            break

    if not published:
        return []

    # Compare planned API versions with published versions
    published_versions = {}
    for api in published.get("apis", []):
        name = api.get("api_name")
        if name:
            # Strip pre-release extension for comparison
            version = api.get("api_version", "")
            base_version = version.split("-")[0] if version else ""
            published_versions[name] = base_version

    for api in entry.apis:
        published_base = published_versions.get(api.api_name)
        if published_base and api.target_api_version != published_base:
            return [ProgressWarning(
                code="W001",
                message=(
                    f"Plan targets {api.api_name} {api.target_api_version} "
                    f"but {entry.target_release_tag} published {published_base}"
                ),
                severity="warning",
            )]

    return []


def _check_orphaned_snapshot(
    entry: ProgressEntry, repo_releases: List[dict]
) -> List[ProgressWarning]:
    """W002: Snapshot branch exists but target_release_type=none.

    Catches orphaned artifacts from previous release cycles that were
    not cleaned up.
    """
    if entry.state != ProgressState.NOT_PLANNED:
        return []

    if entry.artifacts.snapshot_branch:
        return [ProgressWarning(
            code="W002",
            message=(
                f"Snapshot branch {entry.artifacts.snapshot_branch} exists "
                f"but release type is 'none'"
            ),
            severity="warning",
        )]

    return []


# Registry of check functions — add new checks here
CHECKS = [
    _check_published_plan_diverged,  # W001
    _check_orphaned_snapshot,        # W002
]
