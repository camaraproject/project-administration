"""Workflow contract tests for release progress data PR handling."""

from pathlib import Path

import yaml


WORKFLOW_PATH = (
    Path(__file__).resolve().parents[3]
    / ".github"
    / "workflows"
    / "release-progress-tracker.yml"
)


def _workflow():
    return yaml.safe_load(WORKFLOW_PATH.read_text())


def test_data_pr_uses_stable_branch_and_title():
    workflow = _workflow()

    assert workflow["env"]["PROGRESS_UPDATE_BRANCH"] == "release-progress-update"
    assert (
        workflow["env"]["PROGRESS_UPDATE_TITLE"]
        == "Release Progress: Update releases-progress.yaml"
    )

    workflow_text = WORKFLOW_PATH.read_text()
    assert "release-progress-update-${{ github.run_number }}" not in workflow_text


def test_data_pr_updates_stable_branch_safely():
    workflow_text = WORKFLOW_PATH.read_text()

    assert "--force-with-lease=refs/heads/$BRANCH:$REMOTE_SHA" in workflow_text
    assert "Existing $BRANCH branch has no matching open PR" in workflow_text
    assert "origin/main..origin/$BRANCH" in workflow_text
    assert 'gh pr list --head "${{ github.repository_owner }}:$BRANCH"' in workflow_text


def test_data_pr_preserves_existing_pr_when_generated_tree_is_unchanged():
    workflow_text = WORKFLOW_PATH.read_text()

    assert "No changes detected compared to existing $BRANCH branch" in workflow_text
    assert "pr_action=unchanged_existing_pr" in workflow_text


def test_data_pr_commit_author_is_cla_covered_app_bot():
    # The update commit must be authored by the EasyCLA-approved release-automation
    # App bot, not github-actions[bot] — otherwise EasyCLA reports "Missing CLA
    # Authorization" and the PR check fails.
    workflow_text = WORKFLOW_PATH.read_text()

    assert 'git config user.name "camara-release-automation[bot]"' in workflow_text
    assert (
        "261643975+camara-release-automation[bot]@users.noreply.github.com"
        in workflow_text
    )
    assert "github-actions[bot]" not in workflow_text
