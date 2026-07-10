"""Tests for Review-PR body parsing and review-decision derivation."""

from scripts.review_pr import derive_review_decision, parse_review_pr_body


# A representative rendered Release Review PR body (release_review_pr.mustache),
# with the CHANGELOG + readiness codeowner boxes ticked (box 2 left open, as is
# valid for alpha) and 2 of 4 Release Management boxes ticked.
REVIEW_BODY = """## Release Review: r4.1 rc

This PR finalizes the reviewable release content for the active snapshot.

### Release contents

| API | Version | Status | Comparison target |
|-----|---------|--------|---------------------|
| QualityOnDemand | `v0.11.0` | rc | `r3.2` |

### Codeowner Actions

_Tick each box once done. Ticking the last box — "The release is ready for Release Management review" — starts the Release Management review._

- [x] **Update the CHANGELOG**

  What to do:
  - Copy all API-consumer-relevant changes from the provided list.
  - Do not copy administrative, tooling-only, or internal maintenance changes.

- [ ] **Document deferred validation warnings (and hints)**

  What to do:
  - Check the CAMARA Validation comment on this PR for warnings and hints.

- [x] **The release is ready for Release Management review**

  Check that:
  - All mandatory release assets for the declared status(es) are present.

### Release Management Actions

- [x] CHANGELOG follows the release documentation rules
- [ ] Breaking changes are documented and version updates follow SemVer rules
- [x] Mandatory release assets are present for each API according to its status
- [ ] All remaining validation warnings are documented in issues and the reasons for deferral are defensible

<details>
<summary><b>Required release assets per API status</b></summary>

| Nr | Asset | alpha | rc | initial<br>public | stable<br>public |
|----|-------|:-----:|:--:|:-------:|:------:|
| 1 | Release Plan | M | M | M | M |
| 2 | API Definition(s) | M | M | M | M |

</details>

### Valid next actions for codeowners

- **Merge this PR** when all Codeowner Actions and Release Management Actions are complete
- Use **`/discard-snapshot <reason>`** to discard this snapshot
"""


class TestParseReviewPrBody:
    def test_full_body(self):
        parsed = parse_review_pr_body(REVIEW_BODY)
        assert parsed["codeowner_total"] == 3
        assert parsed["codeowner_checked"] == 2
        assert parsed["ready_for_review"] is True
        assert parsed["rm_total"] == 4
        assert parsed["rm_checked"] == 2

    def test_not_ready_when_readiness_box_unticked(self):
        body = REVIEW_BODY.replace(
            "- [x] **The release is ready for Release Management review**",
            "- [ ] **The release is ready for Release Management review**",
        )
        parsed = parse_review_pr_body(body)
        assert parsed["ready_for_review"] is False
        assert parsed["codeowner_checked"] == 1

    def test_uppercase_x_and_asterisk_bullets(self):
        body = REVIEW_BODY.replace("- [x]", "* [X]")
        parsed = parse_review_pr_body(body)
        assert parsed["codeowner_checked"] == 2
        assert parsed["ready_for_review"] is True

    def test_nested_bullets_are_not_counted_as_checkboxes(self):
        # The indented "What to do:" bullets have no [ ] and must not count.
        parsed = parse_review_pr_body(REVIEW_BODY)
        assert parsed["codeowner_total"] == 3  # not inflated by nested bullets

    def test_details_table_and_next_actions_excluded_from_rm_count(self):
        parsed = parse_review_pr_body(REVIEW_BODY)
        assert parsed["rm_total"] == 4  # asset table rows / merge bullets excluded

    def test_none_body(self):
        parsed = parse_review_pr_body(None)
        assert parsed == {
            "codeowner_total": 0,
            "codeowner_checked": 0,
            "ready_for_review": False,
            "rm_total": 0,
            "rm_checked": 0,
        }

    def test_empty_body(self):
        parsed = parse_review_pr_body("")
        assert parsed["codeowner_total"] == 0
        assert parsed["ready_for_review"] is False


class TestDeriveReviewDecision:
    def test_no_assignee_means_no_verdict(self):
        # Unassigned PR: no designated RM reviewer, so no verdict even if approved.
        assert derive_review_decision([{"user": "a", "state": "APPROVED"}], []) is None

    def test_assigned_but_not_yet_reviewed(self):
        assert derive_review_decision([], ["alice"]) is None

    def test_assignee_approval(self):
        reviews = [{"user": "alice", "state": "APPROVED"}]
        assert derive_review_decision(reviews, ["alice"]) == "APPROVED"

    def test_non_assignee_review_ignored(self):
        # A codeowner (not the assignee) approving or requesting changes is ignored.
        reviews = [
            {"user": "bob", "state": "APPROVED"},
            {"user": "carol", "state": "CHANGES_REQUESTED"},
        ]
        assert derive_review_decision(reviews, ["alice"]) is None

    def test_changes_requested_dominates_among_assignees(self):
        reviews = [
            {"user": "alice", "state": "APPROVED"},
            {"user": "bob", "state": "CHANGES_REQUESTED"},
        ]
        assert derive_review_decision(reviews, ["alice", "bob"]) == "CHANGES_REQUESTED"

    def test_any_assignee_approval_when_no_changes(self):
        # Two assigned reviewers, one approved, other not yet reviewed -> approved.
        reviews = [{"user": "alice", "state": "APPROVED"}]
        assert derive_review_decision(reviews, ["alice", "bob"]) == "APPROVED"

    def test_latest_review_per_assignee_wins(self):
        reviews = [
            {"user": "alice", "state": "CHANGES_REQUESTED"},
            {"user": "alice", "state": "APPROVED"},
        ]
        assert derive_review_decision(reviews, ["alice"]) == "APPROVED"

    def test_dismissed_latest_means_no_effective_review(self):
        reviews = [
            {"user": "alice", "state": "APPROVED"},
            {"user": "alice", "state": "DISMISSED"},
        ]
        assert derive_review_decision(reviews, ["alice"]) is None

    def test_commented_and_pending_ignored(self):
        reviews = [
            {"user": "alice", "state": "COMMENTED"},
            {"user": "alice", "state": "PENDING"},
        ]
        assert derive_review_decision(reviews, ["alice"]) is None
