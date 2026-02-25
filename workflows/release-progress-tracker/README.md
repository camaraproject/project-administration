# Release Progress Tracker

Collects release progress data for CAMARA API repositories by scanning `release-plan.yaml` files and deriving state from repository artifacts.

## Usage

```bash
GITHUB_TOKEN=$(gh auth token) python3 -m scripts.collect_progress \
    --master ../../data/releases-master.yaml \
    --output ../../data/releases-progress.yaml \
    [--debug]
```

**Requirements**: Python 3.10+, `pyyaml`, `requests`

## Architecture

| Module | Purpose |
|--------|---------|
| `models.py` | Dataclasses for output structures |
| `state_deriver.py` | Pure state derivation (5 states) |
| `warnings.py` | Extensible validation warning infrastructure |
| `milestone_deriver.py` | M1/M3/M4 milestone derivation from releases-master.yaml |
| `github_api.py` | Thin GitHub REST API client |
| `collect_progress.py` | Main orchestrator and CLI entry point |

## State derivation

States are derived from repository artifacts (checked in priority order):

1. `target_release_type == "none"` → **NOT_PLANNED**
2. Release tag exists → **PUBLISHED**
3. Snapshot branch + draft release → **DRAFT_READY**
4. Snapshot branch only → **SNAPSHOT_ACTIVE**
5. Has plan, no artifacts → **PLANNED**

## Output

Produces `data/releases-progress.yaml` validated against `schemas/releases-progress-schema.yaml`.

## Viewer generation

Generate a self-contained HTML viewer from collected progress data:

```bash
python3 -m scripts.generate_progress_viewer \
    --data data/releases-progress.yaml \
    --output viewers/progress.html \
    --shared-assets ../release-collector/templates
```

The viewer embeds shared CSS (`viewer-styles.css`) and JS (`viewer-lib.js`) from the Release Collector templates, plus the progress data as JSON. The result is a single HTML file with no external dependencies.

**Template**: `templates/progress-template.html` — uses `{{VIEWER_STYLES}}`, `{{VIEWER_LIBRARY}}`, and `{{PROGRESS_DATA}}` placeholders.

**Features**: API-centric table, state badges, M1/M3/M4 milestone columns, filtering (state/track/maturity/text/warnings), sortable columns, URL parameters for bookmarkable views, dark mode, CSV/JSON export.

## Tests

```bash
python3 -m pytest tests/ -v
```
