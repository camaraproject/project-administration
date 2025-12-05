const fs = require('fs');

// Get environment variables
const repo = process.env.INPUT_REPO || '';
const mode = process.env.INPUT_MODE || 'plan';
const shouldCreateIssue = process.env.INPUT_SHOULD_CREATE_ISSUE === 'true';
const campaignDataRaw = process.env.INPUT_CAMPAIGN_DATA || '{}';
const action = process.env.INPUT_ACTION || 'skip';
const reason = process.env.INPUT_REASON || 'unknown';
const existingIssueNumber = process.env.INPUT_EXISTING_ISSUE_NUMBER || '';
const existingIssueUrl = process.env.INPUT_EXISTING_ISSUE_URL || '';
const createdIssueNumber = process.env.INPUT_CREATED_ISSUE_NUMBER || '';
const createdIssueUrl = process.env.INPUT_CREATED_ISSUE_URL || '';

// Parse campaign data
let campaignData = {};
try {
  campaignData = JSON.parse(campaignDataRaw);
} catch (e) {
  console.log('Warning: Could not parse campaign_data JSON');
}

// Build JSONL record
const record = {
  repo,
  ...campaignData,
  timestamp: new Date().toISOString()
};

// Add action-specific fields
if (reason === 'compliant') {
  record.status = 'compliant';
  record.issue_action = 'none';
} else if (reason === 'issue_exists') {
  record.status = 'issue_exists';
  record.issue_action = 'skipped';
  record.existing_issue_number = parseInt(existingIssueNumber, 10) || null;
  record.existing_issue_url = existingIssueUrl || null;
} else if (reason === 'new_issue') {
  if (mode === 'plan') {
    record.status = 'would_create';
    record.issue_action = 'would_create';
  } else {
    record.status = 'created';
    record.issue_action = 'created';
    record.issue_number = parseInt(createdIssueNumber, 10) || null;
    record.issue_url = createdIssueUrl || null;
  }
}

// Build markdown summary
const outputName = mode === 'plan' ? 'plan' : 'results';
let markdown = `### ${repo}\n`;

// Status messages
const statusMessages = {
  'compliant': 'Repository is compliant (no issue needed)',
  'issue_exists': `Issue already exists (#${existingIssueNumber})`,
  'would_create': 'Would create issue',
  'created': `Issue created (#${createdIssueNumber})`
};

const statusMsg = statusMessages[record.status] || record.status;

if (mode === 'plan') {
  if (reason === 'compliant') {
    markdown += `- Skip (compliant)\n`;
  } else if (reason === 'issue_exists') {
    markdown += `- Skip (issue exists: [#${existingIssueNumber}](${existingIssueUrl}))\n`;
  } else {
    markdown += `- WOULD create issue\n`;
  }
} else {
  if (reason === 'compliant') {
    markdown += `- Skip (compliant)\n`;
  } else if (reason === 'issue_exists') {
    markdown += `- Skip (issue exists: [#${existingIssueNumber}](${existingIssueUrl}))\n`;
  } else {
    markdown += `- Issue created: [#${createdIssueNumber}](${createdIssueUrl})\n`;
  }
}

// Add campaign-specific fields to markdown
for (const [key, value] of Object.entries(campaignData)) {
  if (key !== 'repo_slug' && key !== 'repo_name') {
    markdown += `- ${key}: ${value}\n`;
  }
}

markdown += '\n';

// Write files
fs.writeFileSync(`${outputName}.jsonl`, JSON.stringify(record) + '\n');
fs.writeFileSync(`${outputName}.md`, markdown);

console.log(`Recorded outcome for ${repo}:`);
console.log(`  Status: ${record.status}`);
console.log(`  Action: ${record.issue_action}`);
if (record.issue_number) {
  console.log(`  Issue: #${record.issue_number}`);
}
