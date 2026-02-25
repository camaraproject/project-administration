"""Integration tests for the collector orchestrator with mocked GitHub API."""

import os
import tempfile

import pytest
import yaml

from scripts.collect_progress import (
    build_published_context_map,
    collect_all,
    collect_repo_progress,
    load_releases_master,
    parse_release_plan,
)
from scripts.github_api import GitHubAPI
from scripts.models import ProgressState, PublishedContext


# --- Fixtures ---

PLAN_RC = yaml.dump({
    "repository": {
        "release_track": "meta-release",
        "meta_release": "Sync26",
        "target_release_tag": "r4.1",
        "target_release_type": "pre-release-rc",
    },
    "dependencies": {
        "commonalities_release": "r4.2",
    },
    "apis": [{
        "api_name": "quality-on-demand",
        "target_api_version": "1.2.0",
        "target_api_status": "rc",
        "main_contacts": ["user1"],
    }],
})

PLAN_NONE = yaml.dump({
    "repository": {
        "release_track": "meta-release",
        "meta_release": "Sync26",
        "target_release_tag": None,
        "target_release_type": "none",
    },
    "apis": [],
})

SAMPLE_MASTER = {
    "metadata": {
        "last_updated": "2026-03-01T00:00:00Z",
        "last_checked": "2026-03-01T00:00:00Z",
        "workflow_version": "2.0.0",
        "schema_version": "2.0.0",
    },
    "repositories": [
        {
            "repository": "QualityOnDemand",
            "github_url": "https://github.com/camaraproject/QualityOnDemand",
            "latest_public_release": "r3.2",
            "newest_pre_release": "r4.1",
        },
        {
            "repository": "InactiveRepo",
            "github_url": "https://github.com/camaraproject/InactiveRepo",
            "latest_public_release": None,
            "newest_pre_release": None,
        },
    ],
    "releases": [
        {
            "repository": "QualityOnDemand",
            "release_tag": "r4.1",
            "release_date": "2026-02-10T14:30:00Z",
            "meta_release": "Sync26",
            "release_type": "pre-release-alpha",
            "github_url": "https://github.com/camaraproject/QualityOnDemand/releases/tag/r4.1",
            "apis": [
                {"api_name": "quality-on-demand", "file_name": "quality-on-demand",
                 "api_version": "1.2.0-alpha.1", "api_title": "Quality On Demand"},
            ],
        },
    ],
}


class MockGitHubAPI:
    """Mock GitHub API for testing."""

    def __init__(self, file_contents=None, branches=None, tags=None,
                 draft_releases=None, release_issues=None, release_prs=None):
        self.file_contents = file_contents or {}
        self.branches = branches or {}
        self.tags = tags or set()
        self.draft_releases = draft_releases or {}
        self.release_issues = release_issues or {}
        self.release_prs = release_prs or {}
        self.api_calls = 0

    def get_file_content(self, repo, path, ref="main"):
        self.api_calls += 1
        return self.file_contents.get(f"{repo}/{path}")

    def list_branches(self, repo, prefix=""):
        self.api_calls += 1
        all_branches = self.branches.get(repo, [])
        return [b for b in all_branches if not prefix or b.startswith(prefix)]

    def tag_exists(self, repo, tag):
        self.api_calls += 1
        return f"{repo}/{tag}" in self.tags

    def get_draft_releases(self, repo):
        self.api_calls += 1
        return self.draft_releases.get(repo, [])

    def find_release_issue(self, repo):
        self.api_calls += 1
        return self.release_issues.get(repo)

    def find_release_pr(self, repo, snapshot_branch):
        self.api_calls += 1
        return self.release_prs.get(f"{repo}/{snapshot_branch}")


# --- Tests ---

class TestParseReleasePlan:
    def test_valid_yaml(self):
        result = parse_release_plan(PLAN_RC)
        assert result["repository"]["target_release_type"] == "pre-release-rc"

    def test_invalid_yaml(self):
        result = parse_release_plan("{{invalid")
        assert result is None


class TestBuildPublishedContextMap:
    def test_builds_map(self):
        ctx = build_published_context_map(SAMPLE_MASTER["repositories"])
        assert ctx["QualityOnDemand"].latest_public_release == "r3.2"
        assert ctx["InactiveRepo"].latest_public_release is None


