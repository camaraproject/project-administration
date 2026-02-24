import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as semver from 'semver';

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
  meta_release: string;
  github_url: string;
  release_type?: string;
  repository_archived?: boolean;
  apis: API[];
}

interface Repository {
  repository: string;
  github_url: string;
  latest_public_release: string | null;
  newest_pre_release: string | null;
  repository_archived?: boolean;
}

interface ReleasesData {
  metadata?: any;
  releases: Release[];
  repositories?: Repository[];
}

type ReleaseState = 'no_release' | 'prerelease_only' | 'public_release' | 'public_with_prerelease';

function sortReleasesBySemver(releases: Release[]): Release[] {
  return [...releases].sort((a, b) => {
    try {
      const aVer = a.release_tag.startsWith('r')
        ? a.release_tag.substring(1)
        : a.release_tag;
      const bVer = b.release_tag.startsWith('r')
        ? b.release_tag.substring(1)
        : b.release_tag;

      const aVersions = aVer.split('.');
      const bVersions = bVer.split('.');
      const aSemver = aVersions.length === 2 ? `${aVer}.0` : aVer;
      const bSemver = bVersions.length === 2 ? `${bVer}.0` : bVer;

      return semver.compare(bSemver, aSemver); // Descending order
    } catch (err) {
      return b.release_tag.localeCompare(a.release_tag);
    }
  });
}

function determineReleaseState(
  latestPublicRelease: string | null,
  newestPreRelease: string | null
): ReleaseState {
  if (!latestPublicRelease && !newestPreRelease) {
    return 'no_release';
  } else if (!latestPublicRelease && newestPreRelease) {
    return 'prerelease_only';
  } else if (latestPublicRelease && !newestPreRelease) {
    return 'public_release';
  } else {
    return 'public_with_prerelease';
  }
}

function getPrereleaseType(releaseType?: string): string {
  if (!releaseType) return 'pre-release';
  if (releaseType.includes('alpha')) return 'alpha';
  if (releaseType.includes('beta')) return 'beta';
  if (releaseType.includes('rc')) return 'rc';
  return 'pre-release';
}

(async () => {
  try {
    const releasesFile = getInput('releases_file');
    const repoSlug = getInput('repo_slug');

    if (!releasesFile || !repoSlug) {
      throw new Error('Missing required inputs: releases_file and repo_slug');
    }

    const repoName = repoSlug.split('/')[1];

    if (!fs.existsSync(releasesFile)) {
      throw new Error(`Releases file not found: ${releasesFile}`);
    }

    const doc = yaml.load(fs.readFileSync(releasesFile, 'utf8')) as ReleasesData;

    if (!doc || !doc.releases) {
      throw new Error(`Invalid releases-master.yaml structure`);
    }

    // Look up repository in the repositories section for release state info
    const repoEntry = doc.repositories?.find(r => r.repository === repoName);
    const latestPublicReleaseTag = repoEntry?.latest_public_release || null;
    const newestPreReleaseTag = repoEntry?.newest_pre_release || null;

    // Determine release state
    const releaseState = determineReleaseState(latestPublicReleaseTag, newestPreReleaseTag);

    info(`Repository ${repoName}: release_state=${releaseState}, public=${latestPublicReleaseTag}, pre=${newestPreReleaseTag}`);

    // Handle no_release case
    if (releaseState === 'no_release') {
      const payload = {
        repo_name: repoName,
        release_state: releaseState,
        is_no_release: true,
        is_prerelease_only: false,
        is_public_release: false,
        is_public_with_prerelease: false,
        latest_public_release: null,
        release_date: null,
        meta_release: null,
        github_url: null,
        apis: [],
        newest_prerelease: null,
        prerelease_date: null,
        prerelease_meta: null,
        prerelease_github_url: null,
        prerelease_type: null,
        prerelease_apis: []
      };

      setOutput('json', JSON.stringify(payload));
      setOutput('summary', JSON.stringify({
        release_state: releaseState,
        latest_public_release: null,
        newest_prerelease: null,
        api_count: 0
      }));
      info(`No releases found for ${repoName}`);
      return;
    }

    // Get all releases for this repository
    const repoReleases = doc.releases.filter(
      (r: Release) => r.repository === repoName
    );

    // Find public release details (if exists)
    let publicReleaseData: Release | null = null;
    if (latestPublicReleaseTag) {
      publicReleaseData = repoReleases.find(r => r.release_tag === latestPublicReleaseTag) || null;
    }

    // Find pre-release details (if exists)
    let preReleaseData: Release | null = null;
    if (newestPreReleaseTag) {
      preReleaseData = repoReleases.find(r => r.release_tag === newestPreReleaseTag) || null;
    }

    // Build the payload - use string comparison with as const to avoid TypeScript narrowing issues
    const state: string = releaseState;
    const payload: any = {
      repo_name: repoName,
      release_state: releaseState,
      is_no_release: state === 'no_release',
      is_prerelease_only: state === 'prerelease_only',
      is_public_release: state === 'public_release',
      is_public_with_prerelease: state === 'public_with_prerelease',
      // Public release fields
      latest_public_release: publicReleaseData?.release_tag || null,
      release_date: publicReleaseData?.release_date || null,
      meta_release: publicReleaseData?.meta_release || null,
      github_url: publicReleaseData?.github_url || null,
      apis: publicReleaseData?.apis?.map(api => ({
        api_name: api.api_name,
        file_name: api.file_name,
        version: api.api_version,
        title: api.api_title,
        commonalities: api.commonalities
      })) || [],
      // Pre-release fields
      newest_prerelease: preReleaseData?.release_tag || null,
      prerelease_date: preReleaseData?.release_date || null,
      prerelease_meta: preReleaseData?.meta_release || null,
      prerelease_github_url: preReleaseData?.github_url || null,
      prerelease_type: preReleaseData ? getPrereleaseType(preReleaseData.release_type) : null,
      prerelease_apis: preReleaseData?.apis?.map(api => ({
        api_name: api.api_name,
        file_name: api.file_name,
        version: api.api_version,
        title: api.api_title,
        commonalities: api.commonalities
      })) || []
    };

    // Output full JSON for Mustache templating
    setOutput('json', JSON.stringify(payload));

    // Output summary for plan reporting
    setOutput('summary', JSON.stringify({
      release_state: releaseState,
      latest_public_release: payload.latest_public_release,
      newest_prerelease: payload.newest_prerelease,
      api_count: payload.apis.length + payload.prerelease_apis.length
    }));

    info(`Found ${releaseState}: public=${payload.latest_public_release}, pre=${payload.newest_prerelease}`);

  } catch (err: any) {
    setFailed(err.message);
  }
})();
