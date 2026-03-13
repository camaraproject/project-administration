# ADR-0004: Native Release Metadata Adoption

**Status**: Proposed

**Date**: 2026-03-11

---

## Context

The Release Collector currently builds its release facts from two synthetic steps:

1. `analyze-release.js` inspects OpenAPI files in a release tag and re-derives API metadata
2. `generate-release-metadata.js` writes synthetic `data/release-artifacts/{repo}/{tag}/release-metadata.yaml` files for every collected release

This worked when CAMARA repositories did not carry native release metadata, but the release automation now creates a tag-root `release-metadata.yaml` for automated releases. That native file is intended to be authoritative for the release and already contains richer data than the collector synthesizes today.

Compared with the current collector output, native `release-metadata.yaml` adds important release-level facts:

- `src_commit_sha`
- `dependencies`
- authoritative `release_type`

The synthetic artifact generation is lossy by comparison:

- `src_commit_sha` is written as `null`
- `dependencies` are omitted
- `release_type` is partly heuristic today

At the same time, the current `releases-master.yaml` and derived reports still contain fields that are not part of the native metadata contract, especially:

- `apis[].file_name`
- per-API `commonalities`

The collector must therefore handle a mixed world:

- automated releases with native tag-root metadata
- legacy releases that still require OpenAPI-based analysis

It must also reduce operational noise. Native-backed releases currently still lead to committed `data/release-artifacts/` changes, which then have to be deleted manually from generated PRs.

---

## Problem Statement

The Release Collector needs an explicit design for native release metadata adoption that answers four questions:

1. Which source is authoritative when a release already contains `release-metadata.yaml`?
2. How are native and legacy releases handled together in the same pipeline?
3. Which existing `releases-master.yaml` and report fields remain valid, which change meaning, and which should be removed?
4. How should local artifact generation and production asset upload behave once some releases already have native metadata in the source repository?

Without a documented decision, the collector risks continuing to duplicate work, preserving fields that no longer have a sound source of truth, and generating unnecessary artifact churn.

---

## Decision

Adopt native tag-root `release-metadata.yaml` as the primary release source whenever it is present, while retaining the existing OpenAPI-based analysis as a fallback for legacy releases.

### Design choices

1. **Native metadata is authoritative when present**
   - For a release tag containing native `release-metadata.yaml`, the collector reads release facts from that file instead of re-deriving them from OpenAPI specs.
   - Legacy spec analysis remains the fallback when the native file is absent.

2. **Mixed native and legacy releases are supported explicitly**
   - The collector operates per release, not per repository or by a fixed date cutoff.
   - A repository may therefore contain legacy releases in one cycle and native-backed releases in another.

3. **`data/release-artifacts/` is generated only for legacy releases**
   - Native-backed releases do not need collector-generated metadata artifacts.
   - Legacy releases continue to receive generated artifacts so the existing production upload flow remains functional for them.

4. **Production upload skips native releases**
   - The production workflow continues to upload metadata assets only for legacy releases.
   - Native-backed releases are classified and skipped rather than treated as missing or failed uploads.

5. **`releases-master.yaml` evolves to include native release-level facts**
   - `src_commit_sha` is added at release level.
   - `dependencies` is added at release level.
   - Collector-owned derived fields remain unchanged: `meta_release`, `github_url`, `superseded`, `repository_archived`.

6. **`apis[].file_name` is removed**
   - `file_name` is not part of native metadata.
   - Persisting it would require continuing redundant OpenAPI parsing for native-backed releases.
   - The field is not required by current viewers or release-progress tracking consumers.

7. **`apis[].commonalities` is retained as a compatibility/reporting field, but its meaning changes**
   - It is no longer treated as a native per-API fact.
   - For native-backed releases, its value is derived from `dependencies.commonalities_release` and resolved to the corresponding Commonalities version.
   - This preserves a useful flattened/report field for future filtering without pretending it came directly from native per-API metadata.

8. **`statistics.commonalities_versions` is removed from reports**
   - It is not used by the current viewers.
   - After the `commonalities` semantic shift, the statistic becomes extra noise rather than a clear source-of-truth summary.

---

## Detailed Schema And Report Decisions

### `src_commit_sha` added at release level

**Decision**: Add `src_commit_sha` to each release entry in `releases-master.yaml` and mirror it in derived report `releases[]` entries and flattened API entries where release context is included.

**Rationale**:

- It is authoritative traceability data available in native metadata
- It cannot be reconstructed reliably from current collector output
- It is clearly scoped to the release, not to an individual API

### `dependencies` added at release level

**Decision**: Add `dependencies` as a release-level structure in `releases-master.yaml` and derived report `releases[]`.

**Rationale**:

