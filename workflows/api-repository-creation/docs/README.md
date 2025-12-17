# 📘 API Repository Creation Automation for CAMARA

*Last updated: 2025-06-10*

This document describes how to use the GitHub Action in the `project-administration` repository to automate the setup of new API repositories within the CAMARA GitHub organization.

## 📋 Table of Contents

- [Purpose](#-purpose)
- [Quick Start](#-quick-start)
- [Prerequisites](#-prerequisites)
- [How to Use](#-how-to-use)
  - [Inputs](#-inputs)
  - [Example Usage](#-example-usage)
- [What It Does](#-what-it-does)
  - [Input Validation](#-input-validation)
  - [Repository](#-repository)
  - [Teams](#-teams)
  - [Files](#-files)
  - [Rulesets](#-rulesets)
  - [Cleanup](#-cleanup)
  - [Verification](#-verification)
- [Requirements](#-requirements)
  - [GitHub Personal Access Token (PAT)](#-github-personal-access-token-pat)
  - [Environment Restrictions](#-environment-restrictions)
- [Required Template Files](#-required-template-files)
- [Testing and Validation](#-testing-and-validation)
- [Troubleshooting](#-troubleshooting)
- [FAQ](#-frequently-asked-questions)
- [Customization Guide](#-customization-guide)

---

## 🚀 Purpose

To automate the initial setup of a new repository using the `Template_API_Repository` as a template, including:

- **Input validation** and token permission verification
- Creating a new repository from the template with retry logic
- Setting metadata and repository settings
- Creating teams and assigning permissions (if in an organization)
- Adding CODEOWNERS based on a template
- Setting up branch protection rules
- Posting issues with initial checklists
- Cleaning up setup artifacts (workflow + templates)
- **Comprehensive verification** of the setup

---

## ⚡ Quick Start

1. Go to **Actions** → **API Repository Creation** in `camaraproject/project-administration`
2. Click **"Run workflow"**
3. Fill required inputs (see [example](#-example-usage) below)
4. **Recommended**: Check "Dry run mode" first to validate inputs safely
5. Click **"Run workflow"** to start

---

## 📋 Prerequisites

Before running this workflow, ensure you have:

1. **Write access to the `project-administration` repository** in the CAMARA organization
2. **Appropriate permissions** to create repositories and teams in the organization
3. **FGPAT token** with required scopes (see [Requirements](#-requirements))
4. **Environment setup** in the `project-administration` repository (see [Environment Restrictions](#-environment-restrictions))
5. **Template repository** (`Template_API_Repository`) must exist and be accessible

---

## ⚙️ How to Use

1. Go to the **Actions** tab of the `camaraproject/project-administration` repository
2. Click on the **"API Repository Creation"** workflow in the left sidebar
3. Click the **"Run workflow"** button
4. Fill in the required inputs in the form
5. **Optional**: Check "Dry run mode" to validate inputs without creating repository
6. Click **"Run workflow"** to start the process
7. Monitor the workflow execution for any issues

### 🔢 Inputs

| Input | Required | Description | Format/Example |
|-------|----------|-------------|----------------|
| `repo_name` | Yes | Name of the new repository to create | `QoSBooking` |
| `repo_wiki_page` | Yes | URL of the repository wiki page | `https://lf-camaraproject.atlassian.net/wiki/x/SADHB` |
| `subproject_name` | No | Subproject/working group name | `QualityOnDemand` |
| `subproject_wiki_page` | No | URL of the subproject wiki page | `https://lf-camaraproject.atlassian.net/wiki/x/XCPe` |
| `mailinglist_name` | Yes | Mailing list name in the form "sp-xxx" | `sp-qod` |
| `initial_codeowners` | Yes | GitHub usernames with `@` prefix | `@alice @bob @charlie` |
| `team_prefix` | No | Repository name in kebab-case for team creation | `qos-booking` |
| `dry_run` | No | Validate inputs without creating repository | `true/false` |

### 📝 Example Usage

For creating a QoS Booking API repository:

```yaml
repo_name: "QoSBooking"
subproject_name: "QualityOnDemand"
repo_wiki_page: "https://lf-camaraproject.atlassian.net/wiki/x/SADHB"
subproject_wiki_page: "https://lf-camaraproject.atlassian.net/wiki/x/XCPe"
mailinglist_name: "sp-qod"
initial_codeowners: "@alice @bob @charlie"
team_prefix: "qos-booking"
dry_run: false  # Default - creates the repository immediately
```

**Teams that would be created:**
- `qos-booking_maintainers` (under maintainers team)
- `qos-booking_codeowners` (under codeowners team)

---

## 📄 What It Does

### ✅ Input Validation

**Before any repository creation**, the workflow validates:
- **Repository name format**: Letters, numbers, dots, hyphens, underscores only
- **Mailing list format**: Must follow `sp-xxx` pattern (lowercase)
- **Codeowners format**: Must use `@username` format
- **URL formats**: Wiki pages must be valid HTTP/HTTPS URLs
- **Team prefix format**: Lowercase letters, numbers, hyphens only (if provided)

**Token validation includes:**
- Authentication status verification
- Repository access permissions check
- Organization access capabilities assessment

### ✅ Repository

- **Checks out template repository**: Downloads `Template_API_Repository` contents
- **Creates new public repository** from the template with retry logic (3 attempts with backoff)
- **Sets repository metadata**: Description, homepage (to wiki), and topic `sandbox-api-repository`
- **Configures repository features**: Enables issues and discussions, disables wiki
- **Waits for repository availability** before proceeding with configuration

### ✅ Teams

**Team creation behavior depends on inputs and permissions:**

- **If `team_prefix` is provided AND organization access is available**:
  - Verifies parent teams (`maintainers`, `codeowners`) exist
  - Creates `{team_prefix}_maintainers` (under maintainers team)
  - Creates `{team_prefix}_codeowners` (under codeowners team)
  - Validates GitHub users before inviting
  - Invites specified codeowners to the codeowners team
  - Sets appropriate permissions:
    - Maintainers: `triage` permission
    - Codeowners: `push` permission
    - Admins: `maintain` permission

- **If `team_prefix` is empty OR no organization access**:
  - Skips all team operations entirely
  - No teams created, no user invitations sent, no team permissions assigned
  - Behaves as if running without organization access

**Note**: Requires "Members: Read and write" organization permission for team operations.

### ✅ Files

- **README.md**: Replaces placeholders with actual values:
  - `{{repo_name}}` → Repository name
  - `{{repo_wiki_page}}` → Repository wiki URL  
  - `{{subproject_name}}` → Subproject name
  - `{{subproject_wiki_page}}` → Subproject wiki URL
  - `{{mailinglist_name}}` → Mailing list name
  - `{{initial_codeowners}}` → Codeowner information

- **Issue template config**: Updates `.github/ISSUE_TEMPLATE/config.yml` with repository name

- **CODEOWNERS file**: Generates from `templates/CODEOWNERS_TEMPLATE` template

- **Initial issues**: Creates from templates in `templates/issues/` **before template cleanup**:
  - Administrative tasks issue with automatic completion comment
  - Codeowner tasks issue with responsibilities

### ✅ Initial Issues

- **Creates administrative tasks issue** from `templates/issues/initial-admin.md`
- **Creates codeowner tasks issue** from `templates/issues/initial-codeowners.md`
- **Adds completion comment** to admin issue confirming automation success
- **Performed before template cleanup** to ensure templates are available

### ✅ Cleanup

- **Dynamically identifies template files** in the `templates/` directory
- Deletes identified template files from the newly created repository:
  - All files found in `templates/` directory and subdirectories
  - Includes CODEOWNERS templates, issue templates, documentation files
- **Graceful handling** of missing files during cleanup
- **Performed before ruleset application** to avoid conflicts with branch protection rules

### ✅ Rulesets

- **Syncs all rulesets** from `Template_API_Repository` to new repository
- **Applied after template cleanup** to prevent conflicts with direct file operations
- Preserves ruleset configurations, including:
  - Branch protection rules
  - Required reviews and status checks
  - Merge requirements and restrictions

**Note**: The cleanup-then-rulesets order is crucial - applying branch protection rules before cleanup would prevent direct file deletion and cause HTTP 409 errors.

### ✅ Verification

**Comprehensive setup verification includes:**
- Repository accessibility and settings confirmation
- Team permissions verification (if teams were created)
- CODEOWNERS file existence and content validation
- Issue creation confirmation
- Template file cleanup verification
- **Success summary** with repository URL and status

---

## 🔐 Requirements

### 🔑 GitHub Personal Access Token (PAT)

- **Storage**: Repository environment secret named `GH_REPO_CREATE_TOKEN`
- **Type**: Fine-grained personal access token (FGPAT)
- **Repository access**: Allow access to:
  - `camaraproject/Template_API_Repository` (template source)
  - Target organization repositories where new repos will be created (=all repositories in camaraproject organization)

#### Required Permissions:

**Repository permissions:**
- **Contents**: Read and write (for accessing and updating files)
- **Issues**: Read and write (for creating initial issues)
- **Metadata**: Read-only (for repository information)
- **Administration**: Read and write (for repo settings and team setup)

**Organization permissions:**
- **Members**: Read and write (for team creation, management, and user invitations)

#### Token Setup Steps:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Fine-grained personal access token"
3. Set expiration (recommended: 90 days)
4. Select "All repositories" for organization access
5. Configure permissions as listed above
6. Generate and copy the token

### 🛡 Environment Restrictions

- **Environment name**: `repository-creation` 
- **Location**: Must be configured in the `camaraproject/project-administration` repository
- **Protection rules**: Recommended to add admin team as required reviewers

#### Environment Setup Steps:
1. Go to `camaraproject/project-administration` repository **Settings → Environments**
2. Click **"New environment"**
3. Name: `repository-creation`
4. **Environment protection rules**:
   - Add `@camaraproject/admins` team as required reviewers
   - Optionally add deployment branches restriction
5. **Environment secrets**:
   - Add `GH_REPO_CREATE_TOKEN` with your fine-grained PAT

---

## 📦 Required Template Files

The following files must exist in the `Template_API_Repository`:

```
README.md                              # Root README with {{placeholders}}
.github/ISSUE_TEMPLATE/config.yml      # Issue template config with {{repo_name}}
templates/CODEOWNERS_TEMPLATE          # CODEOWNERS template
templates/issues/initial-admin.md      # Admin tasks issue template
templates/issues/initial-codeowners.md # Codeowners tasks issue template
templates/README.md                    # Template documentation (gets deleted)
```

### Placeholder Format:
- Use `{{placeholder_name}}` format in template files
- Available placeholders:
  - `{{repo_name}}` - Repository name
  - `{{repo_wiki_page}}` - Repository wiki URL
  - `{{subproject_name}}` - Subproject name
  - `{{subproject_wiki_page}}` - Subproject wiki URL
  - `{{mailinglist_name}}` - Mailing list name
  - `{{initial_codeowners}}` - Initial codeowners list

---

## 🧪 Testing and Validation

### Dry Run Mode

**Enable dry run mode** to validate inputs and permissions without creating a repository:

1. Check the "Dry run mode" option when running the workflow
2. The workflow will:
   - ✅ Validate all inputs according to format requirements
   - ✅ Verify token permissions and organization access
   - ✅ Show a summary of what would be created
   - ❌ **Not create any repository or teams**
3. **To actually create the repository**: Leave "Dry run mode" unchecked (default)

**Dry run output includes:**
- Input validation results
- Token permission status
- Organization access status
- Summary of teams that would be created
- All configuration that would be applied

### Testing Tips

- **Repository naming**: Use test names like `test-api-$(date +%s)` to avoid collisions
- **Personal testing**: Run in a personal account to skip org/team features
- **Use dry run first**: Enable dry run mode for initial validation
- **Post-creation checklist**: Verify after creation:
  - Repository metadata and settings
  - CODEOWNERS file and team permissions
  - Issue templates and initial issues created
  - Branch protection rules applied
  - Template files removed
  - Issue template config updated with repo name

### Verification Checklist

After successful execution, verify:
- [ ] Repository created with correct name and settings
- [ ] Teams created (if team_prefix provided) with correct permissions
- [ ] CODEOWNERS file contains specified users
- [ ] Initial issues created with admin and codeowner tasks
- [ ] Template files cleaned up from new repository
- [ ] Branch protection rules applied from template (after cleanup)
- [ ] Repository description and homepage set correctly

---

## 🛠 Troubleshooting

| Issue | Error Pattern | Root Cause | Solution |
|-------|---------------|------------|----------|
| **Input validation failed** | `Repository name must contain only...` | Invalid input format | Follow format requirements in input descriptions |
| **Token authentication failed** | `Token authentication failed` | Invalid or expired PAT | Generate new fine-grained PAT with correct permissions |
| **Repository creation failed** | `Repository creation failed after X attempts` | GitHub orchestration issue | Wait a few minutes and retry; check GitHub status |
| **Cannot access teams endpoint** | `Limited organization access` | Missing "Members: Read and write" permission | Add organization permission to PAT |
| **Team creation failed** | `Parent team 'maintainers' does not exist` | Parent teams don't exist | Ensure `maintainers` and `codeowners` teams exist in org |
| **Repository already exists** | `Repository X already exists` | Name collision | Choose a different repository name |
| **User invitations failed** | `User @username does not exist` | Invalid username or non-existent users | Verify GitHub usernames are correct and users exist |
| **Template not found** | `Template repo inaccessible` | Template repo access issue | Check PAT has access to Template_API_Repository |
| **Environment not found** | `GH_REPO_CREATE_TOKEN is not set` | Missing environment or secret | Create `repository-creation` environment with secret |

### Debug Information

The workflow includes comprehensive debugging that shows:
- **Input validation results** with specific error messages
- **Token permission analysis** and organization access status
- **Step-by-step progress** with success/failure indicators
- **API response details** for troubleshooting
- **Verification results** for all configured components

### Recovery from Partial Failures

If the workflow fails partway through:

1. **Repository created but incomplete**: 
   - Run the workflow again (it will skip existing components)
   - Or complete setup manually using the checklist issues

2. **Team creation failed**:
   - Check organization permissions in PAT
   - Verify parent teams exist
   - Re-run with corrected token

3. **File updates failed**:
   - Check if repository became available
   - Manually update files using the template patterns

### Workflow Order Improvements

**Template Cleanup vs. Rulesets**: The workflow has been optimized to perform template file cleanup *before* applying repository rulesets. This prevents HTTP 409 conflicts where branch protection rules would block direct file deletion operations. If you encounter ruleset-related cleanup errors, ensure you're using the latest version of the workflow.

---

## ❓ Frequently Asked Questions

**Q: Why did the workflow move to the `project-administration` repository?**  
A: For centralized management of CAMARA project administration and automation workflows.

**Q: Can I run this for personal repositories?**  
A: Yes, but team-related steps will be automatically skipped.

**Q: What's the difference between dry run and normal mode?**  
A: Dry run (when enabled) validates inputs and shows what would be created without actually creating anything. Normal mode (default) creates the repository and all components.

**Q: How do I modify the template files?**  
A: Edit files in the `Template_API_Repository`, not in the `tooling` repository. The workflow syncs from the template.

**Q: Can I add custom branch protection rules?**  
A: Yes, add rulesets to the `Template_API_Repository` and they'll be copied automatically.

**Q: What happens if the workflow fails partway through?**  
A: The repository will be created but may be incomplete. Check the verification output and complete setup manually, or run the workflow again.

**Q: How do I add more initial issues?**  
A: Add more template files to the `templates/issues/` directory in the template repository.

**Q: Why are teams not being created?**  
A: Check that: (1) `team_prefix` is provided, (2) you have organization access, (3) parent teams exist, (4) PAT has "Members: Read and write" permission.

**Q: Can I use this workflow for non-API repositories?**  
A: The workflow is designed for API repositories but can be adapted. You may want to modify the description template and topic assignments.

---

## 🔧 Customization Guide

### Extending the Workflow

1. **Adding custom files**: Place template files in `templates/` directory of the template repository
2. **Modifying issue templates**: Edit files in `templates/issues/` of the template repository
3. **Adding validation rules**: Modify the "Validate inputs" step in the workflow
4. **Custom repository settings**: Modify the "Configure repository settings" step
5. **Additional file processing**: Add new steps similar to the README and config file updates
6. **Custom team structure**: Modify the team creation sections in the workflow
7. **Custom cleanup logic**: Modify the cleanup steps (executed before ruleset application)
8. **Custom rulesets**: Add or modify rulesets in the template repository (applied after cleanup)

### Template Repository Structure

Maintain this structure in `Template_API_Repository`:
```
Template_API_Repository/
├── README.md                           # Main template with placeholders
├── .github/
│   └── ISSUE_TEMPLATE/
│       └── config.yml                  # Issue config with {{repo_name}}
└── templates/
    ├── CODEOWNERS_TEMPLATE             # Ownership template
    ├── README.md                       # Documentation (deleted after setup)
    └── issues/
        ├── initial-admin.md            # Admin tasks template
        └── initial-codeowners.md       # Codeowner tasks template
```

### Adding New Placeholders

1. **In template files**: Use `{{new_placeholder}}` format
2. **In workflow**: Add input parameter and sed replacement in file update steps
3. **In documentation**: Document the new placeholder and its purpose

### Environment Variables

The workflow uses these configurable environment variables:
```yaml
TEMPLATE_REPO_NAME: Template_API_Repository  # Template repository name
MAX_RETRIES: 3                              # Repository creation retry attempts
RETRY_WAIT_BASE: 10                         # Base wait time between retries (seconds)
API_WAIT_TIME: 2                            # Wait time for API availability (seconds)
MAX_API_ATTEMPTS: 5                         # Maximum API availability check attempts
```

---

## 🔗 Related Resources

- [GitHub Fine-grained PATs Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token#creating-a-fine-grained-personal-access-token)
- [GitHub Environments Documentation](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [GitHub Teams and Permissions](https://docs.github.com/en/organizations/organizing-members-into-teams)
- [CAMARA API Design Guidelines](https://github.com/camaraproject/Commonalities/blob/main/documentation/CAMARA-API-Design-Guide.md)
- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)

---

For questions or issues, open an issue in the `project-administration` repository or contact the CAMARA admin team.

---

*Last updated: June 2025*