class TestCollectRepoProgress:
    def test_no_plan_returns_none(self):
        api = MockGitHubAPI()
        result = collect_repo_progress(
            "NoplanRepo", "https://github.com/camaraproject/NoplanRepo",
            api, [], PublishedContext(None, None),
        )
        assert result is None

    def test_not_planned_state(self):
        api = MockGitHubAPI(
            file_contents={"InactiveRepo/release-plan.yaml": PLAN_NONE},
        )
        result = collect_repo_progress(
            "InactiveRepo", "https://github.com/camaraproject/InactiveRepo",
            api, [], PublishedContext(None, None),
        )
        assert result.state == ProgressState.NOT_PLANNED

    def test_planned_state(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, SAMPLE_MASTER["releases"],
            PublishedContext("r3.2", "r4.1"),
        )
        assert result.state == ProgressState.PLANNED
        assert result.apis[0].api_name == "quality-on-demand"
        assert result.published_context.latest_public_release == "r3.2"

    def test_snapshot_active_state(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
            branches={"QualityOnDemand": ["release-snapshot/r4.1-abc123", "main"]},
            release_prs={"QualityOnDemand/release-snapshot/r4.1-abc123": {
                "number": 42, "state": "open",
                "url": "https://github.com/camaraproject/QualityOnDemand/pull/42",
            }},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.SNAPSHOT_ACTIVE
        assert result.artifacts.snapshot_branch == "release-snapshot/r4.1-abc123"
        assert result.artifacts.release_pr["number"] == 42

    def test_draft_ready_state(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
            branches={"QualityOnDemand": ["release-snapshot/r4.1-abc123"]},
            draft_releases={"QualityOnDemand": [
                {"name": "r4.1 pre-release-rc", "tag_name": "r4.1",
                 "html_url": "https://example.com/release", "draft": True},
            ]},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.DRAFT_READY
        assert result.artifacts.draft_release is not None

    def test_published_state(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
            tags={"QualityOnDemand/r4.1"},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, SAMPLE_MASTER["releases"],
            PublishedContext("r3.2", "r4.1"),
        )
        assert result.state == ProgressState.PUBLISHED

    def test_not_planned_skips_artifact_checks(self):
        """NOT_PLANNED repos should only call get_file_content + list_branches."""
        api = MockGitHubAPI(
            file_contents={"InactiveRepo/release-plan.yaml": PLAN_NONE},
        )
        result = collect_repo_progress(
            "InactiveRepo", "https://github.com/camaraproject/InactiveRepo",
            api, [], PublishedContext(None, None),
        )
        # get_file_content (1) + list_branches for orphan check (1) = 2
        assert api.api_calls == 2

    def test_warnings_attached(self):
        """Warnings should be generated and attached to entries."""
        api = MockGitHubAPI(
            file_contents={"InactiveRepo/release-plan.yaml": PLAN_NONE},
            branches={"InactiveRepo": ["release-snapshot/r4.1-abc"]},
        )
        # Create a plan with a target tag for the orphaned snapshot check
        plan_none_with_tag = yaml.dump({
            "repository": {
                "release_track": "meta-release",
                "meta_release": "Sync26",
                "target_release_tag": "r4.1",
                "target_release_type": "none",
            },
            "apis": [],
        })
        api.file_contents["InactiveRepo/release-plan.yaml"] = plan_none_with_tag

        result = collect_repo_progress(
            "InactiveRepo", "https://github.com/camaraproject/InactiveRepo",
            api, [], PublishedContext(None, None),
        )
        assert len(result.warnings) >= 1
        assert any(w.code == "W002" for w in result.warnings)


class TestCollectAll:
    def test_full_collection(self, tmp_path):
        """End-to-end test with mock API."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        api = MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "InactiveRepo/release-plan.yaml": PLAN_NONE,
            },
        )

        result = collect_all(str(master_file), str(output_file), api=api)

        assert result.collection_stats.repos_scanned == 2
        assert result.collection_stats.repos_with_plan == 2
        assert result.collection_stats.repos_planned == 1  # Only QoD is active

        # Verify output file written
        assert output_file.exists()
        output = yaml.safe_load(output_file.read_text())
        assert "metadata" in output
        assert "progress" in output
        assert len(output["progress"]) == 2

    def test_collection_handles_api_errors(self, tmp_path):
        """Repos with API errors should be skipped gracefully."""
        master_data = {
            "metadata": SAMPLE_MASTER["metadata"],
            "repositories": [
                {"repository": "ErrorRepo",
                 "github_url": "https://github.com/camaraproject/ErrorRepo"},
            ],
            "releases": [],
        }
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(master_data))

        class ErrorAPI(MockGitHubAPI):
            def get_file_content(self, repo, path, ref="main"):
                raise ConnectionError("Network error")

        api = ErrorAPI()
        result = collect_all(str(master_file), str(output_file), api=api)

        assert result.collection_stats.repos_scanned == 1
        assert result.collection_stats.repos_with_plan == 0
        assert len(result.progress) == 0
