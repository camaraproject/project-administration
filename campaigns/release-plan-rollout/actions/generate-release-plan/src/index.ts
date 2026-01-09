import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Mustache from 'mustache';

function getInput(name: string): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '';
}

function setOutput(name: string, value: string): void {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    fs.appendFileSync(output, `${name}=${value}\n`, 'utf8');
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

interface API {
  api_name: string;
  file_name: string;
  api_version: string;
  api_title: string;
  commonalities: string | null;
}

interface Release {
  repository: string;
  release_tag: string;
  release_date: string;
  release_type?: string;
  meta_release: string;
  github_url: string;
  apis: API[];
}

interface RepositoryInfo {
  repository: string;
  github_url: string;
  latest_public_release: string | null;
  newest_pre_release: string | null;
}

interface ReleasesData {
  metadata?: any;
  repositories?: RepositoryInfo[];
  releases: Release[];
}

interface APIEntry {
  api_name: string;
  target_api_version: string;
  target_api_status: string;
  main_contacts: string[];
}

/**
 * Derive API status from version string
 */
function deriveApiStatus(version: string | undefined | null): string {
  if (!version) return 'draft';
  if (version.includes('-alpha')) return 'alpha';
  if (version.includes('-rc')) return 'rc';
  return 'public';
}

/**
 * Extract base version (remove pre-release suffixes)
 */
function extractBaseVersion(version: string | undefined | null): string {
  if (!version) return '0.1.0';
  return version.split('-')[0];
}

/**
 * Generate YAML string for an API entry
 */
function generateApiEntry(api: APIEntry): string {
  let entry = `  - api_name: ${api.api_name}\n`;
  entry += `    target_api_version: ${api.target_api_version}\n`;
  entry += `    target_api_status: ${api.target_api_status}\n`;
  entry += `    main_contacts:\n`;
  for (const contact of api.main_contacts) {
    entry += `      - ${contact}\n`;
  }
  return entry;
}

(async () => {
  try {
    const releasesFile = getInput('releases_file');
    const repoSlug = getInput('repo_slug');
    const outFile = getInput('out_file');
    const templatesDir = getInput('templates_dir');
    const codeownersStr = getInput('codeowners');

    if (!releasesFile || !repoSlug || !outFile || !templatesDir) {
      throw new Error('Missing required inputs: releases_file, repo_slug, out_file, templates_dir');
    }

    const repoName = repoSlug.split('/')[1];
    const codeowners = codeownersStr ? codeownersStr.split(',').map(s => s.trim()).filter(s => s) : [];

    if (!fs.existsSync(releasesFile)) {
      throw new Error(`Releases file not found: ${releasesFile}`);
    }

    const doc = yaml.load(fs.readFileSync(releasesFile, 'utf8')) as ReleasesData;

    if (!doc || !doc.releases) {
      throw new Error(`Invalid releases-master.yaml structure`);
    }

    // Look up repository in repositories array
    const repoInfo = doc.repositories?.find(r => r.repository === repoName);
    let targetReleaseTag: string | null = null;

    if (repoInfo) {
      targetReleaseTag = repoInfo.newest_pre_release || repoInfo.latest_public_release;
      info(`Repository info found: newest_pre_release=${repoInfo.newest_pre_release}, latest_public_release=${repoInfo.latest_public_release}`);
    }

    // Find the target release
    let targetRelease: Release | null = null;
    if (targetReleaseTag) {
      targetRelease = doc.releases.find(
        r => r.repository === repoName && r.release_tag === targetReleaseTag
      ) || null;
    }

    // Determine which case we're in
    const hasReleases = targetRelease !== null;
    const templateFile = hasReleases
      ? 'release-plan-with-releases.mustache'
      : 'release-plan-no-releases.mustache';
    const prBodyTemplate = hasReleases
      ? 'pr-body-with-releases.mustache'
      : 'pr-body-no-releases.mustache';

    // Load template
    const templatePath = path.join(templatesDir, templateFile);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    const template = fs.readFileSync(templatePath, 'utf8');

    let yamlContent: string;
    let jsonPayload: any;

    if (hasReleases) {
      // Case 1: Repository WITH releases
      const release = targetRelease!;
      const releaseTrack = release.meta_release && !release.meta_release.includes('Sandbox')
        ? 'meta-release'
        : 'independent';

      // Template data
      const templateData = {
        release_track: releaseTrack,
        meta_release: releaseTrack === 'meta-release' ? release.meta_release : null,
        target_release_tag: release.release_tag
      };

      // Render header with Mustache
      yamlContent = Mustache.render(template, templateData);

      // Append API entries
      for (const api of release.apis) {
        const apiEntry: APIEntry = {
          api_name: api.api_name,
          target_api_version: extractBaseVersion(api.api_version),
          target_api_status: deriveApiStatus(api.api_version),
          main_contacts: codeowners.length > 0 ? codeowners : ['CODEOWNER']
        };
        yamlContent += generateApiEntry(apiEntry);
      }

      jsonPayload = {
        target_release_tag: release.release_tag,
        meta_release: releaseTrack === 'meta-release' ? release.meta_release : null,
        apis: release.apis.map(a => a.api_name)
      };

      info(`Generated release-plan.yaml for ${repoName}`);
      info(`  Release tag: ${release.release_tag}`);
      info(`  APIs: ${release.apis.length}`);
      info(`  Codeowners: ${codeowners.length}`);

    } else {
      // Case 2: Repository WITHOUT releases
      warning(`No releases found for repository: ${repoName}`);

      // Render header with Mustache (no dynamic data needed)
      yamlContent = Mustache.render(template, {});

      // Append example API entry
      const apiEntry: APIEntry = {
        api_name: 'example-api',
        target_api_version: '0.1.0',
        target_api_status: 'draft',
        main_contacts: codeowners.length > 0 ? codeowners : ['CODEOWNER']
      };
      yamlContent += generateApiEntry(apiEntry);

      jsonPayload = {
        target_release_tag: 'r1.1',
        apis: ['example-api'],
        warning: 'no_releases',
        warning_message: 'Repository has no releases. Update example-api with your actual API name.'
      };

      info(`Generated placeholder release-plan.yaml for ${repoName}`);
      info(`  Codeowners: ${codeowners.length}`);
    }

    // Write output file
    fs.writeFileSync(outFile, yamlContent, 'utf8');

    // Set outputs
    setOutput('json', JSON.stringify(jsonPayload));
    setOutput('generated', 'true');
    setOutput('pr_body_template', prBodyTemplate);

  } catch (err: any) {
    setOutput('generated', 'false');
    setFailed(err.message);
  }
})();
