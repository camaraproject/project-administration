const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function getInput(name) {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '';
}

function setOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
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

function setFailed(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function info(message) {
  console.log(message);
}

function sanitizeForJson(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJson);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = sanitizeForJson(obj[key]);
    }
    return result;
  }
  return obj;
}

function walkFiles(dirPath, extensions) {
  if (!fs.existsSync(dirPath)) return [];

  const results = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dirPath);
  return results;
}

function severityName(value) {
  switch (value) {
    case 0:
      return 'error';
    case 1:
      return 'warning';
    case 2:
      return 'info';
    default:
      return 'hint';
  }
}

function escapeForMarkdown(text) {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .trim();
}

function toJsonPath(parts) {
  if (!parts || parts.length === 0) return '$';

  let out = '$';
  for (const part of parts) {
    if (typeof part === 'number') {
      out += `[${part}]`;
      continue;
    }

    const safe = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(part);
    if (safe) {
      out += `.${part}`;
    } else {
      const escaped = String(part).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      out += `["${escaped}"]`;
    }
  }
  return out;
}

function relativeToRepo(filePath, repoPath) {
  if (!filePath) return '';
  const normalizedRepo = path.resolve(repoPath);
  const normalizedSource = path.resolve(filePath);

  if (normalizedSource.startsWith(normalizedRepo)) {
    return path.relative(normalizedRepo, normalizedSource).replace(/\\/g, '/');
  }

  return filePath.replace(/\\/g, '/');
}

function buildRulesetYaml() {
  return [
    'extends: ["https://unpkg.com/@stoplight/spectral-owasp-ruleset/dist/ruleset.mjs"]',
    'rules:',
    '  owasp:api2:2023-auth-insecure-schemes : off',
    '  owasp:api2:2023-jwt-best-practices : off',
    '  owasp:api2:2023-no-http-basic : off',
    '  owasp:api4:2023-integer-limit : off',
    '  owasp:api4:2023-rate-limit : off',
    '  owasp:api4:2023-rate-limit-retry-after : off',
    '  owasp:api4:2023-rate-limit-responses-429 : off',
    '  owasp:api8:2023-define-cors-origin : off',
    '  owasp:api8:2023-define-error-responses-500 : off',
    '  owasp:api9:2023-inventory-access : off',
    '  owasp:api9:2023-inventory-environment : off',
    '  owasp:api8:2023-define-error-responses-401 : error',
    '  owasp:api4:2023-string-limit : warn',
    '  owasp:api4:2023-integer-format: warn',
    '  owasp:api4:2023-integer-limit-legacy: warn',
    '  owasp:api4:2023-array-limit : warn'
  ].join('\n');
}

const API4_TARGET_RULES = new Set([
  'owasp:api4:2023-array-limit',
  'owasp:api4:2023-integer-format',
  'owasp:api4:2023-integer-limit-legacy',
  'owasp:api4:2023-string-limit',
  'owasp:api4:2023-string-restricted'
]);

const RULE_GUIDANCE = {
  'owasp:api4:2023-string-limit': 'For string schemas, add `maxLength`, `enum`, or `const` to bound input size.',
  'owasp:api4:2023-string-restricted': 'Add `format`, `pattern`, `enum`, or `const` to restrict accepted string values.',
  'owasp:api4:2023-integer-format': 'For integer schemas, set `format` to `int32` or `int64`.',
  'owasp:api4:2023-integer-limit-legacy': 'For integer schemas, define both `minimum` and `maximum` limits.',
  'owasp:api4:2023-array-limit': 'For array schemas, define `maxItems` and ensure nested item schemas are constrained.',
  'owasp:api8:2023-no-scheme-http': 'Ensure server schemes use only `https` or `wss`.',
  'owasp:api8:2023-no-server-http': 'Replace `http://` server URLs with `https://` or `wss://`.',
  'owasp:api8:2023-define-error-responses-401': 'Define a documented `401` response schema for unauthorized access.'
};

function defaultGuidance(rule) {
  return `Align schemas and operations impacted by \`${rule}\` with the CAMARA OWASP linting guidance in Commonalities.`;
}

function normalizeRuleProfile(profileRaw) {
  return profileRaw === 'full-camara-owasp' ? 'full-camara-owasp' : 'api4-target';
}

