"""Structural tests for the generated progress viewer HTML.

The viewer's behaviour lives in the template's embedded JavaScript, which pytest
cannot exercise. These tests guard the structural contract only: that the
template still declares the columns and data wiring the views depend on, so a
regression in the template surfaces here rather than in a screenshot.
"""

import re

import pytest
import yaml

from scripts.generate_progress_viewer import generate_viewer

SAMPLE_DATA = {
    "metadata": {
        "last_updated": "2026-09-15T00:00:00Z",
        "last_checked": "2026-09-15T00:00:00Z",
        "schema_version": "1.7.0",
        "collector_version": "1.7.0",
        "repos_scanned": 1,
    },
    "meta_releases": [],
    "progress": [
        {
            "repository": "DeviceReachabilityStatus",
            "github_url": "https://github.com/camaraproject/DeviceReachabilityStatus",
            "release_track": "meta-release",
            "meta_release": "Sync26",
            "target_release_tag": "r1.2",
            "target_release_type": "pre-release-rc",
            "dependencies": {
                "commonalities_release": "r4.3",
                "identity_consent_management_release": "r3.1",
            },
            "apis": [
                {
                    "api_name": "device-reachability-status",
                    "target_api_version": "0.3.0",
                    "target_api_status": "rc",
                },
                {
                    "api_name": "device-reachability-status-subscriptions",
                    "target_api_version": "0.3.0",
                    "target_api_status": "rc",
                },
            ],
            "state": "snapshot_active",
            "artifacts": {
                "snapshot_branch": "release-snapshot/r1.2",
                "release_pr": None,
                "draft_release": None,
                "release_issue": None,
                "review_history": None,
            },
            "published_context": {
                "latest_public_release": None,
                "newest_pre_release": None,
            },
            "cycle_releases": {},
        }
    ],
}


@pytest.fixture
def viewer_html(tmp_path):
    """Generate the viewer from SAMPLE_DATA and return its HTML."""
    data_file = tmp_path / "releases-progress.yaml"
    data_file.write_text(yaml.safe_dump(SAMPLE_DATA))
    output = tmp_path / "progress.html"
    generate_viewer(data_path=str(data_file), output_path=str(output))
    return output.read_text()


def _table_block(html, table_id):
    """Return the <thead> block for the table with the given id."""
    start = html.index(f'id="{table_id}"')
    thead_end = html.index("</thead>", start)
    return html[start:thead_end]


def test_no_unsubstituted_placeholders(viewer_html):
    assert "{{VIEWER_STYLES}}" not in viewer_html
    assert "{{VIEWER_LIBRARY}}" not in viewer_html
    assert "{{PROGRESS_DATA}}" not in viewer_html


def test_progress_table_has_commonalities_column(viewer_html):
    head = _table_block(viewer_html, "progressTable")
    assert "Comm" in head


def test_review_table_has_commonalities_column(viewer_html):
    head = _table_block(viewer_html, "reviewTable")
    assert "Comm" in head


def test_commonalities_column_precedes_state_in_both_tables(viewer_html):
    for table_id, state_header in (
        ("progressTable", "Release<br>State"),
        ("reviewTable", "State"),
    ):
        head = _table_block(viewer_html, table_id)
        assert head.index("Comm") < head.index(state_header), table_id


def test_progress_table_column_count_matches_col_count(viewer_html):
    head = _table_block(viewer_html, "progressTable")
    headers = re.findall(r"<th[ >]", head)
    match = re.search(r"const COL_COUNT = (\d+);", viewer_html)
    assert match, "COL_COUNT not found"
    assert len(headers) == int(match.group(1))


def test_review_rows_carry_dependencies(viewer_html):
    """flattenReviewData must pass dependencies through for the Comm column."""
    start = viewer_html.index("function flattenReviewData")
    end = viewer_html.index("function reviewTrackKey")
    assert "dependencies" in viewer_html[start:end]


def test_commonalities_filter_present_in_both_views(viewer_html):
    assert 'id="filterCommonalities"' in viewer_html
    assert 'id="reviewCommonalitiesFilter"' in viewer_html


def test_api_list_rendered_with_versions_not_count_hover(viewer_html):
    """The Review Queue writes bundled APIs out under the repository name."""
    start = viewer_html.index("function renderReviewRepoCell")
    end = viewer_html.index("function renderTrackTypeTagCell")
    cell = viewer_html[start:end]
    assert "rq-api-item" in cell
    # The old count-only rendering must be gone from the track/tag cell.
    track_start = viewer_html.index("function renderTrackTypeTagCell")
    track_end = viewer_html.index("function renderReviewStateBadge")
    assert "rq-apis" not in viewer_html[track_start:track_end]