- Dependencies apply to the release as a whole
- They are present in native metadata and should not be discarded
- Modeling them as release-level data avoids inventing per-API semantics that do not exist in the source

### `apis[].file_name` removed

**Decision**: Remove `file_name` from persisted master and report API entries.

**Rationale**:

- It does not exist in native metadata
- It is not used by current viewers
- Keeping it would force continued redundant spec parsing for native-backed releases
- Historical one-off correction logic can be preserved in normalization code without keeping `file_name` as a persistent data contract

### `apis[].commonalities` retained but redefined

**Decision**: Keep `apis[].commonalities` in master and flattened report API entries as a compatibility/reporting field. For native-backed releases, populate it from the release-level Commonalities dependency after resolving the dependency tag to the Commonalities semantic version.

**Rationale**:

- Future filtering and flattened views may still benefit from an API-level Commonalities version field
- This preserves practical report compatibility without claiming the value was sourced as native per-API metadata
- The field remains useful even though the source shifts from OpenAPI to release dependencies

### `statistics.commonalities_versions` removed

**Decision**: Remove `statistics.commonalities_versions` from generated reports.

**Rationale**:

- Current viewers do not consume it
- It adds output noise
- After redefining `apis[].commonalities`, retaining the statistic would overstate the importance of a compatibility field

### No change to collector-owned derived fields

**Decision**: Keep `meta_release`, `github_url`, `superseded`, and `repository_archived` as collector-owned derived fields.

**Rationale**:

- They are not part of the native metadata contract
- They remain necessary for collector behavior and reporting
- Their ownership and derivation logic do not change with native metadata adoption

---

## Consequences

### Positive

- Automated releases gain higher-fidelity release data in `releases-master.yaml`
- The collector stops duplicating spec analysis when authoritative native metadata already exists
- Operational noise from generated artifact churn is reduced
- Mixed native/legacy handling is explicit rather than accidental
- Schema and report changes are constrained to fields that no longer have a sound native source

### Negative

- Some downstream schema change is unavoidable, especially removal of `file_name`
- The collector must introduce dependency-resolution logic for Commonalities compatibility values
- Production upload reporting becomes slightly more complex because native releases must be classified as skipped rather than uploaded

### Neutral

- Legacy releases continue to use the current analysis path
- The collector remains the owner of release grouping and lifecycle annotations such as `meta_release` and `superseded`

---

## Alternatives Considered

### A. Hotfix only: skip artifact generation, keep current analysis

This would solve the immediate PR-noise problem but would leave the collector ignoring authoritative native metadata. It would preserve duplicate OpenAPI analysis and continue losing `src_commit_sha` and `dependencies`.

**Rejected**: useful as an operational hotfix, but insufficient as the target design.

### B. Full native-first reset with breaking schema changes

This option would redesign `releases-master.yaml` and reports strictly around native metadata, removing compatibility-oriented fields as soon as they lose native provenance.

**Rejected for now**: conceptually clean, but unnecessarily disruptive while legacy support is still needed and current consumers do not require such a hard break.

### C. Native-first source with selective cleanup

This option adopts native metadata as the primary source, keeps legacy fallback, adds missing native release-level facts, and removes or redefines only the fields that no longer have a justified source contract.

**Chosen**: it improves fidelity and reduces duplicated work while keeping the change scope controlled.

---

## Migration And Rollout

Implementation is intentionally split across three PRs:

1. **ADR PR**
   - Documents the design and establishes the target behavior
   - No workflow, schema, or data changes

2. **Hotfix PR**
   - Stops generating committed `data/release-artifacts/` entries for releases that already have native metadata
   - Keeps legacy artifact generation intact
   - Addresses the immediate manual cleanup burden in generated PRs

3. **Implementation PR**
   - Makes native metadata the primary analysis source
   - Updates master/report schemas and generation behavior
   - Updates production upload behavior for native vs legacy releases

Legacy release handling remains supported after the hotfix and after the full implementation unless a later ADR explicitly deprecates it.

---

## Assumptions

- [tooling PR #119](https://github.com/camaraproject/tooling/pull/119) aligns the native metadata schema and implementation, so this ADR does not redefine the upstream contract itself
- Native metadata adoption must work per release, not through a repository-wide switch
- The collector remains responsible for derived release annotations and report shaping even when native metadata is the primary source

---

## Related

- [Issue #161](https://github.com/camaraproject/project-administration/issues/161) - Release Collector: adapt to releases with native release-metadata.yaml
- [tooling PR #119](https://github.com/camaraproject/tooling/pull/119) - Align native release metadata schema and implementation
- [ADR-0002](0002-runtime-enrichment-architecture.md) - Runtime Enrichment Architecture
- [ADR-0003](0003-archived-repository-handling.md) - Archived Repository Handling
