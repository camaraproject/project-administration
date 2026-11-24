"""No meta-release name may be hard-coded in generator scripts, templates, workflows or index sources.

Names are the `mappings` keys of config/meta-release-mappings.yaml, read at test time.
Adding a meta-release must only need a config change.
"""
import re
from pathlib import Path

import yaml

RELEASE_COLLECTOR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
MAPPINGS = REPO_ROOT / "config" / "meta-release-mappings.yaml"

WORKFLOWS = [
    REPO_ROOT / ".github" / "workflows" / "release-collector.yml",
    REPO_ROOT / ".github" / "workflows" / "release-collector-production.yml",
]
# scripts/archive, tests and the redirect stubs (legacy/) are excluded by not being listed here
SOURCE_DIRS = [RELEASE_COLLECTOR / "scripts", RELEASE_COLLECTOR / "templates"]
SOURCE_SUFFIXES = {".js", ".html", ".css"}


def meta_release_names():
    config = yaml.safe_load(MAPPINGS.read_text(encoding="utf-8"))
    names = list(config["mappings"])
    assert names, "no meta-releases in mappings"
    return names


def source_files():
    files = []
    for directory in SOURCE_DIRS:
        for path in directory.rglob("*"):
            if "archive" in path.relative_to(directory).parts:
                continue
            if path.is_file() and path.suffix in SOURCE_SUFFIXES:
                files.append(path)
    return sorted(files)


def source_hits(text, name):
    """Quoted literal 'Name' / "Name" / `Name`, or a file name name.html / name.json (lowercase)."""
    patterns = [
        rf"""(['"`]){re.escape(name)}\1""",
        rf"\b{re.escape(name.lower())}\.(html|json)\b",
    ]
    return [m.group(0) for pattern in patterns for m in re.finditer(pattern, text)]


def workflow_hits(text, name):
    """Whole word, case-insensitive, `#` comment lines skipped."""
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        if line.lstrip().startswith("#"):
            continue
        if re.search(rf"\b{re.escape(name)}\b", line, flags=re.IGNORECASE):
            hits.append(f"line {number}: {line.strip()}")
    return hits


def test_no_meta_release_name_in_scripts_templates_and_index_sources():
    found = []
    for path in source_files():
        text = path.read_text(encoding="utf-8")
        for name in meta_release_names():
            for hit in source_hits(text, name):
                found.append(f"{path.relative_to(REPO_ROOT)}: {hit}")
    assert not found, "hard-coded meta-release names:\n" + "\n".join(found)


def test_no_meta_release_name_in_workflows():
    found = []
    for path in WORKFLOWS:
        text = path.read_text(encoding="utf-8")
        for name in meta_release_names():
            for hit in workflow_hits(text, name):
                found.append(f"{path.relative_to(REPO_ROOT)}: {hit}")
    assert not found, "hard-coded meta-release names:\n" + "\n".join(found)


def test_match_rules_catch_what_they_should():
    assert source_hits("const L = ['Fall24', 'X'];", "Fall24")
    assert source_hits('x = "Fall24"', "Fall24")
    assert source_hits("fetch(`fall24.html`)", "Fall24")
    assert source_hits("open('reports/fall24.json')", "Fall24")
    assert not source_hits("// pre-Fall24 behaviour", "Fall24")
    assert not source_hits("const k = 'PreFall24';", "Fall24")
    assert workflow_hits("for v in fall24 portfolio; do", "Fall24")
    assert not workflow_hits("  # Fall24 comment", "Fall24")
