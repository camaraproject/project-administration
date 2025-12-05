import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';

// GitHub Actions helpers (no @actions/core dependency for smaller bundle)
function getInput(name: string): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '';
}

function setOutput(name: string, value: string): void {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    // Handle multiline values
    if (value.includes('\n')) {
      const delimiter = `ghadelimiter_${Date.now()}`;
      fs.appendFileSync(output, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
    } else {
      fs.appendFileSync(output, `${name}=${value}\n`, 'utf8');
    }
  } else {
    console.log(`::set-output name=${name}::${value}`);
  }
}

function setFailed(message: string): void {
  console.error(`::error::${message}`);
  process.exit(1);
}

function info(message: string): void {
  console.log(message);
}

function warning(message: string): void {
  console.log(`::warning::${message}`);
}

// Sanitize strings to remove control characters that break JSON parsing in workflows
function sanitizeForJson(obj: any): any {
  if (typeof obj === 'string') {
    // Replace control characters (except \n, \r, \t which are handled by JSON.stringify)
    return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJson);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = sanitizeForJson(obj[key]);
    }
    return result;
  }
  return obj;
}

// Types
interface YamlFileIssue {
  file: string;
  check_type: 'info_version' | 'server_url' | 'server_url_format' | 'yaml_parse_error';
  actual: string;
  expected: string;
  line_number?: number;
}

interface FeatureFileIssue {
  file: string;
  check_type: 'feature_header' | 'resource_url';
  actual: string;
  expected: string;
  line_number: number;
}

interface ComplianceReport {
  repo_name: string;
  repo_slug: string;
  is_compliant: boolean;
  file_count: number;
  yaml_files_checked: number;
  feature_files_checked: number;
  yaml_files: YamlFileIssue[];
  feature_files: FeatureFileIssue[];
}

// Server URL validation per CAMARA-API-Design-Guide.md
// Expected format: {apiRoot}/<api-name>/<api-version>
const SERVER_URL_PATTERN = /^\{apiRoot\}\/[\w-]+\/(v[\w.-]+)$/;

function checkYamlFile(filePath: string, repoPath: string): YamlFileIssue[] {
  const issues: YamlFileIssue[] = [];
  const relativePath = path.relative(repoPath, filePath);

  let doc: any;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    doc = yaml.load(content);
  } catch (err: any) {
    issues.push({
      file: relativePath,
      check_type: 'yaml_parse_error',
      actual: err.message,
      expected: 'valid YAML'
    });
    return issues;
  }

  if (!doc) {
    return issues;
  }

  // Check info.version
  const infoVersion = doc?.info?.version;
  if (infoVersion !== undefined && infoVersion !== 'wip') {
    issues.push({
      file: relativePath,
      check_type: 'info_version',
      actual: String(infoVersion),
      expected: 'wip'
    });
  }

  // Check servers[].url
  const servers = doc?.servers;
  if (Array.isArray(servers)) {
    for (let i = 0; i < servers.length; i++) {
      const serverUrl = servers[i]?.url;
      if (typeof serverUrl === 'string') {
        // Check URL format matches CAMARA pattern
        const match = serverUrl.match(SERVER_URL_PATTERN);
        if (!match) {
          // URL doesn't match expected pattern - flag as format error
          issues.push({
            file: relativePath,
            check_type: 'server_url_format',
            actual: serverUrl,
            expected: '{apiRoot}/<api-name>/vwip'
          });
        } else {
          // URL matches pattern, check version segment
          const versionSegment = match[1];
          if (versionSegment !== 'vwip') {
            issues.push({
              file: relativePath,
              check_type: 'server_url',
              actual: versionSegment,
              expected: 'vwip'
            });
          }
        }
      }
    }
  }

  return issues;
}

