"""Generate self-contained HTML viewer from progress data.

Injects shared viewer assets (CSS, JS) and progress data into
the progress-template.html to produce a single self-contained HTML file.

Usage:
    python3 -m scripts.generate_progress_viewer \
        --data data/releases-progress.yaml \
        --output viewers/progress.html \
        [--shared-assets ../../release-collector/templates]
"""

import argparse
import json
import logging
import os
import sys

import yaml

logger = logging.getLogger(__name__)

# Default paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRACKER_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_TEMPLATE = os.path.join(TRACKER_DIR, "templates", "progress-template.html")
DEFAULT_SHARED_ASSETS = os.path.join(
    TRACKER_DIR, "..", "release-collector", "templates"
)


def generate_viewer(
    data_path: str,
    output_path: str,
    template_path: str = DEFAULT_TEMPLATE,
    shared_assets_dir: str = DEFAULT_SHARED_ASSETS,
) -> str:
    """Generate a self-contained HTML viewer from progress data.

    Args:
        data_path: Path to releases-progress.yaml (or .json)
        output_path: Path to write the output HTML file
        template_path: Path to progress-template.html
        shared_assets_dir: Directory containing viewer-styles.css and viewer-lib.js

    Returns:
        Path to the generated HTML file
    """
    # Read progress data
    logger.info("Reading data from: %s", data_path)
    with open(data_path, "r") as f:
        if data_path.endswith(".json"):
            data = json.load(f)
        else:
            data = yaml.safe_load(f)

    data_json = json.dumps(data, indent=2, default=str)

    # Read template
    logger.info("Reading template from: %s", template_path)
    with open(template_path, "r") as f:
        template = f.read()

    # Read shared assets
    styles_path = os.path.join(shared_assets_dir, "viewer-styles.css")
    lib_path = os.path.join(shared_assets_dir, "viewer-lib.js")

    logger.info("Reading shared styles from: %s", styles_path)
    with open(styles_path, "r") as f:
        styles = f.read()

    logger.info("Reading shared library from: %s", lib_path)
    with open(lib_path, "r") as f:
        library = f.read()

    # Inject into template
    html = template
    html = html.replace("{{VIEWER_STYLES}}", styles)
    html = html.replace("{{VIEWER_LIBRARY}}", library)
    html = html.replace("{{PROGRESS_DATA}}", data_json)

    # Write output
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w") as f:
        f.write(html)

    logger.info("Generated viewer: %s (%d bytes)", output_path, len(html))
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Generate CAMARA Release Progress viewer HTML"
    )
    parser.add_argument(
        "--data", required=True,
        help="Path to releases-progress.yaml or .json",
    )
    parser.add_argument(
        "--output", required=True,
        help="Path to write the output HTML file",
    )
    parser.add_argument(
        "--template", default=DEFAULT_TEMPLATE,
        help="Path to progress-template.html",
    )
    parser.add_argument(
        "--shared-assets", default=DEFAULT_SHARED_ASSETS,
        help="Directory containing viewer-styles.css and viewer-lib.js",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    try:
        result = generate_viewer(
            data_path=args.data,
            output_path=args.output,
            template_path=args.template,
            shared_assets_dir=args.shared_assets,
        )
        print(f"Generated: {result}")
    except FileNotFoundError as e:
        logger.error("File not found: %s", e)
        sys.exit(1)
    except Exception as e:
        logger.error("Generation failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
