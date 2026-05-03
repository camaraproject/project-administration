"""Main orchestrator for release progress collection.

Scans CAMARA repositories, reads release-plan.yaml, derives state from
artifacts, cross-references releases-master.yaml, and produces
data/releases-progress.yaml.

Usage:
    python3 -m workflows.release_progress_tracker.scripts.collect_progress \
        --master data/releases-master.yaml \
        --output data/releases-progress.yaml \
        [--debug]
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from .github_api import GitHubAPI, RateLimitError
from .milestone_deriver import (
    build_meta_release_summaries,
    derive_cycle_releases,
    derive_last_published,
)
from .models import (
    COLLECTOR_VERSION,
    SCHEMA_VERSION,
    ApiEntry,
    ArtifactInfo,
    CollectionStats,
    CycleReleases,
    MetaReleaseSummary,
    ProgressData,
    ProgressEntry,
    ProgressState,
    PublishedContext,
)
from .state_deriver import (
    derive_state,
    extract_draft_release_url_from_issue,
    find_matching_draft_release,
    find_matching_snapshot,
    issue_indicates_draft_ready,
)
from .warnings import generate_warnings

logger = logging.getLogger(__name__)


class CollectionAbortedError(Exception):
    """Raised when collection cannot complete a full pass.

    Triggered by rate-limit exhaustion mid-run or by unrecovered per-repo
    failures. The collector preserves the existing releases-progress.yaml
    on disk rather than overwriting it with partial data; the workflow
    sees a non-zero exit and skips the downstream PR/deploy jobs.
    """


# Repositories that have been split into sub-APIs and will not receive new
# release-plan.yaml entries. Historical releases remain visible in the table
# because they flow through all_releases, not the filtered repositories list.
# EdgeCloud is listed defensively — it is not currently in releases-master.yaml.
SPLIT_REPOSITORIES = frozenset({
    "EdgeCloud",
    "DeviceStatus",
    "KnowYourCustomer",
})


def load_releases_master(path: str) -> Dict:
    """Load releases-master.yaml from disk."""
    with open(path, "r") as f:
        return yaml.safe_load(f)


def build_published_context_map(
    repositories: List[Dict],
) -> Dict[str, PublishedContext]:
    """Build repo → PublishedContext lookup from releases-master repositories."""
    context_map = {}
    for repo in repositories:
        name = repo.get("repository", "")
        context_map[name] = PublishedContext(
            latest_public_release=repo.get("latest_public_release"),
            newest_pre_release=repo.get("newest_pre_release"),
        )
    return context_map


def parse_release_plan(content: str) -> Optional[Dict]:
    """Parse release-plan.yaml content. Returns None on error."""
    try:
        return yaml.safe_load(content)
    except yaml.YAMLError as e:
        logger.warning("Failed to parse release-plan.yaml: %s", e)
        return None


def _tag_prefix(release_tag: str) -> str:
    """Extract cycle prefix from a release tag. E.g. 'r1.1' → 'r1.'"""
    dot_index = release_tag.find(".")
    return release_tag[:dot_index + 1] if dot_index != -1 else release_tag + "."


def _check_completed_state(entry: ProgressEntry, all_releases: List[Dict]) -> ProgressState:
    """Upgrade NOT_PLANNED to COMPLETED when release-plan exactly matches a completed release.

    Conditions (all must hold):
    1. target_release_tag exactly matches a public-release or maintenance-release
       for this repo in releases-master.yaml (a maintenance-release implies a prior
       public-release in the same cycle, so both count as completed states).
    2. Every planned API's target_api_version matches the api_version in that release.
    3. entry.apis is non-empty (empty API list is not verifiable, stays NOT_PLANNED).
    """
    if not entry.target_release_tag or not entry.apis:
        return ProgressState.NOT_PLANNED

    _TERMINAL_TYPES = {"public-release", "maintenance-release"}

    matched_release = next(
        (
            r for r in all_releases
            if r.get("repository") == entry.repository
            and r.get("release_tag") == entry.target_release_tag
            and r.get("release_type") in _TERMINAL_TYPES
        ),
        None,
    )

    if not matched_release:
        return ProgressState.NOT_PLANNED

    release_api_versions = {
        a.get("api_name"): a.get("api_version")
        for a in matched_release.get("apis", [])
        if a.get("api_name")
    }

    for api_entry in entry.apis:
        if release_api_versions.get(api_entry.api_name) != api_entry.target_api_version:
            return ProgressState.NOT_PLANNED

    return ProgressState.COMPLETED


# meta_release values that indicate an independent / non-meta-release repo
# Includes legacy "None (Sandbox)" for backward compatibility with old releases-master.yaml data
_INDEPENDENT_META_RELEASES = {"Independent", "None (Sandbox)", "None"}


def collect_historical_entries(
    all_releases: List[Dict],
    active_repo_meta_releases: set,
    repo_url_map: Dict[str, str],
    active_entries: Optional[List[ProgressEntry]] = None,
) -> List[ProgressEntry]:
    """Create HISTORICAL entries for repos with cycle releases but no active release-plan.yaml.

    These entries carry M1/M3/M4 and last_published data from releases-master.yaml.
    No GitHub API calls are made.

    Independent repos (meta_release in _INDEPENDENT_META_RELEASES):
    - If an active entry covers the same repo/tag-prefix → skip (active entry wins).
    - Otherwise → create a HISTORICAL entry with release_track="independent".
    """
    if active_entries is None:
        active_entries = []

    # Build (repo, tag_prefix) set from active entries for independent release resolution
    active_by_repo_prefix = {
        (e.repository, _tag_prefix(e.target_release_tag))
        for e in active_entries
        if e.target_release_tag
    }

    # Group releases by (repository, meta_release)
    groups: Dict[tuple, List[Dict]] = {}
    for release in all_releases:
        repo = release.get("repository", "")
        meta = release.get("meta_release", "")
        if not repo or not meta:
            continue
        key = (repo, meta)
        if key not in groups:
            groups[key] = []
        groups[key].append(release)

    entries = []
    for (repo, meta_release), repo_releases in sorted(groups.items()):
        if (repo, meta_release) in active_repo_meta_releases:
            continue

        is_independent = meta_release in _INDEPENDENT_META_RELEASES

        # Find best release for deriving the cycle tag and API list.
        # target_tag: highest-priority release type wins (public > rc > alpha > maintenance).
        # apis: same priority, but fall through to lower types if a release has no api data.
        target_tag = None
        apis = []
        for preferred_type in (
            "public-release", "pre-release-rc", "pre-release-alpha", "maintenance-release"
        ):
            candidates = [r for r in repo_releases if r.get("release_type") == preferred_type]
            if not candidates:
                continue
            candidates.sort(key=lambda r: r.get("release_date", ""))
            best = candidates[0]
            if target_tag is None:
                target_tag = best.get("release_tag")
            if not apis:
                apis = [
                    ApiEntry(
                        api_name=a.get("api_name", ""),
                        target_api_version=a.get("api_version", ""),
                        target_api_status="",
                    )
                    for a in best.get("apis", [])
                    if a.get("api_name")
                ]
            if target_tag and apis:
                break

        if not target_tag:
            continue

        if is_independent:
            prefix = _tag_prefix(target_tag)
            if (repo, prefix) in active_by_repo_prefix:
                continue  # Active entry already covers this repo/cycle
            entry_release_track = "independent"
            entry_meta_release = None
        else:
            entry_release_track = "meta-release"
            entry_meta_release = meta_release

        github_url = repo_url_map.get(repo, "")
        entry = ProgressEntry(
            repository=repo,
            github_url=github_url,
            release_track=entry_release_track,
            meta_release=entry_meta_release,
            target_release_tag=None,   # No active plan
            target_release_type=None,
            apis=apis,
            state=ProgressState.HISTORICAL,
            source="historical",
        )

        entry.cycle_releases = derive_cycle_releases(
            repo, target_tag, meta_release, all_releases,
        )
        entry.last_published = derive_last_published(
            repo, target_tag, all_releases,
        )

        entries.append(entry)

    return entries


def collect_repo_progress(
    repo_name: str,
    github_url: str,
    api: GitHubAPI,
    all_releases: List[Dict],
    published_context: PublishedContext,
) -> Optional[ProgressEntry]:
    """Collect progress for a single repository.

    Returns None if the repo has no release-plan.yaml.
    """
    # Read release-plan.yaml
    plan_content = api.get_file_content(repo_name, "release-plan.yaml")
    if plan_content is None:
        logger.debug("%s: no release-plan.yaml, skipping", repo_name)
        return None

    plan = parse_release_plan(plan_content)
    if plan is None:
        logger.warning("%s: malformed release-plan.yaml, skipping", repo_name)
        return None

    repo_section = plan.get("repository", {})
    target_type = repo_section.get("target_release_type", "none")
    target_tag = repo_section.get("target_release_tag")
    release_track = repo_section.get("release_track")
    meta_release = repo_section.get("meta_release")
    dependencies = plan.get("dependencies")

    # Parse APIs from plan
    apis = []
    for api_data in plan.get("apis", []):
        apis.append(ApiEntry(
            api_name=api_data.get("api_name", ""),
            target_api_version=api_data.get("target_api_version", ""),
            target_api_status=api_data.get("target_api_status", ""),
            main_contacts=api_data.get("main_contacts", []),
        ))

    # Build base entry
    entry = ProgressEntry(
        repository=repo_name,
        github_url=github_url,
        release_track=release_track,
        meta_release=meta_release,
        target_release_tag=target_tag,
        target_release_type=target_type,
        dependencies=dependencies,
        apis=apis,
        published_context=published_context,
    )

    # NOT_PLANNED repos skip artifact checks
    if not target_type or target_type == "none":
        entry.state = derive_state(target_type, target_tag, False, [], [])
        # Still check for orphaned artifacts (W002)
        branches = api.list_branches(repo_name, prefix="release-snapshot/")
        if branches:
            snapshot = find_matching_snapshot(branches, target_tag)
            if snapshot:
                entry.artifacts.snapshot_branch = snapshot
        # Cross-reference milestones and last published
        entry.cycle_releases = derive_cycle_releases(
            repo_name, target_tag, meta_release, all_releases,
        )
        entry.last_published = derive_last_published(
            repo_name, target_tag, all_releases,
        )
        # Upgrade to COMPLETED if plan exactly matches last public release
        entry.state = _check_completed_state(entry, all_releases)
        # Generate warnings
        repo_releases = [r for r in all_releases if r.get("repository") == repo_name]
        entry.warnings = generate_warnings(entry, repo_releases)
        return entry

    # Active repos: collect artifacts
    tag_exists = api.tag_exists(repo_name, target_tag)
    snapshot_branches = api.list_branches(repo_name, prefix="release-snapshot/")
    draft_releases = api.get_draft_releases(repo_name)
    release_issue = api.find_release_issue(repo_name, target_tag)

    # Derive state
    entry.state = derive_state(
        target_type, target_tag, tag_exists,
        snapshot_branches, draft_releases, release_issue,
    )

    # Check caller workflow only for PLANNED (other states imply it exists)
    if entry.state == ProgressState.PLANNED:
        wf = api.get_file_content(
            repo_name, ".github/workflows/release-automation.yml"
        )
        entry.artifacts.has_caller_workflow = wf is not None

    # Populate artifacts
    snapshot = find_matching_snapshot(snapshot_branches, target_tag)
    if snapshot:
        entry.artifacts.snapshot_branch = snapshot
        # Find release PR for the snapshot branch
        pr = api.find_release_pr(repo_name, snapshot)
        if pr:
            entry.artifacts.release_pr = pr

    matched_draft = find_matching_draft_release(
        draft_releases, target_tag, snapshot
    )
    if matched_draft:
        entry.artifacts.draft_release = {
            "name": matched_draft.get("name") or target_tag,
            "url": matched_draft.get("html_url"),
        }
    elif issue_indicates_draft_ready(release_issue, target_tag):
        draft_url = extract_draft_release_url_from_issue(release_issue)
        if draft_url:
            entry.artifacts.draft_release = {
                "name": target_tag,
                "url": draft_url,
            }

    # Release issue
    if release_issue:
        entry.artifacts.release_issue = {
            "number": release_issue.get("number"),
            "url": release_issue.get("url"),
        }

    # Cross-reference M1/M3/M4 and last published from releases-master
    entry.cycle_releases = derive_cycle_releases(
        repo_name, target_tag, meta_release, all_releases,
    )
    entry.last_published = derive_last_published(
        repo_name, target_tag, all_releases,
    )

    # Read calculated API versions from snapshot's release-metadata.yaml
    if entry.artifacts.snapshot_branch and entry.state in (
        ProgressState.SNAPSHOT_ACTIVE, ProgressState.DRAFT_READY,
        ProgressState.PUBLISHED,
    ):
        try:
            meta_content = api.get_file_content(
                repo_name, "release-metadata.yaml",
                ref=entry.artifacts.snapshot_branch,
            )
            if meta_content:
                meta = yaml.safe_load(meta_content)
                if meta and isinstance(meta.get("apis"), list):
                    entry.snapshot_api_versions = {
                        a["api_name"]: a["api_version"]
                        for a in meta["apis"]
                        if a.get("api_name") and a.get("api_version")
                    }
        except Exception as e:
            logger.debug(
                "%s: failed to read release-metadata.yaml from %s: %s",
                repo_name, entry.artifacts.snapshot_branch, e,
            )

    # Fallback for PUBLISHED: read from release tag when snapshot branch unavailable
    if not entry.snapshot_api_versions and entry.state == ProgressState.PUBLISHED and target_tag:
        try:
            meta_content = api.get_file_content(
                repo_name, "release-metadata.yaml",
                ref=target_tag,
            )
            if meta_content:
                meta = yaml.safe_load(meta_content)
                if meta and isinstance(meta.get("apis"), list):
                    entry.snapshot_api_versions = {
                        a["api_name"]: a["api_version"]
                        for a in meta["apis"]
                        if a.get("api_name") and a.get("api_version")
                    }
        except Exception as e:
            logger.debug(
                "%s: failed to read release-metadata.yaml from tag %s: %s",
                repo_name, target_tag, e,
            )

    # Generate warnings
    repo_releases = [r for r in all_releases if r.get("repository") == repo_name]
    entry.warnings = generate_warnings(entry, repo_releases)

    return entry


def compare_progress_data(new_dict: Dict, existing_dict: Dict) -> bool:
    """Compare stable data sections between new and existing output.

    Only compares ``progress`` and ``meta_releases`` sections.
    Metadata fields (timestamps, stats) are excluded because they
    change on every collection run.

    Returns True if data has changed, False if identical.
    """
    def normalize_progress(entries):
        return sorted(entries, key=lambda e: e.get("repository", ""))

    new_progress = normalize_progress(new_dict.get("progress", []))
    existing_progress = normalize_progress(existing_dict.get("progress", []))

    if new_progress != existing_progress:
        return True

    new_meta = new_dict.get("meta_releases", [])
    existing_meta = existing_dict.get("meta_releases", [])

    return new_meta != existing_meta


def collect_all(
    master_path: str,
    output_path: str,
    existing_path: Optional[str] = None,
    api: Optional[GitHubAPI] = None,
) -> ProgressData:
    """Main collection loop.

    Args:
        master_path: Path to releases-master.yaml.
        output_path: Path to write releases-progress.yaml.
        existing_path: Path to existing releases-progress.yaml for comparison.
            When provided, only signals data_changed=True if progress or
            meta_releases sections differ from the existing file.
        api: GitHubAPI instance (created from env if not provided).

    Returns:
        ProgressData with all collected entries.
    """
    start_time = time.time()

    if api is None:
        api = GitHubAPI()

    master = load_releases_master(master_path)
    all_repositories = master.get("repositories", [])
    all_releases = master.get("releases", [])

    def _is_active(repo: Dict) -> bool:
        if repo.get("repository_archived", False):
            return False
        if repo.get("repository", "") in SPLIT_REPOSITORIES:
            return False
        return True

    repositories = [r for r in all_repositories if _is_active(r)]
    excluded_count = len(all_repositories) - len(repositories)
    if excluded_count:
        logger.info(
            "Excluded %d repositories from active count (archived or split)",
            excluded_count,
        )

    context_map = build_published_context_map(repositories)
    repo_url_map: Dict[str, str] = {
        r.get("repository", ""): r.get("github_url", "")
        for r in repositories
        if r.get("repository")
    }

    active_states = {ProgressState.PLANNED, ProgressState.SNAPSHOT_ACTIVE,
                     ProgressState.DRAFT_READY, ProgressState.PUBLISHED}

    stats = CollectionStats(repos_scanned=len(repositories))
    entries: List[ProgressEntry] = []
    rate_limit_aborted = False
    failed_repos: List[str] = []

    for repo_data in repositories:
        repo_name = repo_data.get("repository", "")
        github_url = repo_data.get("github_url", "")
        published_ctx = context_map.get(repo_name, PublishedContext(None, None))

        try:
            entry = collect_repo_progress(
                repo_name, github_url, api,
                all_releases, published_ctx,
            )
            if entry is not None:
                entries.append(entry)
                stats.repos_with_plan += 1
                if entry.state in active_states:
                    stats.repos_planned += 1
                # Fully onboarded: has caller workflow (explicit or implied by state)
                if entry.artifacts.has_caller_workflow or entry.state in {
                    ProgressState.SNAPSHOT_ACTIVE,
                    ProgressState.DRAFT_READY,
                    ProgressState.PUBLISHED,
                }:
                    stats.repos_fully_onboarded += 1
                if entry.artifacts.release_issue:
                    stats.repos_with_release_issue += 1
        except RateLimitError:
            logger.error("Rate limit exhausted, aborting collection")
            rate_limit_aborted = True
            break
        except Exception as e:
            logger.warning("%s: collection failed: %s", repo_name, e)
            failed_repos.append(repo_name)
            continue

    # Abort before writing partial data: a corrupted releases-progress.yaml
    # is worse than a workflow failure (PA#209, PA#224).
    if rate_limit_aborted:
        raise CollectionAbortedError(
            f"Rate limit exhausted after {api.api_calls} calls; "
            f"{len(entries)}/{len(repositories)} repos collected. "
            "Existing releases-progress.yaml left untouched."
        )
    if failed_repos:
        sample = ", ".join(failed_repos[:5])
        more = "" if len(failed_repos) <= 5 else f" (and {len(failed_repos) - 5} more)"
        raise CollectionAbortedError(
            f"{len(failed_repos)} repos failed during collection: {sample}{more}. "
            "Existing releases-progress.yaml left untouched."
        )

    # Count active repos that have no release-plan.yaml AND no published/pre releases.
    # These are freshly-created repos not yet onboarded.
    plan_repo_names = {e.repository for e in entries}
    stats.repos_new = sum(
        1 for r in repositories
        if r.get("repository", "") not in plan_repo_names
        and r.get("latest_public_release") is None
        and r.get("newest_pre_release") is None
    )

    # Add historical entries for repos with cycle releases but no release-plan.yaml
    active_repo_meta_releases = {
        (e.repository, e.meta_release)
        for e in entries
        if e.meta_release
    }
    historical = collect_historical_entries(
        all_releases, active_repo_meta_releases, repo_url_map,
        active_entries=entries,
    )
    entries.extend(historical)
    logger.info("Historical entries added: %d", len(historical))

    # Build meta-release summaries
    summary_data = build_meta_release_summaries(entries)
    meta_summaries = [
        MetaReleaseSummary(name=name, **counts)
        for name, counts in sorted(summary_data.items())
    ]

    stats.api_calls = api.api_calls
    stats.duration_seconds = time.time() - start_time

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Read source data freshness from releases-master.yaml metadata
    master_metadata = master.get("metadata", {})
    releases_master_updated = master_metadata.get("last_updated", "")

    progress_data = ProgressData(
        last_checked=now,
        releases_master_updated=releases_master_updated,
        schema_version=SCHEMA_VERSION,
        collector_version=COLLECTOR_VERSION,
        collection_stats=stats,
        meta_releases=meta_summaries,
        progress=entries,
    )

    # Compare with existing file to determine if data actually changed
    new_output = progress_data.to_dict()
    data_changed = True

    if existing_path:
        existing_file = Path(existing_path)
        if existing_file.exists():
            try:
                with open(existing_file, "r") as f:
                    existing_data = yaml.safe_load(f) or {}
                data_changed = compare_progress_data(new_output, existing_data)
                if not data_changed:
                    # Carry forward last_updated from existing file
                    existing_last_updated = existing_data.get("metadata", {}).get(
                        "last_updated", now
                    )
                    progress_data.last_updated = existing_last_updated
                    logger.info("No data changes detected, carrying forward last_updated")
            except Exception as e:
                logger.warning("Failed to read existing file: %s, treating as changed", e)
                data_changed = True

    if data_changed:
        progress_data.last_updated = now

    progress_data.data_changed = data_changed

    # Write output (always write — last_checked changes every run for the viewer)
    output = progress_data.to_dict()
    with open(output_path, "w") as f:
        yaml.dump(output, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

    logger.info(
        "Collection complete: %d repos scanned, %d new, %d with plan, %d planned, "
        "%d API calls in %.1fs, data_changed=%s",
        stats.repos_scanned, stats.repos_new, stats.repos_with_plan,
        stats.repos_planned, stats.api_calls, stats.duration_seconds, data_changed,
    )

    return progress_data


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Collect CAMARA release progress data"
    )
    parser.add_argument(
        "--master", required=True,
        help="Path to releases-master.yaml",
    )
    parser.add_argument(
        "--output", required=True,
        help="Path to write releases-progress.yaml",
    )
    parser.add_argument(
        "--existing", required=False, default=None,
        help="Path to existing releases-progress.yaml for change comparison",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    try:
        result = collect_all(args.master, args.output, existing_path=args.existing)

        # Output data_changed for workflow consumption
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a") as f:
                f.write(f"data_changed={'true' if result.data_changed else 'false'}\n")

        # Log collection stats for workflow summary
        stats = result.collection_stats
        print(f"::group::Collection Statistics")
        print(f"Repos scanned: {stats.repos_scanned}")
        print(f"Repos with plan: {stats.repos_with_plan}")
        print(f"Repos planned: {stats.repos_planned}")
        print(f"API calls: {stats.api_calls}")
        print(f"Duration: {stats.duration_seconds:.1f}s")
        print(f"Data changed: {result.data_changed}")
        print(f"::endgroup::")

    except CollectionAbortedError as e:
        logger.error("Collection aborted: %s", e)
        sys.exit(1)
    except Exception as e:
        logger.error("Collection failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
