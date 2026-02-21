# ADR-0003: Archived Repository Handling

**Status**: Accepted

**Date**: 2026-02-21

---

## Context

CAMARA API repositories follow a maturity lifecycle with four stages, each represented by a mutually exclusive GitHub topic:

- `sandbox-api-repository`
- `incubating-api-repository`
- `graduated-api-repository`
- `archived-api-repository`

When a repository is archived (both via the topic and the GitHub archive setting), its releases remain historically significant. For example, HomeDevicesQoD had a Fall24 meta-release (`r1.1`) that must continue to appear in Fall24 reports.

The Release Collector previously excluded archived repositories through two mechanisms:

1. **Explicit filter**: `!repo.archived` in `detect-releases.js`
2. **Topic mismatch**: The topic filter only matched `sandbox-api-repository`, `incubating-api-repository`, and `graduated-api-repository`. When a repository is archived, its maturity topic is replaced with `archived-api-repository`, causing it to fall outside the filter.

The first three archived CAMARA repositories (ShortMessageService, Site2CloudVPN, HomeDevicesQoD) revealed this data loss. HomeDevicesQoD's Fall24 release data was already missing from `releases-master.yaml`.

---

## Decision

Include archived repositories in the Release Collector pipeline with a `repository_archived` field to mark them.

### Design choices

1. **Include via `archived-api-repository` topic**: Add this topic to the detection filter alongside the other maturity topics. Remove the explicit `!repo.archived` filter. The GitHub API returns releases for archived repos (read-only access is preserved).

2. **Add `repository_archived: true` field**: Optional boolean field, only present when `true`. This mirrors the existing `superseded` pattern for pre-releases. The field is denormalized across both `releases[]` and `repositories[]` entries in `releases-master.yaml`, so consumers can filter without joins.

3. **No filtering in reports**: Archived releases appear in all reports (meta-release reports, all-releases, portfolio) without any filtering. The data must remain complete for historical accuracy.

4. **Campaign safety**: Campaign workflows (`campaign-release-plan-rollout`, `campaign-release-info`) filter out archived repositories because PRs cannot be created on archived GitHub repositories.

5. **Mismatch validation**: Cross-validate the `archived-api-repository` topic against the GitHub `repo.archived` status. On mismatch, warn and skip the repository (don't fail the workflow). Warnings are surfaced in the PR body and workflow step summary. Two mismatch cases:
   - Topic set but repo not yet archived on GitHub
   - Repo archived on GitHub but topic not updated

6. **Schema version 2.1.0**: Backward-compatible addition of an optional field. Existing consumers that don't check `repository_archived` continue working unchanged.

7. **Visual marking in viewers**: Archived repositories, releases, and APIs display a gray "Archived" badge. No data is hidden.

---

## Consequences

### Positive

- Historical completeness preserved: Fall24 report includes HomeDevicesQoD as expected
- All downstream consumers can filter by `repository_archived` if needed
- Mismatch validation catches governance/admin synchronization issues early
- Backward compatible: existing consumers unaffected

### Negative

- Denormalization means `repository_archived` must be set in multiple places (releases and repositories entries)
- Campaign workflows must explicitly filter out archived repos

### Neutral

- ShortMessageService and Site2CloudVPN appear in `repositories[]` but have no releases (expected)
- A future viewer toggle to hide/show archived entries is deferred (only one archived repo with data currently)

---

## Alternatives Considered

### A. Filter archived repos from historical reports

Rejected: This would alter historical meta-release data. The Fall24 report must remain complete regardless of later repository lifecycle changes.

### B. Use `archived: true` as field name

Rejected: `repository_archived` was chosen to disambiguate from a potential future "archived release" concept and to clearly indicate the source of the archived status.

### C. Fail workflow on topic/status mismatch

Rejected: A mismatch is a governance process issue, not a data integrity issue. Failing the workflow would block all collection for an unrelated administrative issue. Warn and skip is the appropriate response.

---

## Related

- [Issue #147](https://github.com/camaraproject/project-administration/issues/147) - Release Collector: handle archived API repositories
- [ADR-0002](0002-runtime-enrichment-architecture.md) - Runtime Enrichment Architecture (master metadata purity principle)
- [Master metadata schema](../../schemas/master-metadata-schema.yaml) - Schema 2.1.0 with `repository_archived` field
