import ast
import re
from pathlib import Path


TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "portfolio-template.html"
EXPECTED_META_RELEASES = ["Fall24", "Spring25", "Fall25", "Spring26"]


def read_template():
    return TEMPLATE.read_text(encoding="utf-8")


def test_meta_release_table_headers_include_spring26_in_order():
    template = read_template()

    header_matches = re.findall(
        r'<th onclick="sortMetaReleaseTable\(\d+\)">([^<]+)',
        template,
    )
    header_labels = [label.strip() for label in header_matches]

    assert header_labels == ["API", "Category", *EXPECTED_META_RELEASES, "First Release"]


def test_spring26_is_mapped_from_source_data_to_rendered_rows():
    template = read_template()

    meta_release_match = re.search(r"const META_RELEASES = (\[[^\]]+\]);", template)
    assert meta_release_match is not None
    assert ast.literal_eval(meta_release_match.group(1)) == EXPECTED_META_RELEASES

    assert "spring26: null" in template
    assert "v.meta_release === 'Spring26'" in template
    expected_assignment = (
        "row.spring26 = "
        "{ api_version: v.api_version, maturity: v.maturity, isNew: v.isNew }"
    )
    assert expected_assignment in template
    assert "row.spring26.api_version" in template