function checkFeatureFile(filePath: string, repoPath: string): FeatureFileIssue[] {
  const issues: FeatureFileIssue[] = [];
  const relativePath = path.relative(repoPath, filePath);

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return issues;
  }

  const lines = content.split('\n');

  // Pattern for Feature line: "Feature: CAMARA API Name, vX.Y.Z - Operation"
  // We look for ", v" followed by version info
  const featureVersionPattern = /Feature:.*,\s*(v[\w.-]+)/i;

  // Pattern for resource/path URLs
  // Matches: the resource "/api-name/v1/..." or the path "/api-name/v1/..."
  const resourcePattern = /(?:the resource|the path)\s+["'`]([^"'`]+)["'`]/gi;

  // Pattern to extract version from URL path: /api-name/vX.Y/resource or api-name/vX.Y/resource
  const urlVersionPattern = /(?:^|\/)[\w-]+\/(v[\w.-]+)\//i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Check Feature line
    const featureMatch = line.match(featureVersionPattern);
    if (featureMatch) {
      const version = featureMatch[1];
      if (version.toLowerCase() !== 'vwip') {
        issues.push({
          file: relativePath,
          check_type: 'feature_header',
          actual: version,
          expected: 'vwip',
          line_number: lineNumber
        });
      }
    }

    // Check resource/path URLs
    let resourceMatch;
    resourcePattern.lastIndex = 0; // Reset regex state
    while ((resourceMatch = resourcePattern.exec(line)) !== null) {
      const url = resourceMatch[1];
      const versionMatch = url.match(urlVersionPattern);
      if (versionMatch) {
        const version = versionMatch[1];
        if (version.toLowerCase() !== 'vwip') {
          issues.push({
            file: relativePath,
            check_type: 'resource_url',
            actual: version,
            expected: 'vwip',
            line_number: lineNumber
          });
        }
      }
    }
  }

  return issues;
}

async function run(): Promise<void> {
  try {
    const repoPath = getInput('repo_path');
    const repoSlug = getInput('repo_slug');

    if (!repoPath || !repoSlug) {
      throw new Error('Missing required inputs: repo_path and repo_slug');
    }

    const repoName = repoSlug.split('/')[1] || repoSlug;

    info(`Checking API version compliance for ${repoSlug}`);
    info(`Repository path: ${repoPath}`);

    const report: ComplianceReport = {
      repo_name: repoName,
      repo_slug: repoSlug,
      is_compliant: true,
      file_count: 0,
      yaml_files_checked: 0,
      feature_files_checked: 0,
      yaml_files: [],
      feature_files: []
    };

    // Check YAML files in code/API_definitions/
    const apiDefPath = path.join(repoPath, 'code', 'API_definitions');
    if (fs.existsSync(apiDefPath)) {
      const yamlFiles = await glob('**/*.{yaml,yml}', { cwd: apiDefPath, nodir: true });
      report.yaml_files_checked = yamlFiles.length;
      info(`Found ${yamlFiles.length} YAML files in code/API_definitions/`);

      for (const yamlFile of yamlFiles) {
        const fullPath = path.join(apiDefPath, yamlFile);
        const issues = checkYamlFile(fullPath, repoPath);
        report.yaml_files.push(...issues);
      }
    } else {
      info('No code/API_definitions/ directory found');
    }

    // Check feature files in code/Test_definitions/
    const testDefPath = path.join(repoPath, 'code', 'Test_definitions');
    if (fs.existsSync(testDefPath)) {
      const featureFiles = await glob('**/*.feature', { cwd: testDefPath, nodir: true });
      report.feature_files_checked = featureFiles.length;
      info(`Found ${featureFiles.length} feature files in code/Test_definitions/`);

      for (const featureFile of featureFiles) {
        const fullPath = path.join(testDefPath, featureFile);
        const issues = checkFeatureFile(fullPath, repoPath);
        report.feature_files.push(...issues);
      }
    } else {
      info('No code/Test_definitions/ directory found');
    }

    // Calculate compliance
    report.file_count = report.yaml_files.length + report.feature_files.length;
    report.is_compliant = report.file_count === 0;

    info(`Compliance check complete: ${report.is_compliant ? 'COMPLIANT' : 'NOT COMPLIANT'}`);
    if (!report.is_compliant) {
      info(`  - YAML file issues: ${report.yaml_files.length}`);
      info(`  - Feature file issues: ${report.feature_files.length}`);
    }

    // Output full JSON for Mustache templates (sanitized to avoid control character issues)
    setOutput('json', JSON.stringify(sanitizeForJson(report)));

    // Output compact summary for JSONL records
    const summary = {
      repo_slug: report.repo_slug,
      is_compliant: report.is_compliant,
      file_count: report.file_count,
      yaml_issues: report.yaml_files.length,
      feature_issues: report.feature_files.length,
      yaml_files_checked: report.yaml_files_checked,
      feature_files_checked: report.feature_files_checked
    };
    setOutput('summary', JSON.stringify(summary));

    // Output individual values for workflow conditionals
    setOutput('is_compliant', String(report.is_compliant));
    setOutput('file_count', String(report.file_count));
    setOutput('yaml_files_checked', String(report.yaml_files_checked));
    setOutput('feature_files_checked', String(report.feature_files_checked));

  } catch (err: any) {
    setFailed(err.message);
  }
}

run();
