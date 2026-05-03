"""Integration tests for the collector orchestrator with mocked GitHub API."""

import os
import tempfile

import pytest
import yaml

from scripts.collect_progress import (
    _check_completed_state,
    build_published_context_map,
    collect_all,
    collect_historical_entries,
    collect_repo_progress,
    compare_progress_data,
    load_releases_master,
    parse_release_plan,
)
from scripts.github_api import GitHubAPI
from scripts.models import ApiEntry, CycleReleases, ProgressEntry, ProgressState, PublishedContext

INDEPENDENT_RELEASE = {
    "repository": "IndependentRepo",
    "release_tag": "r2.1",
    "release_date": "2025-11-20T10:00:00Z",
    "meta_release": "Independent",
    "release_type": "public-release",
    "github_url": "https://github.com/camaraproject/IndependentRepo/releases/tag/r2.1",
    "apis": [{"api_name": "independent-api", "api_version": "1.0.0"}],
}


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

    def find_release_issue(self, repo, target_tag=None):
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

    def test_draft_ready_state_from_release_issue_fallback(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
            branches={"QualityOnDemand": ["release-snapshot/r4.1-abc123"]},
            release_issues={"QualityOnDemand": {
                "number": 82,
                "url": "https://github.com/camaraproject/QualityOnDemand/issues/82",
                "labels": ["release-issue", "release-state:draft-ready"],
                "body": (
                    "<!-- release-automation:workflow-owned -->\n"
                    "<!-- release-automation:release-tag:r4.1 -->\n"
                    "**State:** `draft-ready`\n\n"
                    "**Draft release:** "
                    "https://github.com/camaraproject/QualityOnDemand/"
                    "releases/tag/untagged-abc123"
                ),
            }},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.DRAFT_READY
        assert result.artifacts.draft_release == {
            "name": "r4.1",
            "url": (
                "https://github.com/camaraproject/QualityOnDemand/"
                "releases/tag/untagged-abc123"
            ),
        }
        assert result.artifacts.release_issue == {
            "number": 82,
            "url": "https://github.com/camaraproject/QualityOnDemand/issues/82",
        }

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

    def test_planned_with_caller_workflow(self):
        """PLANNED repo with caller workflow → has_caller_workflow=True, no W005."""
        api = MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "QualityOnDemand/.github/workflows/release-automation.yml": "name: release",
            },
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.PLANNED
        assert result.artifacts.has_caller_workflow is True
        assert not any(w.code == "W005" for w in result.warnings)

    def test_planned_without_caller_workflow(self):
        """PLANNED repo without caller workflow → has_caller_workflow=False, W005."""
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.PLANNED
        assert result.artifacts.has_caller_workflow is False
        assert any(w.code == "W005" for w in result.warnings)


