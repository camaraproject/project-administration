"""Tests for state derivation logic."""

import pytest

from scripts.state_deriver import derive_state, find_matching_snapshot
from scripts.models import ProgressState


class TestDeriveState:
    """Test the 5-state derivation priority ordering."""

    def test_none_type_returns_not_planned(self):
        state = derive_state("none", "r4.1", False, [], [])
        assert state == ProgressState.NOT_PLANNED

    def test_missing_type_returns_not_planned(self):
        state = derive_state(None, "r4.1", False, [], [])
        assert state == ProgressState.NOT_PLANNED

    def test_tag_exists_returns_published(self):
        state = derive_state("pre-release-rc", "r4.1", True, [], [])
        assert state == ProgressState.PUBLISHED

    def test_published_takes_priority_over_snapshot(self):
        """Tag exists should win even if snapshot branch also exists."""
        state = derive_state(
            "pre-release-rc", "r4.1", True,
            ["release-snapshot/r4.1-abc123"], []
        )
        assert state == ProgressState.PUBLISHED

    def test_snapshot_with_draft_returns_draft_ready(self):
        state = derive_state(
            "pre-release-rc", "r4.1", False,
            ["release-snapshot/r4.1-abc123"],
            [{"name": "r4.1 pre-release-rc", "tag_name": "r4.1"}],
        )
        assert state == ProgressState.DRAFT_READY

    def test_snapshot_without_draft_returns_snapshot_active(self):
        state = derive_state(
            "pre-release-rc", "r4.1", False,
            ["release-snapshot/r4.1-abc123"], []
        )
        assert state == ProgressState.SNAPSHOT_ACTIVE

    def test_no_artifacts_returns_planned(self):
        state = derive_state("pre-release-rc", "r4.1", False, [], [])
        assert state == ProgressState.PLANNED

    def test_unrelated_snapshot_branch_ignored(self):
        """Snapshot for a different tag should not match."""
        state = derive_state(
            "pre-release-rc", "r4.1", False,
            ["release-snapshot/r3.2-def456"], []
        )
        assert state == ProgressState.PLANNED

    def test_all_release_types_derive_planned(self):
        """All non-none release types with no artifacts → PLANNED."""
        for rtype in ["pre-release-alpha", "pre-release-rc",
                       "public-release", "maintenance-release"]:
            state = derive_state(rtype, "r4.1", False, [], [])
            assert state == ProgressState.PLANNED


class TestFindMatchingSnapshot:
    """Test snapshot branch matching."""

    def test_matches_correct_prefix(self):
        result = find_matching_snapshot(
            ["release-snapshot/r4.1-abc123", "main"], "r4.1"
        )
        assert result == "release-snapshot/r4.1-abc123"

    def test_returns_first_match(self):
        result = find_matching_snapshot(
            ["release-snapshot/r4.1-first", "release-snapshot/r4.1-second"],
            "r4.1",
        )
        assert result == "release-snapshot/r4.1-first"

    def test_no_match_returns_none(self):
        result = find_matching_snapshot(
            ["release-snapshot/r3.2-abc123"], "r4.1"
        )
        assert result is None

    def test_none_tag_returns_none(self):
        result = find_matching_snapshot(["release-snapshot/r4.1-abc"], None)
        assert result is None

    def test_empty_branches_returns_none(self):
        result = find_matching_snapshot([], "r4.1")
        assert result is None