function run() {
  try {
    const repoPathInput = getInput('repo_path');
    const repoSlug = getInput('repo_slug');
    const ruleProfile = normalizeRuleProfile(getInput('rule_profile').trim());

    if (!repoPathInput || !repoSlug) {
      throw new Error('Missing required inputs: repo_path and repo_slug');
    }

    const repoPath = path.resolve(repoPathInput);
    const repoName = repoSlug.split('/')[1] || repoSlug;

    info(`Checking OWASP compliance for ${repoSlug}`);
    info(`Rule profile: ${ruleProfile}`);

    const apiDir = path.join(repoPath, 'code', 'API_definitions');
    const apiFiles = walkFiles(apiDir, new Set(['.yaml', '.yml']));

    info(`OpenAPI files found: ${apiFiles.length}`);

    if (apiFiles.length === 0) {
      const report = {
        repo_name: repoName,
        repo_slug: repoSlug,
        rule_profile: ruleProfile,
        has_findings: false,
        finding_count: 0,
        error_count: 0,
        warning_count: 0,
        info_count: 0,
        hint_count: 0,
        files_checked: 0,
        checked_files: [],
        rules_summary: [],
        findings: [],
        formatted_rules_summary: 'No OWASP findings detected.',
        formatted_findings: 'No OWASP findings detected.',
        formatted_fix_guidance: 'No OWASP findings detected.'
      };

      const summary = {
        repo_slug: repoSlug,
        rule_profile: ruleProfile,
        has_findings: false,
        finding_count: 0,
        error_count: 0,
        warning_count: 0,
        files_checked: 0,
        rules_triggered: 0
      };

      setOutput('json', JSON.stringify(report));
      setOutput('summary', JSON.stringify(summary));
      setOutput('has_findings', 'false');
      setOutput('finding_count', '0');
      setOutput('error_count', '0');
      setOutput('warning_count', '0');
      setOutput('files_checked', '0');
      return;
    }

    const rulesetPath = path.join(os.tmpdir(), `spectral-owasp-camara-${Date.now()}.yaml`);
    fs.writeFileSync(rulesetPath, buildRulesetYaml(), 'utf8');

    const spectral = spawnSync(
      'spectral',
      ['lint', '--format', 'json', '--ruleset', rulesetPath, ...apiFiles],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 25,
        cwd: process.cwd()
      }
    );

    try {
      fs.unlinkSync(rulesetPath);
    } catch (_e) {
      // ignore
    }

    if (spectral.error) {
      if (spectral.error.code === 'ENOENT') {
        throw new Error('Spectral CLI not found in PATH. Install @stoplight/spectral-cli before running this action.');
      }
      throw spectral.error;
    }

    if (spectral.status !== 0 && spectral.status !== 1) {
      const stderr = (spectral.stderr || '').trim();
      throw new Error(`Spectral failed with exit code ${spectral.status}. ${stderr}`.trim());
    }

    const rawStdout = (spectral.stdout || '').trim();
    const parsed = rawStdout ? JSON.parse(rawStdout) : [];

    const findings = [];

    for (const item of parsed) {
      const rule = String(item.code || 'unknown');
      if (ruleProfile === 'api4-target' && !API4_TARGET_RULES.has(rule)) {
        continue;
      }

      const sev = severityName(item.severity);
      const line = typeof item.range?.start?.line === 'number' ? item.range.start.line + 1 : 1;
      const column = typeof item.range?.start?.character === 'number' ? item.range.start.character + 1 : 1;
      const source = relativeToRepo(item.source || '', repoPath);
      const message = String(item.message || 'No message provided').replace(/\s+/g, ' ').trim();

      findings.push({
        source,
        line,
        column,
        rule,
        severity: sev,
        message,
        message_md: escapeForMarkdown(message),
        json_path: toJsonPath(item.path)
      });
    }

    findings.sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.line !== b.line) return a.line - b.line;
      if (a.column !== b.column) return a.column - b.column;
      return a.rule.localeCompare(b.rule);
    });

    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let hintCount = 0;

    const rules = new Map();

    for (const finding of findings) {
      if (finding.severity === 'error') errorCount += 1;
      else if (finding.severity === 'warning') warningCount += 1;
      else if (finding.severity === 'info') infoCount += 1;
      else hintCount += 1;

      const current = rules.get(finding.rule);
      if (!current) {
        rules.set(finding.rule, { count: 1, severity: finding.severity });
      } else {
        current.count += 1;
      }
    }

    const rulesSummary = Array.from(rules.entries())
      .map(([rule, value]) => ({ rule, count: value.count, severity: value.severity }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.rule.localeCompare(b.rule);
      });

    const formattedRulesSummary = rulesSummary.length > 0
      ? rulesSummary.map((r) => `- \`${r.rule}\`: ${r.count} finding(s), severity \`${r.severity}\``).join('\n')
      : 'No OWASP findings detected.';

    const formattedFindings = findings.length > 0
      ? findings
        .map((f) => `- \`${f.source}:${f.line}\` \`${f.rule}\` (\`${f.severity}\`) at \`${f.json_path}\` - ${f.message_md}`)
        .join('\n')
      : 'No OWASP findings detected.';

    const triggeredRules = rulesSummary.map((r) => r.rule);
    const formattedFixGuidance = triggeredRules.length > 0
      ? triggeredRules
        .map((rule) => `- \`${rule}\`: ${RULE_GUIDANCE[rule] || defaultGuidance(rule)}`)
        .join('\n')
      : 'No OWASP findings detected.';

    const report = {
      repo_name: repoName,
      repo_slug: repoSlug,
      rule_profile: ruleProfile,
      has_findings: findings.length > 0,
      finding_count: findings.length,
      error_count: errorCount,
      warning_count: warningCount,
      info_count: infoCount,
      hint_count: hintCount,
      files_checked: apiFiles.length,
      checked_files: apiFiles.map((f) => relativeToRepo(f, repoPath)),
      rules_summary: rulesSummary,
      findings,
      formatted_rules_summary: formattedRulesSummary,
      formatted_findings: formattedFindings,
      formatted_fix_guidance: formattedFixGuidance
    };

    const summary = {
      repo_slug: repoSlug,
      rule_profile: ruleProfile,
      has_findings: findings.length > 0,
      finding_count: findings.length,
      error_count: errorCount,
      warning_count: warningCount,
      files_checked: apiFiles.length,
      rules_triggered: rulesSummary.length
    };

    setOutput('json', JSON.stringify(sanitizeForJson(report)));
    setOutput('summary', JSON.stringify(sanitizeForJson(summary)));
    setOutput('has_findings', findings.length > 0 ? 'true' : 'false');
    setOutput('finding_count', String(findings.length));
    setOutput('error_count', String(errorCount));
    setOutput('warning_count', String(warningCount));
    setOutput('files_checked', String(apiFiles.length));

    info(`OWASP compliance check complete for ${repoSlug}: ${findings.length > 0 ? 'FINDINGS DETECTED' : 'COMPLIANT'}`);
  } catch (err) {
    setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
