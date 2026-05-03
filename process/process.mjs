import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

const DecisionSchema = v.object({
  decision: v.picklist(['valid', 'needs-info', 'close-invalid', 'close-duplicate', 'close-done']),
  comment: v.optional(v.string()),
  duplicateOf: v.optional(v.number()),
  tags: v.optional(v.array(v.string()), []),
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
const tags = parsed.tags ?? [];

switch (parsed.decision) {
  case 'valid': {
    console.log(`Issue #${issueNumber}: valid`);
    if (tags.length > 0) {
      await octokit.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: tags,
      });
      console.log(`  Added labels: ${tags.join(', ')}`);
    }
    break;
  }
  case 'needs-info': {
    console.log(`Issue #${issueNumber}: needs more info`);
    if (tags.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: tags }).catch(() => {});
    }
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: parsed.comment || 'Could you please provide more information about this issue?',
    });
    // Leave open — author can respond with the missing details.
    console.log(`  Commented, left open: ${parsed.comment}`);
    break;
  }
  case 'close-invalid': {
    console.log(`Issue #${issueNumber}: close-invalid`);
    if (tags.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: tags }).catch(() => {});
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
    if (tags.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: tags }).catch(() => {});
    }
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed' });
    console.log(`  Closed as duplicate: ${parsed.comment}`);
    break;
  }
  case 'close-done': {
    console.log(`Issue #${issueNumber}: close-done`);
    if (tags.length > 0) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: tags }).catch(() => {});
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
