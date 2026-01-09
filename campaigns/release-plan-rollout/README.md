# Campaign: Release Plan Rollout

This campaign adds `release-plan.yaml` to all CAMARA API repositories.

## Purpose

The `release-plan.yaml` file enables:
- Declaration of release targets (tag, type, API versions)
- CI validation of release planning consistency
- Automated release progress tracking

## Usage

### Plan Mode (Dry Run)

Run in plan mode to preview changes without creating PRs:

```yaml
# Via GitHub Actions UI
dry_run: true
include: ""  # All repos, or "QualityOnDemand, DeviceLocation" for specific repos
```

### Apply Mode

Run in apply mode to create PRs:

```yaml
dry_run: false
include: ""  # All repos
```

## Workflow Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `dry_run` | boolean | `true` | Plan mode (no PRs created) |
| `include` | string | `""` | Comma-separated repository names to process |
| `include_wip_repos` | boolean | `true` | Include repos without release but with API files (work in progress) |
| `include_new_repos` | boolean | `false` | Include repos without API files and releases (new repos) |

## Logic

1. **Select**: Query `repositories` array in releases-master.yaml for all API repositories
2. **Categorize**: Detect repository categories:
   - **With releases**: Has `latest_public_release` or `newest_pre_release`
   - **WIP**: No releases but has API files in `code/API_definitions/`
   - **New**: No releases and no API files
3. **Filter**: Apply INCLUDE filter, category filters, skip repos with existing release-plan.yaml
4. **Generate**: Create release-plan.yaml (status quo for repos with releases, placeholder for others)
5. **PR**: Create PR with instructions for code owners (includes warning for placeholders)

## Generated Content

### Repositories with Releases

For repositories with releases, the campaign generates `release-plan.yaml` reflecting the **last release state** (status quo):

```yaml
repository:
  release_track: "meta-release"
  meta_release: "Fall25"
  target_release_tag: "r1.2"
  target_release_type: "public-release"
apis:
  - api_name: "quality-on-demand"
    target_api_version: "1.0.0"
    target_api_status: "public"
```

Code owners should update `target_*` fields to reflect their intended next release.

### Repositories without Releases (Placeholders)

For WIP and new repositories, the campaign generates a **placeholder** with default values:

```yaml
repository:
  release_track: "none"
  target_release_tag: "r1.1"
  target_release_type: "none"
apis: []
```

These PRs include a warning banner. Code owners must:
1. Update all `target_*` fields to reflect their intended release
2. Add API entries matching their `code/API_definitions/*.yaml` files

## Related

- [Release Plan Schema](https://github.com/camaraproject/ReleaseManagement/blob/main/artifacts/metadata-schemas/schemas/release-plan-schema.yaml)
- [Release Workflow Documentation](https://github.com/camaraproject/ReleaseManagement/issues/342)
- [Tracking Issue](https://github.com/camaraproject/project-administration/issues/99)
