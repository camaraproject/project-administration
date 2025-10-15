# CAMARA Project Bulk Repository Administration

*Last updated: 2025-06-31*

This system provides modular GitHub Actions workflows for managing bulk changes across all CAMARA project repositories with proper testing and safety mechanisms.

## Workflow Architecture

The system consists of three core workflows that work together:

### 1. Single Repository Test (`project-admin-single-repo-test.yml`)
- Tests operations on individual repositories before bulk execution
- Validates repository access and permissions
- Provides **structured result display** with detailed feedback and next steps guidance
- Shows the same result format as bulk operations for consistency
- **Always start here** when testing new operations

### 2. Repository Worker (`project-admin-repository-worker.yml`) 
- Reusable workflow component that executes operations on individual repositories
- Called by both single test and bulk workflows
- Handles all the actual file modifications and git operations
- Supports dry-run mode for safe testing
- **Generates standardized result metadata** for consistent reporting
- **Modular design** - Easy to add new operations with reusable git operations
- **Mixed operation types**: Supports both API-based operations (wiki, releases) and file-based operations (CODEOWNERS, file content)

### 3. Bulk Repository Changes (`project-admin-bulk-repository-changes.yml`)
- Orchestrates operations across multiple repositories simultaneously  
- Includes repository filtering and exclusion capabilities
- Runs operations in parallel with configurable limits
- Provides comprehensive execution summaries with **enhanced result categorization**

## Available Operations

### Current Operations
- **add-changelog-file**: Adds template CHANGELOG.md file to repositories that have neither changelog nor releases
- **update-swagger-links**: Migrates swagger editor links to CAMARA's dedicated swagger-ui instance (in files)
- **update-swagger-links-releases**: Migrates swagger editor links to CAMARA's dedicated swagger-ui instance (in release descriptions)

### Operation Details

**add-changelog-file:**
- ✅ **Smart decision logic**: Only acts when repository has neither CHANGELOG file nor releases
- ✅ **Template integration**: Downloads the official CHANGELOG.md template from Template_API_Repository
- ✅ **Safety checks**: 
  - Detects both `CHANGELOG.md` and `CHANGELOG.MD` filename variants
  - Checks for existing releases via GitHub API
  - Issues warnings for mismatched states (CHANGELOG without releases or releases without CHANGELOG)
- ✅ **File-based operation**: Creates pull requests for the new CHANGELOG.md file
- ✅ **Standard template**: Uses the same template as new API repositories
- ⚠️ Issues warnings for repositories with mismatched CHANGELOG/release states (requires manual review)

**update-swagger-links:**
- ✅ **Comprehensive link migration**: Replaces both `editor.swagger.io` and `editor-next.swagger.io` host URLs
- ✅ **Targeted file scanning**: Only processes README.md, README.MD, CHANGELOG.md, CHANGELOG.MD files
- ✅ **Simple URL replacement**: Replaces host portion only, preserves all query parameters and paths
- ✅ **Detailed reporting**: Shows exact count of links updated in each file
- ✅ **Safe operation**: Only modifies URLs that match the specific swagger editor hosts
- ✅ **CAMARA branding**: Migrates to `https://camaraproject.github.io/swagger-ui/` for consistent experience

**update-swagger-links-releases:**
- ✅ **API-based operation**: Updates release descriptions through GitHub API (no git operations)
- ✅ **Comprehensive link migration**: Replaces both `editor.swagger.io` and `editor-next.swagger.io` host URLs in all releases
- ✅ **Handles all releases**: Processes both published and draft releases
- ✅ **Pagination support**: Handles repositories with many releases (100+ releases)
- ✅ **Preserves release metadata**: Only updates description, preserves all other release data (assets, tags, etc.)
- ✅ **Simple URL replacement**: Replaces host portion only, preserves all query parameters and paths
- ✅ **Detailed reporting**: Shows exact count of links updated per release and lists affected releases
- ✅ **Safe operation**: Only modifies URLs that match the specific swagger editor hosts
- ✅ **Permission validation**: Requires `Contents: Write` permission for release modifications
- ✅ **CAMARA branding**: Migrates to `https://camaraproject.github.io/swagger-ui/` for consistent experience

**Host Replacement Approach:**
```
FROM: https://editor.swagger.io/ → TO: https://camaraproject.github.io/swagger-ui/
FROM: https://editor-next.swagger.io/ → TO: https://camaraproject.github.io/swagger-ui/
```