class TestCompareProgressData:
    """Tests for the two-phase comparison logic."""

    SAMPLE_OUTPUT = {
        "metadata": {
            "last_updated": "2026-03-01T00:00:00Z",
            "last_checked": "2026-03-01T00:00:00Z",
            "releases_master_updated": "2026-03-01T00:00:00Z",
            "schema_version": "1.1.0",
            "collector_version": "1.1.0",
        },
        "meta_releases": [
            {"name": "Sync26", "total_apis": 5, "m1_achieved": 2,
             "m3_achieved": 1, "m4_achieved": 0},
        ],
        "progress": [
            {"repository": "QualityOnDemand", "state": "planned",
             "github_url": "https://example.com/QoD"},
            {"repository": "InactiveRepo", "state": "not_planned",
             "github_url": "https://example.com/Inactive"},
        ],
    }

    def test_identical_data_returns_false(self):
        """Same progress + meta_releases → no change."""
        import copy
        existing = copy.deepcopy(self.SAMPLE_OUTPUT)
        new = copy.deepcopy(self.SAMPLE_OUTPUT)
        # Metadata differs (timestamps) but stable data is the same
        new["metadata"]["last_checked"] = "2026-03-02T00:00:00Z"
        assert compare_progress_data(new, existing) is False

    def test_different_progress_returns_true(self):
        """Changed state → change detected."""
        import copy
        existing = copy.deepcopy(self.SAMPLE_OUTPUT)
        new = copy.deepcopy(self.SAMPLE_OUTPUT)
        new["progress"][0]["state"] = "snapshot_active"
        assert compare_progress_data(new, existing) is True

    def test_different_meta_releases_returns_true(self):
        """Changed counts → change detected."""
        import copy
        existing = copy.deepcopy(self.SAMPLE_OUTPUT)
        new = copy.deepcopy(self.SAMPLE_OUTPUT)
        new["meta_releases"][0]["m1_achieved"] = 3
        assert compare_progress_data(new, existing) is True

    def test_different_order_same_data_returns_false(self):
        """Repos in different order → no change (normalization)."""
        import copy
        existing = copy.deepcopy(self.SAMPLE_OUTPUT)
        new = copy.deepcopy(self.SAMPLE_OUTPUT)
        new["progress"] = list(reversed(new["progress"]))
        assert compare_progress_data(new, existing) is False

    def test_empty_existing_returns_true(self):
        """No existing data → always changed."""
        import copy
        new = copy.deepcopy(self.SAMPLE_OUTPUT)
        assert compare_progress_data(new, {}) is True

    def test_new_repo_added_returns_true(self):
        """New repo in progress → change detected."""
        import copy
        existing = copy.deepcopy(self.SAMPLE_OUTPUT)
        new = copy.deepcopy(self.SAMPLE_OUTPUT)
        new["progress"].append(
            {"repository": "NewRepo", "state": "planned",
             "github_url": "https://example.com/New"},
        )
        assert compare_progress_data(new, existing) is True


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

        # Verify output file written with new schema
        assert output_file.exists()
        output = yaml.safe_load(output_file.read_text())
        assert "metadata" in output
        assert "progress" in output
        assert len(output["progress"]) == 2

        # Verify new metadata fields
        meta = output["metadata"]
        assert "last_updated" in meta
        assert "last_checked" in meta
        assert "releases_master_updated" in meta
        assert meta["schema_version"] == "1.5.0"
        assert "collection_stats" not in meta  # Full stats removed from output
        assert meta["repos_scanned"] == 2      # Stable stats restored
        assert meta["repos_with_plan"] == 2
        assert meta["repos_fully_onboarded"] == 0  # No caller workflow or active state
        assert meta["repos_with_release_issue"] == 0  # No release issues mocked

    def test_collection_aborts_on_per_repo_error(self, tmp_path):
        """Per-repo failures abort the collection rather than silently dropping rows.

        The existing output file must be preserved so the workflow does not
        deploy partial data (PA#209).
        """
        from scripts.collect_progress import CollectionAbortedError

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
        with pytest.raises(CollectionAbortedError, match="ErrorRepo"):
            collect_all(str(master_file), str(output_file), api=api)

        assert not output_file.exists()

    def test_collection_aborts_on_rate_limit(self, tmp_path):
        """RateLimitError mid-loop aborts collection (PA#224).

        The corrupted-PR symptom from ReleaseManagement#507 was caused by
        the collector continuing to historical-fallback after a rate-limit
        abort. The new contract is: raise CollectionAbortedError, leave
        the existing releases-progress.yaml in place.
        """
        from scripts.collect_progress import CollectionAbortedError
        from scripts.github_api import RateLimitError

        master_data = {
            "metadata": SAMPLE_MASTER["metadata"],
            "repositories": [
                {"repository": "RepoA",
                 "github_url": "https://github.com/camaraproject/RepoA"},
                {"repository": "RepoB",
                 "github_url": "https://github.com/camaraproject/RepoB"},
            ],
            "releases": [],
        }
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(master_data))

        class RateLimitedAPI(MockGitHubAPI):
            def get_file_content(self, repo, path, ref="main"):
                raise RateLimitError("budget exhausted")

        api = RateLimitedAPI()
        with pytest.raises(CollectionAbortedError, match="Rate limit exhausted"):
            collect_all(str(master_file), str(output_file), api=api)

        assert not output_file.exists()

    def test_releases_master_updated_populated(self, tmp_path):
        """releases_master_updated should be read from master file metadata."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_RC},
        )
        result = collect_all(str(master_file), str(output_file), api=api)

        assert result.releases_master_updated == "2026-03-01T00:00:00Z"
        output = yaml.safe_load(output_file.read_text())
        assert output["metadata"]["releases_master_updated"] == "2026-03-01T00:00:00Z"


class TestCollectAllWithExisting:
    """Tests for the two-phase write with existing file comparison."""

    def _make_api(self):
        return MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "InactiveRepo/release-plan.yaml": PLAN_NONE,
            },
        )

    def test_no_existing_file_treated_as_changed(self, tmp_path):
        """Missing existing file → data_changed = True."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        result = collect_all(
            str(master_file), str(output_file),
            existing_path=str(tmp_path / "nonexistent.yaml"),
            api=self._make_api(),
        )
        assert result.data_changed is True

    def test_unchanged_carries_forward_last_updated(self, tmp_path):
        """Same data → last_updated preserved from existing, data_changed = False."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        existing_file = tmp_path / "existing.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        # First run: generate baseline
        api1 = self._make_api()
        collect_all(str(master_file), str(output_file), api=api1)

        # Copy output as existing file
        existing_file.write_text(output_file.read_text())
        original_output = yaml.safe_load(existing_file.read_text())
        original_last_updated = original_output["metadata"]["last_updated"]

        # Second run: same data, with existing
        api2 = self._make_api()
        result = collect_all(
            str(master_file), str(output_file),
            existing_path=str(existing_file),
            api=api2,
        )

        assert result.data_changed is False
        assert result.last_updated == original_last_updated
        # last_checked should be current (newer than last_updated)
        assert result.last_checked >= original_last_updated

    def test_changed_data_updates_last_updated(self, tmp_path):
        """Different data → last_updated = last_checked, data_changed = True."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        existing_file = tmp_path / "existing.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        # First run: generate baseline
        api1 = self._make_api()
        collect_all(str(master_file), str(output_file), api=api1)
        existing_file.write_text(output_file.read_text())

        # Second run: different data (add snapshot branch → state change)
        api2 = MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "InactiveRepo/release-plan.yaml": PLAN_NONE,
            },
            branches={"QualityOnDemand": ["release-snapshot/r4.1-abc123"]},
        )
        result = collect_all(
            str(master_file), str(output_file),
            existing_path=str(existing_file),
            api=api2,
        )

        assert result.data_changed is True
        assert result.last_updated == result.last_checked

    def test_no_existing_path_always_changed(self, tmp_path):
        """No existing_path argument → data_changed = True (default)."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        result = collect_all(
            str(master_file), str(output_file),
            api=self._make_api(),
        )
        assert result.data_changed is True


# Fixtures for COMPLETED / HISTORICAL tests

PUBLIC_RELEASE = {
    "repository": "QualityOnDemand",
    "release_tag": "r3.2",
    "release_date": "2025-11-15T10:00:00Z",
    "meta_release": "Fall25",
    "release_type": "public-release",
    "github_url": "https://github.com/camaraproject/QualityOnDemand/releases/tag/r3.2",
    "apis": [{"api_name": "quality-on-demand", "api_version": "1.0.0"}],
}

PLAN_COMPLETED = yaml.dump({
    "repository": {
        "release_track": "meta-release",
        "meta_release": "Fall25",
        "target_release_tag": "r3.2",
        "target_release_type": "none",
    },
    "apis": [{"api_name": "quality-on-demand", "target_api_version": "1.0.0",
              "target_api_status": "stable"}],
})

PLAN_NONE_WITH_TAG = yaml.dump({
    "repository": {
        "release_track": "meta-release",
        "meta_release": "Fall25",
        "target_release_tag": "r3.2",
        "target_release_type": "none",
    },
    "apis": [{"api_name": "quality-on-demand", "target_api_version": "0.9.0",
              "target_api_status": "stable"}],
})

HISTORICAL_MASTER = {
    "metadata": SAMPLE_MASTER["metadata"],
    "repositories": [
        {
            "repository": "QualityOnDemand",
            "github_url": "https://github.com/camaraproject/QualityOnDemand",
            "latest_public_release": "r3.2",
            "newest_pre_release": None,
        },
        {
            "repository": "DeviceLocation",
            "github_url": "https://github.com/camaraproject/DeviceLocation",
            "latest_public_release": "r3.1",
            "newest_pre_release": None,
        },
    ],
    "releases": [
        PUBLIC_RELEASE,
        {
            "repository": "DeviceLocation",
            "release_tag": "r3.1",
            "release_date": "2025-11-10T10:00:00Z",
            "meta_release": "Fall25",
            "release_type": "public-release",
            "github_url": "https://github.com/camaraproject/DeviceLocation/releases/tag/r3.1",
            "apis": [{"api_name": "device-location", "api_version": "2.0.0"}],
        },
    ],
}


class TestCheckCompletedState:
    def _make_entry(self, tag, apis, state=ProgressState.NOT_PLANNED):
        return ProgressEntry(
            repository="QualityOnDemand",
            github_url="https://github.com/camaraproject/QualityOnDemand",
            target_release_tag=tag,
            target_release_type="none",
            apis=apis,
            state=state,
        )

    def test_exact_match_returns_completed(self):
        entry = self._make_entry(
            "r3.2",
            [ApiEntry("quality-on-demand", "1.0.0", "stable")],
        )
        result = _check_completed_state(entry, [PUBLIC_RELEASE])
        assert result == ProgressState.COMPLETED

    def test_version_mismatch_returns_not_planned(self):
        entry = self._make_entry(
            "r3.2",
            [ApiEntry("quality-on-demand", "0.9.0", "stable")],
        )
        result = _check_completed_state(entry, [PUBLIC_RELEASE])
        assert result == ProgressState.NOT_PLANNED

    def test_tag_mismatch_returns_not_planned(self):
        entry = self._make_entry(
            "r3.1",  # different tag
            [ApiEntry("quality-on-demand", "1.0.0", "stable")],
        )
        result = _check_completed_state(entry, [PUBLIC_RELEASE])
        assert result == ProgressState.NOT_PLANNED

    def test_no_tag_returns_not_planned(self):
        entry = self._make_entry(None, [ApiEntry("quality-on-demand", "1.0.0", "stable")])
        result = _check_completed_state(entry, [PUBLIC_RELEASE])
        assert result == ProgressState.NOT_PLANNED

    def test_empty_apis_returns_not_planned(self):
        entry = self._make_entry("r3.2", [])
        result = _check_completed_state(entry, [PUBLIC_RELEASE])
        assert result == ProgressState.NOT_PLANNED

    def test_no_public_release_returns_not_planned(self):
        pre_release = {**PUBLIC_RELEASE, "release_type": "pre-release-rc"}
        entry = self._make_entry(
            "r3.2",
            [ApiEntry("quality-on-demand", "1.0.0", "stable")],
        )
        result = _check_completed_state(entry, [pre_release])
        assert result == ProgressState.NOT_PLANNED

    def test_most_recent_public_release_used(self):
        """When multiple public releases exist, any matching tag returns COMPLETED."""
        older = {**PUBLIC_RELEASE, "release_tag": "r3.1",
                 "release_date": "2025-10-01T00:00:00Z"}
        entry = self._make_entry(
            "r3.2",
            [ApiEntry("quality-on-demand", "1.0.0", "stable")],
        )
        # r3.2 (PUBLIC_RELEASE) matches exactly
        result = _check_completed_state(entry, [older, PUBLIC_RELEASE])
        assert result == ProgressState.COMPLETED

    def test_maintenance_release_tag_returns_completed(self):
        """Plan pointing to a maintenance-release tag also counts as COMPLETED."""
        maintenance = {**PUBLIC_RELEASE, "release_tag": "r3.3",
                       "release_date": "2025-12-01T00:00:00Z",
                       "release_type": "maintenance-release"}
        entry = self._make_entry(
            "r3.3",
            [ApiEntry("quality-on-demand", "1.0.0", "stable")],
        )
        result = _check_completed_state(entry, [PUBLIC_RELEASE, maintenance])
        assert result == ProgressState.COMPLETED

    def test_pre_release_tag_not_accepted(self):
        """Plan pointing to a pre-release tag is NOT counted as COMPLETED."""
        pre_release = {**PUBLIC_RELEASE, "release_tag": "r3.1",
                       "release_date": "2025-09-01T00:00:00Z",
                       "release_type": "pre-release-rc"}
        entry = self._make_entry(
            "r3.1",
            [ApiEntry("quality-on-demand", "1.0.0", "stable")],
        )
        result = _check_completed_state(entry, [pre_release])
        assert result == ProgressState.NOT_PLANNED


class TestCollectRepoProgressCompleted:
    def test_completed_state_when_exact_match(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_COMPLETED},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [PUBLIC_RELEASE], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.COMPLETED

    def test_not_planned_when_version_mismatch(self):
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_NONE_WITH_TAG},
        )
        result = collect_repo_progress(
            "QualityOnDemand",
            "https://github.com/camaraproject/QualityOnDemand",
            api, [PUBLIC_RELEASE], PublishedContext("r3.2", None),
        )
        assert result.state == ProgressState.NOT_PLANNED


class TestCollectHistoricalEntries:
    def test_creates_entry_for_repo_without_plan(self):
        active = set()  # No active entries
        repo_url_map = {
            "QualityOnDemand": "https://github.com/camaraproject/QualityOnDemand",
        }
        entries = collect_historical_entries([PUBLIC_RELEASE], active, repo_url_map)

        assert len(entries) == 1
        e = entries[0]
        assert e.repository == "QualityOnDemand"
        assert e.state == ProgressState.HISTORICAL
        assert e.source == "historical"
        assert e.meta_release == "Fall25"
        assert e.target_release_tag is None
        assert e.target_release_type is None

    def test_skips_repo_already_in_active(self):
        active = {("QualityOnDemand", "Fall25")}
        repo_url_map = {"QualityOnDemand": "https://github.com/camaraproject/QualityOnDemand"}
        entries = collect_historical_entries([PUBLIC_RELEASE], active, repo_url_map)
        assert len(entries) == 0

    def test_derives_cycle_releases(self):
        active = set()
        repo_url_map = {"QualityOnDemand": "https://github.com/camaraproject/QualityOnDemand"}
        entries = collect_historical_entries([PUBLIC_RELEASE], active, repo_url_map)
        assert len(entries) == 1
        cr = entries[0].cycle_releases
        assert cr.m4 is not None
        assert cr.m4.release_tag == "r3.2"

    def test_apis_populated_from_best_release(self):
        active = set()
        repo_url_map = {"QualityOnDemand": "https://github.com/camaraproject/QualityOnDemand"}
        entries = collect_historical_entries([PUBLIC_RELEASE], active, repo_url_map)
        assert len(entries[0].apis) == 1
        assert entries[0].apis[0].api_name == "quality-on-demand"
        assert entries[0].apis[0].target_api_version == "1.0.0"

    def test_skips_release_without_meta_release(self):
        release_no_meta = {**PUBLIC_RELEASE, "meta_release": ""}
        entries = collect_historical_entries([release_no_meta], set(), {})
        assert len(entries) == 0

    def test_independent_without_active_creates_entry(self):
        entries = collect_historical_entries(
            [INDEPENDENT_RELEASE], set(),
            {"IndependentRepo": "https://github.com/camaraproject/IndependentRepo"},
        )
        assert len(entries) == 1
        assert entries[0].release_track == "independent"
        assert entries[0].meta_release is None
        assert entries[0].state == ProgressState.HISTORICAL

    def test_independent_with_active_same_prefix_skipped(self):
        active = ProgressEntry(
            repository="IndependentRepo",
            github_url="https://github.com/camaraproject/IndependentRepo",
            target_release_tag="r2.1",
            state=ProgressState.PLANNED,
        )
        entries = collect_historical_entries(
            [INDEPENDENT_RELEASE], set(),
            {"IndependentRepo": "https://github.com/camaraproject/IndependentRepo"},
            active_entries=[active],
        )
        assert len(entries) == 0

    def test_independent_with_active_different_prefix_creates_entry(self):
        active = ProgressEntry(
            repository="IndependentRepo",
            github_url="https://github.com/camaraproject/IndependentRepo",
            target_release_tag="r3.1",  # different cycle prefix (r3. vs r2.)
            state=ProgressState.PLANNED,
        )
        entries = collect_historical_entries(
            [INDEPENDENT_RELEASE], set(),
            {"IndependentRepo": "https://github.com/camaraproject/IndependentRepo"},
            active_entries=[active],
        )
        assert len(entries) == 1
        assert entries[0].release_track == "independent"


class TestCollectAllWithHistorical:
    def test_historical_entries_added_for_repos_without_plan(self, tmp_path):
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(HISTORICAL_MASTER))

        # Only QoD has a release-plan.yaml (with active plan)
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_COMPLETED},
        )
        result = collect_all(str(master_file), str(output_file), api=api)

        repos = {e.repository for e in result.progress}
        # DeviceLocation has no plan → gets a historical entry
        assert "DeviceLocation" in repos

        dev_entry = next(e for e in result.progress if e.repository == "DeviceLocation")
        assert dev_entry.state == ProgressState.HISTORICAL
        assert dev_entry.source == "historical"

    def test_independent_repo_appears_as_historical(self, tmp_path):
        master_with_independent = {
            "metadata": SAMPLE_MASTER["metadata"],
            "repositories": [
                {
                    "repository": "IndependentRepo",
                    "github_url": "https://github.com/camaraproject/IndependentRepo",
                    "latest_public_release": "r2.1",
                    "newest_pre_release": None,
                },
            ],
            "releases": [INDEPENDENT_RELEASE],
        }
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(master_with_independent))

        api = MockGitHubAPI()  # No release-plan.yaml for IndependentRepo
        result = collect_all(str(master_file), str(output_file), api=api)

        independent_entries = [e for e in result.progress if e.repository == "IndependentRepo"]
        assert len(independent_entries) == 1
        e = independent_entries[0]
        assert e.state == ProgressState.HISTORICAL
        assert e.release_track == "independent"
        assert e.meta_release is None

    def test_completed_repo_not_duplicated_as_historical(self, tmp_path):
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(HISTORICAL_MASTER))

        # QoD has a plan → should appear once as COMPLETED, not again as HISTORICAL
        api = MockGitHubAPI(
            file_contents={"QualityOnDemand/release-plan.yaml": PLAN_COMPLETED},
        )
        result = collect_all(str(master_file), str(output_file), api=api)

        qod_entries = [e for e in result.progress if e.repository == "QualityOnDemand"]
        assert len(qod_entries) == 1
        assert qod_entries[0].state == ProgressState.COMPLETED


class TestKPIStatistics:
    """Test PA#198 KPI cascade statistics."""

    def test_planned_with_caller_workflow_is_fully_onboarded(self, tmp_path):
        """PLANNED repo with caller workflow counts as fully onboarded."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        api = MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "QualityOnDemand/.github/workflows/release-automation.yml": "name: RA",
                "InactiveRepo/release-plan.yaml": PLAN_NONE,
            },
        )
        result = collect_all(str(master_file), str(output_file), api=api)
        assert result.collection_stats.repos_fully_onboarded == 1

    def test_planned_without_caller_workflow_not_fully_onboarded(self, tmp_path):
        """PLANNED repo without caller workflow is not fully onboarded."""
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
        assert result.collection_stats.repos_fully_onboarded == 0

    def test_snapshot_active_implies_fully_onboarded(self, tmp_path):
        """SNAPSHOT_ACTIVE state implies caller workflow exists."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        api = MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "InactiveRepo/release-plan.yaml": PLAN_NONE,
            },
            branches={"QualityOnDemand": ["release-snapshot/r4.1-abc123"]},
        )
        result = collect_all(str(master_file), str(output_file), api=api)
        assert result.collection_stats.repos_fully_onboarded == 1

    def test_release_issue_counted(self, tmp_path):
        """Repos with release issues are counted."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(SAMPLE_MASTER))

        api = MockGitHubAPI(
            file_contents={
                "QualityOnDemand/release-plan.yaml": PLAN_RC,
                "InactiveRepo/release-plan.yaml": PLAN_NONE,
            },
            release_issues={
                "QualityOnDemand": {
                    "number": 42,
                    "url": "https://github.com/camaraproject/QualityOnDemand/issues/42",
                    "labels": ["release-issue"],
                    "body": "<!-- release-automation:release-tag:r4.1 -->",
                },
            },
        )
        result = collect_all(str(master_file), str(output_file), api=api)
        assert result.collection_stats.repos_with_release_issue == 1

    def test_kpi_fields_in_metadata_output(self, tmp_path):
        """New KPI fields must appear in serialized metadata."""
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
        output = yaml.safe_load(output_file.read_text())
        meta = output["metadata"]
        assert "repos_fully_onboarded" in meta
        assert "repos_with_release_issue" in meta
        assert isinstance(meta["repos_fully_onboarded"], int)
        assert isinstance(meta["repos_with_release_issue"], int)


class TestExcludeArchivedAndSplit:
    """PA#201: archived and split umbrella repos must not inflate the active count."""

    def _master(self):
        return {
            "metadata": SAMPLE_MASTER["metadata"],
            "repositories": [
                {
                    "repository": "ActivePlanned",
                    "github_url": "https://github.com/camaraproject/ActivePlanned",
                    "latest_public_release": "r3.2",
                    "newest_pre_release": None,
                },
                {
                    "repository": "BrandNew",
                    "github_url": "https://github.com/camaraproject/BrandNew",
                    "latest_public_release": None,
                    "newest_pre_release": None,
                },
                {
                    "repository": "ArchivedWithHistory",
                    "github_url": "https://github.com/camaraproject/ArchivedWithHistory",
                    "repository_archived": True,
                    "latest_public_release": "r1.2",
                    "newest_pre_release": None,
                },
                {
                    "repository": "ArchivedEmpty",
                    "github_url": "https://github.com/camaraproject/ArchivedEmpty",
                    "repository_archived": True,
                    "latest_public_release": None,
                    "newest_pre_release": None,
                },
                {
                    # In SPLIT_REPOSITORIES → excluded from active count
                    "repository": "DeviceStatus",
                    "github_url": "https://github.com/camaraproject/DeviceStatus",
                    "latest_public_release": "r2.2",
                    "newest_pre_release": None,
                },
            ],
            "releases": [
                {
                    "repository": "ActivePlanned",
                    "release_tag": "r3.2",
                    "release_date": "2025-11-15T10:00:00Z",
                    "meta_release": "Fall25",
                    "release_type": "public-release",
                    "github_url": "https://github.com/camaraproject/ActivePlanned/releases/tag/r3.2",
                    "apis": [{"api_name": "active-planned", "api_version": "1.0.0"}],
                },
                {
                    "repository": "ArchivedWithHistory",
                    "release_tag": "r1.2",
                    "release_date": "2024-10-15T10:00:00Z",
                    "meta_release": "Fall24",
                    "release_type": "public-release",
                    "github_url": "https://github.com/camaraproject/ArchivedWithHistory/releases/tag/r1.2",
                    "apis": [{"api_name": "archived-api", "api_version": "1.0.0"}],
                },
                {
                    "repository": "DeviceStatus",
                    "release_tag": "r2.2",
                    "release_date": "2025-03-14T11:49:32Z",
                    "meta_release": "Spring25",
                    "release_type": "public-release",
                    "github_url": "https://github.com/camaraproject/DeviceStatus/releases/tag/r2.2",
                    "apis": [{"api_name": "device-reachability-status", "api_version": "1.0.0"}],
                },
            ],
        }

    def test_scanned_count_excludes_archived_and_split(self, tmp_path):
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(self._master()))

        api = MockGitHubAPI(
            file_contents={"ActivePlanned/release-plan.yaml": PLAN_RC},
        )
        result = collect_all(str(master_file), str(output_file), api=api)

        # 5 repos in master; 2 archived + 1 split → 2 active
        assert result.collection_stats.repos_scanned == 2
        assert result.collection_stats.repos_with_plan == 1

    def test_brand_new_counted(self, tmp_path):
        """Active repos with no release and no plan count as 'new'."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(self._master()))

        api = MockGitHubAPI(
            file_contents={"ActivePlanned/release-plan.yaml": PLAN_RC},
        )
        result = collect_all(str(master_file), str(output_file), api=api)

        # BrandNew has no plan and no releases → +1 new
        # ActivePlanned has a plan → not new
        # Archived/split repos are filtered out entirely
        assert result.collection_stats.repos_new == 1

    def test_historical_releases_preserved_for_excluded_repos(self, tmp_path):
        """Archived and split repos still contribute historical entries."""
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(self._master()))

        api = MockGitHubAPI(
            file_contents={"ActivePlanned/release-plan.yaml": PLAN_RC},
        )
        result = collect_all(str(master_file), str(output_file), api=api)

        repos_in_progress = {e.repository for e in result.progress}
        assert "ArchivedWithHistory" in repos_in_progress
        assert "DeviceStatus" in repos_in_progress
        # No releases → no historical entry
        assert "ArchivedEmpty" not in repos_in_progress

        archived_entry = next(
            e for e in result.progress if e.repository == "ArchivedWithHistory"
        )
        assert archived_entry.state == ProgressState.HISTORICAL
        split_entry = next(
            e for e in result.progress if e.repository == "DeviceStatus"
        )
        assert split_entry.state == ProgressState.HISTORICAL

    def test_repos_new_in_serialized_metadata(self, tmp_path):
        master_file = tmp_path / "releases-master.yaml"
        output_file = tmp_path / "releases-progress.yaml"
        master_file.write_text(yaml.dump(self._master()))

        api = MockGitHubAPI(
            file_contents={"ActivePlanned/release-plan.yaml": PLAN_RC},
        )
        collect_all(str(master_file), str(output_file), api=api)

        output = yaml.safe_load(output_file.read_text())
        meta = output["metadata"]
        assert meta["repos_scanned"] == 2
        assert meta["repos_new"] == 1
        assert isinstance(meta["repos_new"], int)
