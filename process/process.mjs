import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

const DecisionSchema = v.object({
  decision: v.picklist(['leave-open', 'close-invalid', 'close-duplicate', 'close-done']),
  comment: v.optional(v.string()),
  duplicateOf: v.optional(v.number()),
  labels: v.optional(v.array(v.string()), []),
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
const suggestedLabels = parsed.labels ?? [];

switch (parsed.decision) {
  case 'leave-open': {
    console.log(`Issue #${issueNumber}: leave-open`);
    if (parsed.comment) {
      await octokit.issues.createComment({
        owner, repo, issue_number: issueNumber,
        body: parsed.comment,
      });
    }
    if (suggestedLabels.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: suggestedLabels }).catch(() => {});
      console.log(`  Added labels: ${suggestedLabels.join(', ')}`);
    }
    if (parsed.comment) console.log(`  Commented: ${parsed.comment}`);
    break;
  }
  case 'close-invalid': {
    console.log(`Issue #${issueNumber}: close-invalid`);
    if (suggestedLabels.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: suggestedLabels }).catch(() => {});
    }
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: parsed.comment || 'This issue has been closed as invalid.',
    });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed' });
    console.log(`  Closed: ${parsed.comment}`);
    break;
  }
  case 'close-duplicate': {
    console.log(`Issue #${issueNumber}: close-duplicate of #${parsed.duplicateOf}`);
    const body = parsed.comment
      ? `${parsed.comment}\n\nDuplicate of #${parsed.duplicateOf}`
      : `Duplicate of #${parsed.duplicateOf}`;
    if (suggestedLabels.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: suggestedLabels }).catch(() => {});
    }
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed' });
    console.log(`  Closed as duplicate: ${parsed.comment}`);
    break;
  }
  case 'close-done': {
    console.log(`Issue #${issueNumber}: close-done`);
    if (suggestedLabels.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: suggestedLabels }).catch(() => {});
    }
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: parsed.comment || 'This issue appears to have already been addressed.',
    });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed' });
    console.log(`  Closed: ${parsed.comment}`);
    break;
  }
}
