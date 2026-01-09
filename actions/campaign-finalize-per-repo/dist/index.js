const fs = require('fs');
const path = require('path');

function getInput(name) {
  return process.env[`INPUT_${name.toUpperCase()}`] || '';
}

try {
  const repo = getInput('repo');
  const changed = getInput('changed') === 'true';
  const mode = getInput('mode');
  const campaignDataStr = getInput('campaign_data') || '{}';
  const prStatus = getInput('pr_status');
  const prNumber = getInput('pr_number');
  const prUrl = getInput('pr_url');
  const changeReason = getInput('change_reason');
  const errorOccurred = getInput('error_occurred') === 'true';
  const errorMessage = getInput('error_message');
  const errorStep = getInput('error_step');

  const campaignData = JSON.parse(campaignDataStr);

  // Determine file names based on mode
  const outputName = mode === 'plan' ? 'plan' : 'results';

  // Build JSONL record
  const record = {
    repo,
    ...campaignData,
    timestamp: new Date().toISOString()
  };

  // Add error fields if error occurred
  if (errorOccurred) {
    record.error = true;
    record.error_message = errorMessage;
    record.error_step = errorStep;
    record.status = 'error';
  } else {
    record.pr_would_be_created = changed && prStatus === 'will_create';
    record.reason = changeReason || (changed ? 'content_changed' : 'noop');

    // Add PR fields if provided (but not for main_up_to_date - old PR is misleading)
    if (prStatus) {
      record.pr_status = prStatus;
    }
    if (prNumber && changeReason !== 'main_up_to_date') {
      record.pr_number = parseInt(prNumber, 10);
    }
    if (prUrl && changeReason !== 'main_up_to_date') {
      record.pr_url = prUrl;
    }
  }

  const jsonlLine = JSON.stringify(record) + '\n';
  fs.writeFileSync(path.join(process.env.GITHUB_WORKSPACE, `${outputName}.jsonl`), jsonlLine);

  // Build markdown summary
  const lines = [`### ${repo}`];

  // Handle error case
  if (errorOccurred) {
    lines.push(`- ERROR: ${errorMessage}`);
    lines.push(`- Failed at step: ${errorStep}`);
    lines.push(`- Status: Skipped`);
  } else {
    // Status line
    if (prStatus) {
      const statusMessages = {
        'will_create': 'New PR would be created',
        'no_change': changeReason === 'existing_pr' && prNumber
          ? `Skipped - existing PR #${prNumber}`
          : changeReason === 'main_up_to_date'
            ? 'No changes needed'
            : 'No changes needed'
      };
      const reasonMessages = {
        'main_up_to_date': 'main already up-to-date',
        'existing_pr': 'PR already exists',
        'new_changes': 'new changes detected'
      };
      const action = changed ? 'WOULD apply' : 'skip';
      lines.push(`- ${action}`);
      lines.push(`- PR status: ${statusMessages[prStatus]}`);
      if (changeReason) {
        lines.push(`- Reason: ${reasonMessages[changeReason] || changeReason}`);
      }
    } else {
      lines.push(changed ? '- WOULD apply (PR would be created)' : '- skip (no changes)');
    }

    // Add PR URL if available (show for existing_pr, new_changes; hide for main_up_to_date)
    if (prUrl && changeReason !== 'main_up_to_date') {
      lines.push(`- PR URL: ${prUrl}`);
    }
  }

  // Add campaign-specific fields
  for (const [key, value] of Object.entries(campaignData)) {
    lines.push(`- ${key}: ${value !== null && value !== undefined ? value : 'N/A'}`);
  }

  const md = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(process.env.GITHUB_WORKSPACE, `${outputName}.md`), md);

  console.log(`Recorded outcome to ${outputName}.jsonl and ${outputName}.md`);
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}
