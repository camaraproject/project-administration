"""Tests for validation warning infrastructure."""

import pytest

from scripts.warnings import generate_warnings, CHECKS
from scripts.models import (
    ProgressEntry, ProgressState, ProgressWarning,
    ApiEntry, ArtifactInfo, PublishedContext,
)


def _make_entry(**overrides):
    """Create a ProgressEntry with sensible defaults."""
    defaults = {
        "repository": "TestRepo",
        "github_url": "https://github.com/camaraproject/TestRepo",
        "state": ProgressState.PLANNED,
        "target_release_tag": "r4.1",
        "target_release_type": "pre-release-rc",
    }
    defaults.update(overrides)
    return ProgressEntry(**defaults)


class TestGenerateWarnings:
    """Test the warning generation framework."""

    def test_clean_entry_no_warnings(self):
        entry = _make_entry(state=ProgressState.PLANNED)
        warnings = generate_warnings(entry, [])
        assert warnings == []

    def test_returns_list_of_warning_objects(self):
        entry = _make_entry(
            state=ProgressState.NOT_PLANNED,
            target_release_type="none",
            artifacts=ArtifactInfo(snapshot_branch="release-snapshot/r4.1-abc"),
        )
        warnings = generate_warnings(entry, [])
        assert len(warnings) >= 1
        assert all(isinstance(w, ProgressWarning) for w in warnings)


class TestW001PublishedPlanDiverged:
    """Test W001: published but plan has moved on."""

    def test_triggers_when_versions_differ(self):
        entry = _make_entry(
            state=ProgressState.PUBLISHED,
            apis=[ApiEntry("quality-on-demand", "2.0.0", "public")],
        )
        releases = [{
            "release_tag": "r4.1",
            "apis": [{"api_name": "quality-on-demand", "api_version": "1.1.0"}],
        }]
        warnings = generate_warnings(entry, releases)
        w001 = [w for w in warnings if w.code == "W001"]
        assert len(w001) == 1
        assert "2.0.0" in w001[0].message
        assert "1.1.0" in w001[0].message

    def test_no_trigger_when_versions_match(self):
        entry = _make_entry(
            state=ProgressState.PUBLISHED,
            apis=[ApiEntry("quality-on-demand", "1.1.0", "public")],
        )
        releases = [{
            "release_tag": "r4.1",
            "apis": [{"api_name": "quality-on-demand", "api_version": "1.1.0-rc.2"}],
        }]
        warnings = generate_warnings(entry, releases)
        w001 = [w for w in warnings if w.code == "W001"]
        assert len(w001) == 0

    def test_no_trigger_for_non_published(self):
        entry = _make_entry(
            state=ProgressState.PLANNED,
            apis=[ApiEntry("quality-on-demand", "2.0.0", "rc")],
        )
        releases = [{
            "release_tag": "r4.1",
            "apis": [{"api_name": "quality-on-demand", "api_version": "1.1.0"}],
        }]
        warnings = generate_warnings(entry, releases)
        w001 = [w for w in warnings if w.code == "W001"]
        assert len(w001) == 0


class TestW002OrphanedSnapshot:
    """Test W002: snapshot exists but release type is none."""

    def test_triggers_when_snapshot_and_not_planned(self):
        entry = _make_entry(
            state=ProgressState.NOT_PLANNED,
            target_release_type="none",
            artifacts=ArtifactInfo(snapshot_branch="release-snapshot/r4.1-abc123"),
        )
        warnings = generate_warnings(entry, [])
        w002 = [w for w in warnings if w.code == "W002"]
        assert len(w002) == 1
        assert "release-snapshot/r4.1-abc123" in w002[0].message

    def test_no_trigger_without_snapshot(self):
        entry = _make_entry(
            state=ProgressState.NOT_PLANNED,
            target_release_type="none",
        )
        warnings = generate_warnings(entry, [])
        w002 = [w for w in warnings if w.code == "W002"]
        assert len(w002) == 0

    def test_no_trigger_for_active_state(self):
        entry = _make_entry(
            state=ProgressState.SNAPSHOT_ACTIVE,
            artifacts=ArtifactInfo(snapshot_branch="release-snapshot/r4.1-abc"),
        )
        warnings = generate_warnings(entry, [])
        w002 = [w for w in warnings if w.code == "W002"]
        assert len(w002) == 0


class TestChecksRegistry:
    """Test the extensibility pattern."""

    def test_checks_list_is_populated(self):
        assert len(CHECKS) >= 2

    def test_custom_check_can_be_added(self):
        """Verify a new check function integrates with generate_warnings."""
        def _check_always_warn(entry, releases):
            return [ProgressWarning("W999", "test warning", "info")]

        original_checks = CHECKS.copy()
        try:
            CHECKS.append(_check_always_warn)
            entry = _make_entry()
            warnings = generate_warnings(entry, [])
            w999 = [w for w in warnings if w.code == "W999"]
            assert len(w999) == 1
        finally:
            CHECKS.clear()
            CHECKS.extend(original_checks)
