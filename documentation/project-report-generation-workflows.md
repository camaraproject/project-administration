# CAMARA Reporting Workflows - User Guide

*Last updated: 2025-06-18*

> **⚠️ DEPRECATION NOTICE**: The `project-report-camara-api-releases.yml` workflow described in this document is maintained for backward compatibility only. 
> For new features and meta-release support (Fall25, Spring25, etc.), please use the new `meta-release-reporting.yml` workflow.
> See [Meta-Release Reporting Documentation](meta-release-reporting-workflow.md) for details.

## Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Workflow Configuration](#workflow-configuration)
4. [Understanding Reports](#understanding-reports)
5. [Troubleshooting](#troubleshooting)
6. [FAQ](#faq)

---

## Overview

Two specialized GitHub Actions workflows provide comprehensive analysis for CAMARA project repositories:

### 🏢 Repository Overview Workflow
- **Repository Health Monitoring** - Activity patterns, contribution statistics, project health
- **Enhanced Template Compliance Verification** - 9-point verification for API repositories with website validation
- **Organization-wide Statistics** - Complete overview by repository type
- **Automated Scheduling** - Weekly reports with enhanced workflow summaries

### 📦 API Releases Workflow
- **Parallel Processing** - 70% faster execution (3-5 minutes vs 15-20 minutes)
- **Meta-Release Analysis** - Fall24/Spring25/Fall25 categorization
- **API Version Tracking** - Extracts and analyzes OpenAPI specifications
- **Consistency Validation** - Main branch vs release comparison
- **Advanced Reporting** - Executive summaries and detailed breakdowns

---

## Quick Start

### Prerequisites
- GitHub account with access to run workflows
- CAMARA organization membership or read access
- Repository admin/write permissions
- Fine-grained Personal Access Token (requires CAMARA admin approval)

### 1. Deploy Workflows
Copy both workflow files to `.github/workflows/` in your repository:
- `project-report-camara-repository-overview.yml`
- `project-report-camara-api-releases.yml`

### 2. Configure Authentication

**Create Fine-grained Personal Access Token:**
1. GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Generate new token:
   - **Resource owner**: `camaraproject` organization
   - **Repository access**: "All repositories"  
   - **Repository permissions**: Contents (Read), Metadata (Read), Issues (Read), Pull requests (Read), Actions (Read)
   - **Organization permissions**: Members (Read), Administration (Read)
3. **Wait for approval** from CAMARA administrators

**Add Token as Repository Secret:**
1. Wait for token approval (check status in GitHub settings)
2. Repository Settings → Secrets and variables → Actions
3. New repository secret: Name `CAMARA_REPORT_TOKEN`, Value: approved token

### 3. Run Your First Report
1. Actions tab → "CAMARA Repository Overview"
2. Run workflow with default settings
3. Download report from Artifacts when complete

---

## Workflow Configuration

### Repository Overview Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Include archived** | `false` | Include archived repositories in analysis |
| **Detailed activity** | `false` | Deep analysis using commits/issues/PRs (slower but accurate) |
| **Template compliance** | `false` | 6-point template verification for API repositories |

### API Releases Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Include pre-releases** | `false` | Include development releases in analysis |
| **Include legacy** | `false` | Include non-rX.Y format releases |

### Common Usage Scenarios

| Use Case | Workflow | Configuration |
|----------|----------|---------------|
| Weekly health check | Repository Overview | Default settings |
| Template compliance audit | Repository Overview | Enable template compliance |
| Release status review | API Releases | Default settings |
| Development tracking | API Releases | Include pre-releases |

---

## Understanding Reports

### Repository Overview Report

**Key Sections:**
- **Repository Statistics** - Types, languages, issues, PRs breakdown
- **Template Compliance Analysis** - API repository compliance with violations details
- **Activity Analysis** - Recent activity comparison (simple vs detailed modes)  
- **Repository Listings** - Complete lists by type with health metrics

**Template Compliance Checks:**
1. ✅ No "family" terms in description/README
2. ✅ Description starts with repository type (Sandbox/Incubating)
3. ✅ Website points to CAMARA Atlassian
4. ✅ **Website exists and contains repository name in title**
5. ✅ No "family" terms in README content
6. ✅ README line 8 contains correct badge
7. ✅ **README line 10 contains repository name header (`# RepoName`)**
8. ✅ **README line 12 contains expected descriptive line**
9. ✅ **README line 14 contains homepage link in markdown format (not bare link)**

### API Releases Report

**Key Sections:**
- **Executive Summary** - Key metrics and meta-release breakdown
- **Meta-Release Summary** - Fall24/Spring25/Fall25 categorization
- **Unique API Analysis** - API counts by release category
- **Recent Releases** - 30-day activity window
- **Consistency Analysis** - Main branch vs release validation
- **Detailed Repository Analysis** - Per-repo release history

**Meta-Release Logic:**
- **Fall24**: First release in major version during Aug-Sep 2024
- **Spring25**: First release in major version during Feb-Mar 2025  
- **Fall25**: First release in major version during Aug-Sep 2025
- **Patch**: Subsequent releases in same major version
- **Legacy**: Non-rX.Y format releases
- **Pre-release**: Development releases

---

## Troubleshooting

### Common Issues

**Authentication Errors**
- ✅ Verify `CAMARA_REPORT_TOKEN` secret is configured
- ✅ Check token approval status in GitHub Settings → Personal access tokens
- ✅ Ensure token hasn't expired
- ✅ Test manually: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/orgs/camaraproject/repos`

**Performance Issues**
- ✅ Repository Overview: Disable detailed activity/template compliance for faster runs
- ✅ Template compliance with website validation may take longer due to HTTP requests
- ✅ API Releases: Monitor logs for API rate limiting
- ✅ Run during off-peak hours to avoid network congestion

**Missing Data**
- ✅ Repository Overview: Check if repositories are archived (excluded by default)
- ✅ API Releases: Ensure repositories have correct topics (`sandbox-api-repository`, `incubating-api-repository`)
- ✅ Review processing errors section in reports

**Template Compliance Issues**
- ✅ Verify README.md exists in repository root
- ✅ Check line 8 contains exact badge HTML
- ✅ Ensure description and homepage are set correctly

### Debug Steps
1. **Check Workflow Logs** - Actions tab → Failed run → View logs
2. **Verify Token Status** - GitHub Settings → Developer settings → Personal access tokens
3. **Test API Access** - Use curl commands to verify repository access
4. **Validate Repository Setup** - Check topics, descriptions, README format

---

## FAQ

### General Questions

**Q: How often should I run these workflows?**
A: Repository Overview runs automatically weekly. Run API Releases monthly or as needed for release tracking.

**Q: Which workflow should I run first?**
A: Start with Repository Overview for foundation understanding, then use API Releases for specific release analysis.

**Q: Can I schedule the API Releases workflow?**
A: Yes, you can add a schedule section to the workflow file for automated runs.

### Technical Questions

**Q: Why do I need a Fine-grained Personal Access Token?**
A: The default GITHUB_TOKEN only works within the same repository. Cross-organization access requires elevated permissions.

**Q: How long does token approval take?**
A: Depends on CAMARA admin team availability. Contact them directly for expedited approval.

**Q: Why is the API Releases workflow so much faster now?**
A: Parallel processing using matrix strategy - processes 8 repositories per group with up to 6 groups simultaneously.

### Repository Overview Questions

**Q: What does "Template used ✅" mean?**
A: The API repository passes all 6 template compliance checks including proper README format, badges, and descriptions.

**Q: When should I enable detailed activity analysis?**
A: When you need precise activity dates. It analyzes actual commits/issues/PRs instead of just repository metadata.

### API Releases Questions

**Q: What's the difference between meta-releases and patches?**
A: Meta-releases (Fall24/Spring25/Fall25) are first releases in major versions. Patches are subsequent releases in the same major version.

**Q: What if website validation fails but the link works in my browser?**
A: Website validation may fail due to network timeouts, server issues, or access restrictions. Check the specific error message in the compliance report. The validation uses a 10-second timeout and requires the page title to contain the repository name.

**Q: How does consistency analysis work?**
A: Compares API versions between main branch and latest releases, checks that release descriptions mention API versions.

**Q: What if I see processing errors?**
A: Processing errors are normal for some repositories due to API limits or access restrictions. The workflow continues and reports which repositories had issues.

---

## Support

**Quick Help:**
1. 📖 Check this documentation for common solutions
2. 🔍 Review workflow execution logs for specific errors  
3. 🔑 Verify Fine-grained PAT is approved by CAMARA admins
4. ❓ Open issue with workflow name and detailed error information

**Security Reminder:**
Never share your personal access token in issues or public communications. Tokens should be kept secure and rotated regularly.

---

*This guide covers both CAMARA Reporting Workflows. For workflow-specific details, refer to the relevant sections above.*