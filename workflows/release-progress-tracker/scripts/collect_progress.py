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
import sys
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import yaml

from .github_api import GitHubAPI, RateLimitError
from .milestone_deriver import build_meta_release_summaries, derive_cycle_releases
from .models import (
    ApiEntry,
    ArtifactInfo,
    CollectionStats,
    MetaReleaseSummary,
    ProgressData,
    ProgressEntry,
    PublishedContext,
)
from .state_deriver import derive_state, find_matching_snapshot
from .warnings import generate_warnings

logger = logging.getLogger(__name__)

COLLECTOR_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0.0"


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

    planned_api_names = [a.api_name for a in apis]

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
        # Cross-reference milestones
        entry.cycle_releases = derive_cycle_releases(
            repo_name, meta_release, all_releases, planned_api_names,
        )
        # Generate warnings
        repo_releases = [r for r in all_releases if r.get("repository") == repo_name]
        entry.warnings = generate_warnings(entry, repo_releases)
        return entry

    # Active repos: collect artifacts
    tag_exists = api.tag_exists(repo_name, target_tag)
    snapshot_branches = api.list_branches(repo_name, prefix="release-snapshot/")
    draft_releases = api.get_draft_releases(repo_name)

    # Derive state
    entry.state = derive_state(
        target_type, target_tag, tag_exists,
        snapshot_branches, draft_releases,
    )

    # Populate artifacts
    snapshot = find_matching_snapshot(snapshot_branches, target_tag)
    if snapshot:
        entry.artifacts.snapshot_branch = snapshot
        # Find release PR for the snapshot branch
        pr = api.find_release_pr(repo_name, snapshot)
        if pr:
            entry.artifacts.release_pr = pr

    # Draft release
    for dr in draft_releases:
        name = dr.get("name", "") or ""
        dr_tag = dr.get("tag_name", "") or ""
        if target_tag and (target_tag in name or target_tag in dr_tag):
            entry.artifacts.draft_release = {
                "name": dr.get("name"),
                "url": dr.get("html_url"),
            }
            break

    # Release issue
    release_issue = api.find_release_issue(repo_name)
    if release_issue:
        entry.artifacts.release_issue = release_issue

    # Cross-reference M1/M3/M4 from releases-master
    entry.cycle_releases = derive_cycle_releases(
        repo_name, meta_release, all_releases, planned_api_names,
    )

    # Generate warnings
    repo_releases = [r for r in all_releases if r.get("repository") == repo_name]
    entry.warnings = generate_warnings(entry, repo_releases)

    return entry


def collect_all(
    master_path: str,
    output_path: str,
    api: Optional[GitHubAPI] = None,
) -> ProgressData:
    """Main collection loop.

    Args:
        master_path: Path to releases-master.yaml.
        output_path: Path to write releases-progress.yaml.
        api: GitHubAPI instance (created from env if not provided).

    Returns:
        ProgressData with all collected entries.
    """
    start_time = time.time()

    if api is None:
        api = GitHubAPI()

    master = load_releases_master(master_path)
    repositories = master.get("repositories", [])
    all_releases = master.get("releases", [])

    context_map = build_published_context_map(repositories)

    stats = CollectionStats(repos_scanned=len(repositories))
    entries: List[ProgressEntry] = []

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
                if entry.state.value != "not_planned":
                    stats.repos_planned += 1
        except RateLimitError:
            logger.error("Rate limit exhausted, aborting collection")
            break
        except Exception as e:
            logger.warning("%s: collection failed: %s", repo_name, e)
            continue

    # Build meta-release summaries
    summary_data = build_meta_release_summaries(entries)
    meta_summaries = [
        MetaReleaseSummary(name=name, **counts)
        for name, counts in sorted(summary_data.items())
    ]

    stats.api_calls = api.api_calls
    stats.duration_seconds = time.time() - start_time

    progress_data = ProgressData(
        last_updated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        schema_version=SCHEMA_VERSION,
        collector_version=COLLECTOR_VERSION,
        collection_stats=stats,
        meta_releases=meta_summaries,
        progress=entries,
    )

    # Write output
    output = progress_data.to_dict()
    with open(output_path, "w") as f:
        yaml.dump(output, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

    logger.info(
        "Collection complete: %d repos scanned, %d with plan, %d planned, "
        "%d API calls in %.1fs",
        stats.repos_scanned, stats.repos_with_plan, stats.repos_planned,
        stats.api_calls, stats.duration_seconds,
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
        "--debug", action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    try:
        collect_all(args.master, args.output)
    except Exception as e:
        logger.error("Collection failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