This simple host replacement approach:
- ✅ **Preserves all query parameters** - `?url=...` and any other parameters remain intact
- ✅ **Avoids regex complexity** - No need to escape special characters or match query patterns
- ✅ **More robust** - Works regardless of what follows the host (paths, parameters, fragments)
- ✅ **Same end result** - Complete URLs are transformed correctly

**Link Transformation Example:**
```
FROM: https://editor.swagger.io/?url=https://raw.githubusercontent.com/camaraproject/QualityOnDemand/r2.2/code/API_definitions/quality-on-demand.yaml
TO:   https://camaraproject.github.io/swagger-ui/?url=https://raw.githubusercontent.com/camaraproject/QualityOnDemand/r2.2/code/API_definitions/quality-on-demand.yaml

FROM: https://editor-next.swagger.io/?url=https://raw.githubusercontent.com/camaraproject/DeviceLocation/r2.2/code/API_definitions/location-verification.yaml  
TO:   https://camaraproject.github.io/swagger-ui/?url=https://raw.githubusercontent.com/camaraproject/DeviceLocation/r2.2/code/API_definitions/location-verification.yaml
```

## Key Features

### **Modular Architecture**
- **Operation-specific steps**: Handle only file modifications and declare workflow needs via flags
- **Reusable git operations**: Shared commit/PR/branch logic triggered by operation flags
- **Standardized interface**: Environment variables for communication between operation and git steps
- **Self-maintaining**: Operations declare needs (e.g. `needs_git_workflow=true`) - no hardcoded condition lists to update
- **Easy extensibility**: Adding new operations requires only operation-specific logic and flag setting

### Safety Mechanisms
- **Dry-run mode**: Test operations without making actual changes
- **Repository validation**: Verify access and permissions before execution
- **Parallel execution limits**: Prevent overwhelming GitHub API
- **Fail-fast disabled**: Continue processing other repos if one fails

### Enhanced Monitoring & Feedback
- **Structured result display**: Consistent formatting across single and bulk operations
- **Items requiring attention**: Automatic flagging of warnings and errors
- **Progress tracking**: Monitor execution across multiple repositories
- **Next steps guidance**: Contextual recommendations based on result types
- **Error handling**: Graceful handling of permission issues and failures
- **Change detection**: Only commit when actual changes are made

## Quick Start Guide

### 1. Setup
1. Create the workflow files in your repository (personal or organizational)
2. If running from personal repo targeting `camaraproject`:
   - Create a Personal Access Token with `repo` and `read:org` scopes
   - Add it as a repository secret named `CAMARA_BULK_CHANGE_TOKEN`

### 2. Recommended Testing Workflow
```
Single Repo Test (Dry Run) → Single Repo Test (Live) → Bulk Dry Run → Live Bulk Execution
```

### 3. Usage Examples

**Test on Single Repository:**
1. Go to Actions → "Single Repository Test"
2. Enter repository name (e.g., "DeviceStatus")
3. Select operation type:
   - **add-changelog-file**: For adding CHANGELOG.md template (file-based)
   - **update-swagger-links**: For swagger editor migration in files (file-based)
   - **update-swagger-links-releases**: For swagger editor migration in releases (API-based)
4. Enable dry-run mode
5. **Review structured results** with detailed feedback and next steps guidance

**Execute Bulk Changes:**
1. Go to Actions → "Bulk Repository Changes"  
2. Select operation type from dropdown
3. Choose repository categories and filters
4. Select commit strategy (for file-based operations)
5. Start with dry-run mode enabled
6. Review results and download artifacts
7. Re-run with dry-run disabled for live execution

## Adding New Operations

The modular design makes adding new operations simple. Each operation declares what workflow features it needs:

**For file-based operations (that need git/PR workflows):**
```yaml
- name: Execute Operation - Your New Operation
  if: inputs.operation == 'your-new-operation'
  run: |
    echo "🔍 Doing your operation..."
    
    # Set operation type flag for file-based operations
    echo "needs_git_workflow=true" >> $GITHUB_ENV
    
    # Your file modification logic here
    sed -i 's/old/new/g' some-file.txt
    
    # Set standard interface variables
    echo "has_changes=true" >> $GITHUB_ENV
    echo "result_type=success" >> $GITHUB_ENV
    echo "details=Updated some-file.txt" >> $GITHUB_ENV
    echo "commit_message=admin: your operation description" >> $GITHUB_ENV
    echo "pr_title=admin: your operation title" >> $GITHUB_ENV
    echo "pr_body=Your PR description here" >> $GITHUB_ENV
```