def test_api_name_and_version_are_separate_elements(viewer_html):
    """Only the name may clip; the version must never be truncated.

    The version is the tail of `name version`, so clipping the pair as one unit
    would drop the version first — the part a reviewer needs most.
    """
    start = viewer_html.index("function renderReviewRepoCell")
    end = viewer_html.index("function renderTrackTypeTagCell")
    cell = viewer_html[start:end]
    assert "rq-api-name" in cell
    assert "rq-api-ver" in cell

    # The clipping rule applies to the name, not the whole item.
    name_rule = re.search(r"\.rq-api-name \{[^}]*\}", viewer_html, re.S)
    assert name_rule, ".rq-api-name CSS rule not found"
    assert "text-overflow: ellipsis" in name_rule.group(0)

    item_rule = re.search(r"\.rq-api-item \{[^}]*\}", viewer_html, re.S)
    assert item_rule, ".rq-api-item CSS rule not found"
    assert "text-overflow" not in item_rule.group(0)


def test_api_name_clip_budget_clears_prefix_collisions(viewer_html):
    """The name budget must exceed the longest base name with a sibling.

    Releases bundle both `<base>` and `<base>-subscriptions`; the longest such base
    in the live data is `device-reachability-status` (26 chars). A budget at or below
    that renders the two siblings identically.
    """
    name_rule = re.search(r"\.rq-api-name \{[^}]*\}", viewer_html, re.S)
    budget = re.search(r"max-width:\s*(\d+)ch", name_rule.group(0))
    assert budget, "no ch-based max-width on .rq-api-name"
    assert int(budget.group(1)) > 26


def test_release_type_filter_present_in_both_views(viewer_html):
    assert 'id="filterReleaseType"' in viewer_html
    assert 'id="reviewReleaseTypeFilter"' in viewer_html


def test_release_type_filter_follows_maturity_in_progress_view(viewer_html):
    assert viewer_html.index('id="filterMaturity"') < viewer_html.index('id="filterReleaseType"')
    assert viewer_html.index('id="filterReleaseType"') < viewer_html.index('id="filterCommonalities"')


def _function_body(html, name):
    start = html.index(f"function {name}(")
    return html[start : html.index("\n    }\n", start)]


@pytest.mark.parametrize(
    "func", ["applyFilters", "applyReviewFilters", "clearAllFilters", "clearReviewFilters"]
)
def test_release_type_filter_wired_into_apply_and_clear(viewer_html, func):
    body = _function_body(viewer_html, func)
    assert "ReleaseType" in body, func


def test_release_type_group_maps_types_to_groups(viewer_html):
    body = _function_body(viewer_html, "releaseTypeGroup")
    for group in ("pre-release", "public", "maintenance"):
        assert f"'{group}'" in body


def test_release_type_filter_options_always_list_maintenance(viewer_html):
    start = viewer_html.index("const RELEASE_TYPE_OPTIONS")
    end = viewer_html.index("function buildReleaseTypeOptions")
    assert "['maintenance', 'Maintenance']" in viewer_html[start:end]
    # Options are built from the fixed list, not from the types present in the data.
    assert "RELEASE_TYPE_OPTIONS" in _function_body(viewer_html, "buildReleaseTypeOptions")


def test_release_type_url_param_on_progress_view_only(viewer_html):
    assert "'release_type'" in _function_body(viewer_html, "parseUrlParams")
    assert "'release_type'" in _function_body(viewer_html, "updateUrlParams")
    review_start = viewer_html.index("function applyReviewFilters")
    assert "'release_type'" not in viewer_html[review_start:]


def test_maintenance_release_type_has_short_label_and_sort_order(viewer_html):
    assert "'maint'" in _function_body(viewer_html, "shortType")
    assert "maintenance" in _function_body(viewer_html, "typeOrder")


def test_type_label_carries_full_type_as_title(viewer_html):
    cell = _function_body(viewer_html, "renderTrackTypeTagCell")
    assert "title=" in cell


def test_progress_csv_has_release_type_after_meta_release(viewer_html):
    body = _function_body(viewer_html, "exportCSV")
    assert body.index("'Meta-Release'") < body.index("'Release Type'")
    assert "row.target_release_type" in body


def test_review_option_counts_follow_the_other_filters(viewer_html):
    """Track and Type counts are recomputed on every filter change, each ignoring its own filter."""
    body = _function_body(viewer_html, "applyReviewFilters")
    assert "buildReviewTrackOptions(" in body
    assert "buildReleaseTypeOptions('reviewReleaseTypeFilter'" in body
    assert "'track'" in body
    assert "'type'" in body


def test_review_track_options_list_all_tracks_with_zero_counts(viewer_html):
    """A track with no matching rows stays listed (at 0) so the dropdown keeps its shape."""
    body = _function_body(viewer_html, "buildReviewTrackOptions")
    assert "reviewAllRows" in body


def test_progress_type_counts_follow_the_other_filters(viewer_html):
    body = _function_body(viewer_html, "applyFilters")
    assert "buildReleaseTypeOptions('filterReleaseType'" in body
    assert "'type'" in body
