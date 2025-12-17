<a href="https://github.com/camaraproject/project-administration/commits/" title="Last Commit"><img src="https://img.shields.io/github/last-commit/camaraproject/project-administration?style=plastic"></a>
<a href="https://github.com/camaraproject/project-administration/issues" title="Open Issues"><img src="https://img.shields.io/github/issues/camaraproject/project-administration?style=plastic"></a>
<a href="https://github.com/camaraproject/project-administration/pulls" title="Open Pull Requests"><img src="https://img.shields.io/github/issues-pr/camaraproject/project-administration?style=plastic"></a>
<a href="https://github.com/camaraproject/project-administration/graphs/contributors" title="Contributors"><img src="https://img.shields.io/github/contributors/camaraproject/project-administration?style=plastic"></a>
<a href="https://github.com/camaraproject/project-administration" title="Repo Size"><img src="https://img.shields.io/github/repo-size/camaraproject/project-administration?style=plastic"></a>
<a href="https://github.com/camaraproject/project-administration/blob/main/LICENSE" title="License"><img src="https://img.shields.io/badge/License-Apache%202.0-green.svg?style=plastic"></a>
<a href="https://github.com/camaraproject/Governance/blob/main/ProjectStructureAndRoles.md" title="Working Group"><img src="https://img.shields.io/badge/Working%20Group-red?style=plastic"></a>

# project-administration

This repository is the **Control Plane** for CAMARA project administration. It hosts project-wide automation that operates across the CAMARA repository landscape.

Maintained under the supervision of TSC and the Release Management working group.

* CAMARA Governance: https://github.com/camaraproject/Governance
* Release Management repository: https://github.com/camaraproject/ReleaseManagement

## Purpose

This repository provides:
* Project-wide campaigns for coordinated changes across repositories
* Long-lived project support systems (e.g. Release Collector)
* Orchestration workflows for administrative tasks
* Authoritative project-level data (e.g. collected release metadata, api-landscape config input)
* Derived reports and interactive viewers (e.g. meta-release tables)

## Scope

**Belongs here:**
* Project-wide campaigns
* Long-lived project support systems
* Orchestration workflows
* Authoritative project-level data
* Derived, regenerable reports

**Does not belong here:**
* Reusable CI workflows for API repositories (see [tooling](https://github.com/camaraproject/tooling))
* Shared actions or generic tooling

## Current Content

### Release Collector

Automated collection and tracking of CAMARA API releases.

* **Location**: [workflows/release-collector/](workflows/release-collector/)
* **Features**: Daily automated check for updates, creation of releases-master.yaml, data enrichment for reports, interactive HTML viewers for meta-releases (Fall24, Spring25, Fall25) and complete API portfolio. Manual deployment to production website with separate workflow.
* **Documentation**: [workflows/release-collector/docs/README.md](workflows/release-collector/docs/README.md)
* **Workflows**: `release-collector.yml`, `release-collector-production.yml`

#### Release Collector Configuration

Configuration files used by the Release Collector (at repository root level):

* **API Landscape**: [config/api-landscape.yaml](config/api-landscape.yaml) - Portfolio metadata (categories, URLs, tooltips) for API enrichment
* **Meta-Release Mappings**: [config/meta-release-mappings.yaml](config/meta-release-mappings.yaml) - Maps repository release cycles (r1, r2, r3) to meta-releases (Fall24, Spring25, Fall25)

#### Release Collector Outputs

Generated and maintained by the Release Collector system:

* **Data**: [data/releases-master.yaml](data/releases-master.yaml) - Master release metadata for all CAMARA API releases
* **Reports**: [reports/](reports/) - JSON files (all-releases, fall24, spring25, fall25)
* **Viewers**: Interactive HTML viewers are not committed, but deployed for review in staging to https://camaraproject.github.io/project-administration/. Deployment to production website manually triggered with `release-collector-production.yml`.

### Campaigns

Goal-oriented, time-bound initiatives for coordinated changes across repositories (with idempotent execution and dry-run feature)

* **Location**: [campaigns/](campaigns/)
* **Available campaigns**:
  * [release-info/](campaigns/release-info/) - Updates "Release Information" sections in API repository READMEs
  * [api-version-wip-check/](campaigns/api-version-wip-check/) - Verifies wip versions in API files after releases
* **Workflows**: `campaign-release-info.yml`, `campaign-api-version-wip-check.yml`

### API Repository Creation

Automates setup of new API repositories from [Template_API_Repository](https://github.com/camaraproject/Template_API_Repository).

* **Location**: [workflows/api-repository-creation/](workflows/api-repository-creation/)
* **Documentation**: [workflows/api-repository-creation/docs/README.md](workflows/api-repository-creation/docs/README.md)
* **Workflow**: `admin-api-repository-creation.yml`
* **Requirements**: Environment `repository-creation` with `GH_REPO_CREATE_TOKEN`

### Legacy Reporting (to be replaced)

* **Workflow**: `report-repository-overview.yml` - Repository overview reporting (legacy, will be replaced)

### Reusable Actions

Supporting GitHub Actions for campaigns and workflows.

* **Location**: [actions/](actions/)
* **Actions**: render-mustache, replace-delimited-content, ensure-delimited-section, campaign-finalize-per-repo, and others

## Repository Structure

```text
project-administration/
├── .github/workflows/           # Workflow entry points
├── actions/                     # Reusable GitHub Actions for campaigns
├── campaigns/                   # Goal-oriented initiatives
│   ├── api-version-wip-check/   # API version compliance checks
│   └── release-info/            # README release info updates
├── config/                      # Shared configuration files
│   ├── api-landscape.yaml       # API portfolio metadata
│   └── meta-release-mappings.yaml
├── data/                        # Release Collector outputs (master data)
│   └── releases-master.yaml     # Master release metadata
├── reports/                     # Release Collector outputs (JSON reports)
└── workflows/
    ├── api-repository-creation/ # Repository creation system
    │   └── docs/README.md
    └── release-collector/       # Release tracking system
        ├── docs/                # Documentation
        ├── schemas/             # YAML schemas
        ├── scripts/             # Processing scripts
        └── templates/           # HTML/viewer templates
```

## Release Information

This repository has no regular release schedule. Workflows are continuously updated based on current needs:
* Tested versions are in the `main` branch
* Versions under test are in other branches or individual forks

## Contributing

Maintained by **Release Management WG / TSC**.

* Issues and PRs are discussed in [Release Management working group](https://github.com/camaraproject/ReleaseManagement) meetings
* Larger changes impacting multiple repositories are discussed in the Governance repository and approved by [TSC](https://lf-camaraproject.atlassian.net/wiki/x/0RDe)

**Contact**:
* Admin team: <adm@lists.camaraproject.org>
* Release Management WG: <release-management@lists.camaraproject.org>
