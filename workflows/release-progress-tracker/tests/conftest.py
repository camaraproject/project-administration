"""Shared fixtures for release-progress-tracker tests."""

import sys
from pathlib import Path

# Ensure scripts package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
