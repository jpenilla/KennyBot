import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

const DecisionSchema = v.object({
  decision: v.picklist(['leave-open', 'close-invalid', 'close-duplicate', 'close-done']),
  comment: v.nullish(v.string()),
  addLabels: v.nullish(v.array(v.string()), []),
  removeLabels: v.nullish(v.array(v.string()), []),
});

const ghToken = process.env.GH_TOKEN;
if (!ghToken) throw new Error('GH_TOKEN is required');

const repoFull = process.env.GITHUB_REPOSITORY;
if (!repoFull) throw new Error('GITHUB_REPOSITORY is required');
const [owner, repo] = repoFull.split('/');

const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
if (isNaN(issueNumber)) throw new Error('ISSUE_NUMBER is required');

const raw = JSON.parse(process.env.DECISION || '{}');
const parsed = v.parse(DecisionSchema, raw);

const octokit = new Octokit({ auth: ghToken });

// Narrow race window: if the issue is already closed, bail before any write ops.
const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
if (issue.state === 'closed') {
  console.log(`Issue #${issueNumber} is already closed — skipping all write operations.`);
  process.exit(0);
}

async function applyLabelChanges() {
  // If a label appears in both add and remove, skip it entirely — this is likely a
  // contradiction in the model output and we shouldn't act on it
  const addSet = new Set(parsed.addLabels);
  const removeSet = new Set(parsed.removeLabels);
  const toAdd = parsed.addLabels.filter(l => !removeSet.has(l));
  const toRemove = parsed.removeLabels.filter(l => !addSet.has(l));
  if (toRemove.length > 0) {
    await Promise.allSettled(
      toRemove.map(label =>
        octokit.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label })
      )
    );
    console.log(`  Removed labels: ${toRemove.join(', ')}`);
  }
  if (toAdd.length > 0) {
    await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: toAdd }).catch(() => {});
    console.log(`  Added labels: ${toAdd.join(', ')}`);
  }
}

switch (parsed.decision) {
  case 'leave-open': {
    console.log(`Issue #${issueNumber}: leave-open`);
    await applyLabelChanges();
    if (parsed.comment) {
      await octokit.issues.createComment({
        owner, repo, issue_number: issueNumber,
        body: parsed.comment,
      });
      console.log(`  Commented: ${parsed.comment}`);
    }
    break;
  }
  case 'close-invalid': {
    console.log(`Issue #${issueNumber}: close-invalid`);
    await applyLabelChanges();
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: parsed.comment || 'This issue has been closed as invalid.',
    });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed', state_reason: 'not_planned' });
    console.log(`  Closed: ${parsed.comment}`);
    break;
  }
  case 'close-duplicate': {
    console.log(`Issue #${issueNumber}: close-duplicate`);
    const body = parsed.comment || 'This is a duplicate of another issue.';
    await applyLabelChanges();
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed', state_reason: 'duplicate' });
    console.log(`  Closed as duplicate: ${parsed.comment}`);
    break;
  }
  case 'close-done': {
    console.log(`Issue #${issueNumber}: close-done`);
    await applyLabelChanges();
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: parsed.comment || 'This issue appears to have already been addressed.',
    });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed', state_reason: 'completed' });
    console.log(`  Closed: ${parsed.comment}`);
    break;
  }
}

// Remove the trigger label if configured (e.g. label-triggered manual triage).
// This runs regardless of decision type, after all other mutations.
const triggerLabel = process.env.TRIGGER_LABEL;
if (triggerLabel) {
  await octokit.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: triggerLabel }).catch(() => {});
  console.log(`  Removed trigger label: ${triggerLabel}`);
}
