import re
from pathlib import Path


RELEASE_COLLECTOR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
EXPECTED_META_RELEASES = ["Fall24", "Spring25", "Fall25", "Spring26"]
EXPECTED_VIEWERS = ["fall24", "spring25", "fall25", "spring26"]


def read(path):
    return path.read_text(encoding="utf-8")


def js_array(source, name):
    match = re.search(
        rf"const {re.escape(name)} = \[([^\]]+)\];",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, f"{name} constant not found"
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def meta_release_links(source):
    links = re.findall(
        r'<a href="([^"]+)" class="viewer-link">([^<]*meta-release[^<]*)</a>',
        source,
    )
    return [href for href, _label in links]


def test_spring26_report_generation_and_is_new_support():
    generate_reports = read(RELEASE_COLLECTOR / "scripts" / "generate-reports.js")
    enrichment = read(RELEASE_COLLECTOR / "scripts" / "lib" / "enrichment.js")

    assert js_array(generate_reports, "META_RELEASES") == EXPECTED_META_RELEASES
    assert js_array(enrichment, "META_RELEASES_WITH_IS_NEW") == EXPECTED_META_RELEASES


def test_spring26_viewer_generation_config_and_help_text():
    generate_viewers = read(RELEASE_COLLECTOR / "scripts" / "generate-viewers.js")

    assert js_array(generate_viewers, "META_RELEASE_VIEWERS") == EXPECTED_VIEWERS
    assert "'spring26': {" in generate_viewers
    assert "spring26.json" in generate_viewers
    assert "spring26.html" in generate_viewers
    assert "fall24, spring25, fall25, spring26" in generate_viewers


def test_spring26_is_linked_from_staging_and_production_indexes():
    staging = read(RELEASE_COLLECTOR / "staging-index.html")
    production = read(RELEASE_COLLECTOR / "production-index.html")

    assert meta_release_links(staging) == [
        "spring26.html",
        "fall25.html",
        "spring25.html",
        "fall24.html",
    ]
    assert meta_release_links(production) == [
        "spring26.html",
        "fall25.html",
        "spring25.html",
        "fall24.html",
    ]


def test_spring26_is_in_staging_pr_and_production_workflows():
    release_collector = read(REPO_ROOT / ".github" / "workflows" / "release-collector.yml")
    production = read(
        REPO_ROOT / ".github" / "workflows" / "release-collector-production.yml"
    )

    assert "for viewer in fall24 spring25 fall25 spring26 portfolio internal; do" in release_collector
    assert "Meta-release reports (Fall24, Spring25, Fall25, Spring26, All)" in release_collector
    assert "[Spring26 Viewer]" in release_collector

    assert '"viewers/spring26.html"' in production
    assert "cp artifact/spring26.html" in production
    assert "| spring26.html | Spring 2026 meta-release viewer |" in production