**For API-based operations (like wiki/releases):**
```yaml
- name: Execute Operation - Your API Operation
  if: inputs.operation == 'your-api-operation'
  uses: actions/github-script@v7
  with:
    github-token: ${{ secrets.CAMARA_BULK_CHANGE_TOKEN }}
    script: |
      // Your API logic here
      // Set result variables directly with core.exportVariable()
      core.exportVariable('result_type', 'success');
      core.exportVariable('details', 'API operation completed');
      core.exportVariable('action_taken', 'api-update');
```

The reusable git operations automatically handle:
- ✅ Dynamic author detection from token
- ✅ Dry run handling  
- ✅ Direct commit with fallbacks
- ✅ Pull request creation
- ✅ Branch protection compatibility
- ✅ Error handling and reporting

**No need to update condition lists** - operations declare their needs via flags, making the workflow self-maintaining.

## Token Requirements & Permissions

**GitHub Actions Workflow Permissions:**
- `contents: write` - For reading/writing repository files
- `pull-requests: write` - For creating pull requests

**For File-Based Operations (CHANGELOG, Swagger Links in Files):**
- **Required Permissions**: Contents: Write and Pull Requests: Write permissions
- **Token Scopes**: `repo` (for classic tokens) or `Contents: Write` + `Pull Requests: Write` (for FGPATs)
- **Method**: Uses git operations with automatic fallback to pull requests for protected branches
- **Dynamic Identity**: Automatically uses token's associated user identity for commits

**For Workflow File Operations (Centralize Linting):**
- **Required Permissions**: Contents: Write, Pull Requests: Write, and **Workflow** permissions
- **Token Scopes**: `repo` + `workflow` (for classic tokens) or `Contents: Write` + `Pull Requests: Write` + `Workflows: Write` (for FGPATs)
- **Method**: Uses git operations to create/update workflow files
- **Special Requirement**: GitHub requires explicit `workflow` scope to modify `.github/workflows/` files

**For Release-Based Operations (Swagger Links in Releases):**
- **Required Permissions**: Contents: Write permission (for release modifications)
- **Token Scopes**: `repo` (for classic tokens) or `Contents: Write` + `Metadata: Write` (for FGPATs)
- **Method**: Uses GitHub API to update release descriptions directly
- **Permission Check**: Automatically verified during API operations

**Setting up Personal Access Token:**
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token with required scopes:
   - **For most operations**: `repo` scope
   - **For centralize-linting-workflows**: `repo` + `workflow` scopes
3. Add token as repository secret named `CAMARA_BULK_CHANGE_TOKEN`
4. Token identity will be automatically used for git operations

**⚠️ Important Note for Centralize Linting Operation:**
The `centralize-linting-workflows` operation creates workflow files in `.github/workflows/`. GitHub requires the `workflow` scope on your Personal Access Token to create or update workflow files. Without this scope, you'll see an error like:
```
refusing to allow a Personal Access Token to create or update workflow `.github/workflows/pr_validation_caller.yml` without `workflow` scope
```

## Best Practices

1. **Always test first**: Use single repository test before bulk operations
2. **Start with dry-run**: Review changes before live execution  
3. **Filter wisely**: Use repository filters to target specific subsets when appropriate
4. **Monitor execution**: Watch for failures and address them before continuing
5. **Verify results**: Check a few repositories manually after bulk operations
6. **Review attention items**: Address warnings and errors before proceeding with bulk operations

## Results and Reporting

### **Single Repository Test Results**
Enhanced structured results with:
- **Result type with emoji** (✅ success, ⚠️ warning, ❌ error, etc.)
- **Detailed information** including action taken and operation status
- **Attention flagging** for warnings/errors that need review
- **PR/commit links** when applicable
- **Contextual next steps** based on result type

### **Bulk Operation Results**
Comprehensive results available in multiple formats:
- **Job Summary**: Result type tables, attention items, repository results
- **Downloadable Artifacts**: Markdown reports, CSV data, JSON format
- **Enhanced categorization**: Standardized result types with visual indicators
- **Retention**: Results artifacts retained for 30 days

This system is designed to scale and evolve with the CAMARA project's administrative needs while maintaining reliability and ease of use.