"""Tests for data model serialization."""

import yaml

from scripts.models import (
    ApiEntry,
    ArtifactInfo,
    CollectionStats,
    CycleReleaseApi,
    CycleReleases,
    MetaReleaseSummary,
    MilestoneRelease,
    ProgressData,
    ProgressEntry,
    ProgressState,
    ProgressWarning,
    PublishedContext,
)


class TestProgressWarning:
    def test_to_dict(self):
        w = ProgressWarning("W001", "test message", "warning")
        assert w.to_dict() == {
            "code": "W001",
            "message": "test message",
            "severity": "warning",
        }


class TestApiEntry:
    def test_to_dict_with_contacts(self):
        a = ApiEntry("quality-on-demand", "1.2.0", "rc", ["user1"])
        d = a.to_dict()
        assert d["api_name"] == "quality-on-demand"
        assert d["main_contacts"] == ["user1"]

    def test_to_dict_without_contacts(self):
        a = ApiEntry("quality-on-demand", "1.2.0", "rc")
        d = a.to_dict()
        assert "main_contacts" not in d


class TestArtifactInfo:
    def test_empty_artifacts(self):
        a = ArtifactInfo()
        d = a.to_dict()
        assert d["snapshot_branch"] is None
        assert d["release_pr"] is None

    def test_populated_artifacts(self):
        a = ArtifactInfo(
            snapshot_branch="release-snapshot/r4.1-abc",
            release_pr={"number": 42, "state": "open", "url": "https://example.com"},
        )
        d = a.to_dict()
        assert d["snapshot_branch"] == "release-snapshot/r4.1-abc"
        assert d["release_pr"]["number"] == 42


class TestCycleReleases:
    def test_empty_cycle(self):
        cr = CycleReleases()
        assert cr.to_dict() == {}

    def test_partial_cycle(self):
        cr = CycleReleases(
            m1=MilestoneRelease("r4.1", "2026-02-10T14:30:00Z",
                [CycleReleaseApi("api-a", "1.0.0-alpha.1")]),
        )
        d = cr.to_dict()
        assert "m1" in d
        assert "m3" not in d


class TestProgressEntry:
    def test_full_serialization_round_trip(self):
        entry = ProgressEntry(
            repository="QualityOnDemand",
            github_url="https://github.com/camaraproject/QualityOnDemand",
            release_track="meta-release",
            meta_release="Sync26",
            target_release_tag="r4.2",
            target_release_type="pre-release-rc",
            apis=[ApiEntry("quality-on-demand", "1.2.0", "rc")],
            state=ProgressState.SNAPSHOT_ACTIVE,
            artifacts=ArtifactInfo(snapshot_branch="release-snapshot/r4.2-abc"),
            published_context=PublishedContext("r3.2", "r4.1"),
            warnings=[ProgressWarning("W001", "test", "warning")],
        )
        d = entry.to_dict()

        assert d["repository"] == "QualityOnDemand"
        assert d["state"] == "snapshot_active"
        assert d["published_context"]["latest_public_release"] == "r3.2"
        assert len(d["warnings"]) == 1
        assert d["warnings"][0]["code"] == "W001"

        # Verify YAML serializable
        yaml_str = yaml.dump(d, default_flow_style=False)
        reloaded = yaml.safe_load(yaml_str)
        assert reloaded["state"] == "snapshot_active"
        assert reloaded["warnings"][0]["code"] == "W001"

    def test_not_planned_entry(self):
        entry = ProgressEntry(
            repository="InactiveRepo",
            github_url="https://github.com/camaraproject/InactiveRepo",
            target_release_type="none",
            state=ProgressState.NOT_PLANNED,
        )
        d = entry.to_dict()
        assert d["state"] == "not_planned"
        assert d["apis"] == []
        assert "warnings" not in d  # Empty list omitted


class TestProgressData:
    def test_full_output_structure(self):
        data = ProgressData(
            last_updated="2026-03-15T10:00:00Z",
            collection_stats=CollectionStats(
                repos_scanned=63, repos_with_plan=45,
                repos_planned=38, api_calls=200, duration_seconds=95.3,
            ),
            meta_releases=[
                MetaReleaseSummary("Sync26", 48, 35, 22, 8),
            ],
            progress=[
                ProgressEntry(
                    repository="TestRepo",
                    github_url="https://github.com/camaraproject/TestRepo",
                    state=ProgressState.PLANNED,
                    target_release_type="pre-release-rc",
                ),
            ],
        )
        d = data.to_dict()

        assert d["metadata"]["schema_version"] == "1.0.0"
        assert d["metadata"]["collection_stats"]["repos_scanned"] == 63
        assert len(d["meta_releases"]) == 1
        assert d["meta_releases"][0]["name"] == "Sync26"
        assert len(d["progress"]) == 1

        # Full YAML round-trip
        yaml_str = yaml.dump(d, default_flow_style=False, sort_keys=False)
        reloaded = yaml.safe_load(yaml_str)
        assert reloaded["metadata"]["collector_version"] == "1.0.0"
