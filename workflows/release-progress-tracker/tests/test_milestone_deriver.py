"""Tests for M1/M3/M4 milestone derivation."""

import pytest

from scripts.milestone_deriver import (
    derive_cycle_releases,
    build_meta_release_summaries,
)
from scripts.models import (
    ProgressEntry, ProgressState, ApiEntry,
    CycleReleases, MilestoneRelease, CycleReleaseApi,
)


SAMPLE_RELEASES = [
    {
        "repository": "QualityOnDemand",
        "release_tag": "r4.1",
        "release_date": "2026-02-10T14:30:00Z",
        "meta_release": "Sync26",
        "release_type": "pre-release-alpha",
        "apis": [
            {"api_name": "quality-on-demand", "api_version": "1.2.0-alpha.1"},
        ],
    },
    {
        "repository": "QualityOnDemand",
        "release_tag": "r4.2",
        "release_date": "2026-03-15T10:00:00Z",
        "meta_release": "Sync26",
        "release_type": "pre-release-rc",
        "apis": [
            {"api_name": "quality-on-demand", "api_version": "1.2.0-rc.1"},
        ],
    },
    {
        "repository": "DeviceLocation",
        "release_tag": "r5.1",
        "release_date": "2026-02-15T08:00:00Z",
        "meta_release": "Sync26",
        "release_type": "pre-release-alpha",
        "apis": [
            {"api_name": "location-verification", "api_version": "2.0.0-alpha.1"},
        ],
    },
    {
        "repository": "QualityOnDemand",
        "release_tag": "r3.5",
        "release_date": "2025-11-01T12:00:00Z",
        "meta_release": "Fall25",
        "release_type": "public-release",
        "apis": [
            {"api_name": "quality-on-demand", "api_version": "1.1.0"},
        ],
    },
]


class TestDeriveCycleReleases:
    """Test M1/M3/M4 derivation from releases."""

    def test_m1_alpha_detected(self):
        cr = derive_cycle_releases(
            "QualityOnDemand", "Sync26", SAMPLE_RELEASES,
            ["quality-on-demand"],
        )
        assert cr.m1 is not None
        assert cr.m1.release_tag == "r4.1"
        assert cr.m1.release_date == "2026-02-10T14:30:00Z"
        assert cr.m1.apis[0].api_version == "1.2.0-alpha.1"

    def test_m3_rc_detected(self):
        cr = derive_cycle_releases(
            "QualityOnDemand", "Sync26", SAMPLE_RELEASES,
            ["quality-on-demand"],
        )
        assert cr.m3 is not None
        assert cr.m3.release_tag == "r4.2"

    def test_m4_not_achieved(self):
        cr = derive_cycle_releases(
            "QualityOnDemand", "Sync26", SAMPLE_RELEASES,
            ["quality-on-demand"],
        )
        assert cr.m4 is not None
        assert cr.m4.release_tag is None
        assert cr.m4.apis[0].api_version is None

    def test_filters_by_repo_and_meta_release(self):
        """Should not include DeviceLocation releases for QualityOnDemand."""
        cr = derive_cycle_releases(
            "QualityOnDemand", "Sync26", SAMPLE_RELEASES,
            ["quality-on-demand"],
        )
        # M1 should be QoD's alpha, not DeviceLocation's
        assert cr.m1.release_tag == "r4.1"

    def test_different_meta_release_excluded(self):
        """Fall25 releases should not appear in Sync26 cycle."""
        cr = derive_cycle_releases(
            "QualityOnDemand", "Sync26", SAMPLE_RELEASES,
            ["quality-on-demand"],
        )
        # M4 should be unachieved (Fall25 public release shouldn't count)
        assert cr.m4.release_tag is None

    def test_earliest_by_date(self):
        """When multiple alphas exist, should pick earliest by date."""
        releases = SAMPLE_RELEASES + [{
            "repository": "QualityOnDemand",
            "release_tag": "r4.0",
            "release_date": "2026-01-05T08:00:00Z",
            "meta_release": "Sync26",
            "release_type": "pre-release-alpha",
            "apis": [{"api_name": "quality-on-demand", "api_version": "1.2.0-alpha.0"}],
        }]
        cr = derive_cycle_releases(
            "QualityOnDemand", "Sync26", releases,
            ["quality-on-demand"],
        )
        assert cr.m1.release_tag == "r4.0"  # Earlier date

    def test_no_releases_returns_empty_milestones(self):
        cr = derive_cycle_releases(
            "NewRepo", "Sync26", SAMPLE_RELEASES,
            ["new-api"],
        )
        assert cr.m1.release_tag is None
        assert cr.m3.release_tag is None
        assert cr.m4.release_tag is None

    def test_independent_returns_empty(self):
        """Independent repos (no meta_release) get empty CycleReleases."""
        cr = derive_cycle_releases(
            "QualityOnDemand", None, SAMPLE_RELEASES,
            ["quality-on-demand"],
        )
        assert cr.m1 is None
        assert cr.m3 is None


class TestBuildMetaReleaseSummaries:
    """Test aggregate summary building."""

    def test_counts_achieved_apis(self):
        entries = [
            ProgressEntry(
                repository="QualityOnDemand",
                github_url="https://github.com/camaraproject/QualityOnDemand",
                meta_release="Sync26",
                apis=[ApiEntry("quality-on-demand", "1.2.0", "rc")],
                cycle_releases=CycleReleases(
                    m1=MilestoneRelease("r4.1", "2026-02-10T14:30:00Z",
                        [CycleReleaseApi("quality-on-demand", "1.2.0-alpha.1")]),
                    m3=MilestoneRelease(None, None,
                        [CycleReleaseApi("quality-on-demand", None)]),
                ),
            ),
        ]
        summaries = build_meta_release_summaries(entries)
        assert "Sync26" in summaries
        assert summaries["Sync26"]["total_apis"] == 1
        assert summaries["Sync26"]["m1_achieved"] == 1
        assert summaries["Sync26"]["m3_achieved"] == 0

    def test_multiple_repos_aggregated(self):
        entries = [
            ProgressEntry(
                repository="RepoA",
                github_url="https://github.com/camaraproject/RepoA",
                meta_release="Sync26",
                apis=[ApiEntry("api-a", "1.0.0", "rc")],
                cycle_releases=CycleReleases(
                    m1=MilestoneRelease("r1.1", "2026-01-01T00:00:00Z",
                        [CycleReleaseApi("api-a", "1.0.0-alpha.1")]),
                ),
            ),
            ProgressEntry(
                repository="RepoB",
                github_url="https://github.com/camaraproject/RepoB",
                meta_release="Sync26",
                apis=[ApiEntry("api-b", "2.0.0", "alpha"),
                      ApiEntry("api-c", "1.0.0", "alpha")],
                cycle_releases=CycleReleases(),
            ),
        ]
        summaries = build_meta_release_summaries(entries)
        assert summaries["Sync26"]["total_apis"] == 3
        assert summaries["Sync26"]["m1_achieved"] == 1

    def test_independent_repos_excluded(self):
        entries = [
            ProgressEntry(
                repository="IndependentRepo",
                github_url="https://github.com/camaraproject/IndependentRepo",
                meta_release=None,
                apis=[ApiEntry("some-api", "1.0.0", "public")],
            ),
        ]
        summaries = build_meta_release_summaries(entries)
        assert len(summaries) == 0
