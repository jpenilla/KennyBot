import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlueContext } from '@flue/sdk/client';
import { defineCommand } from '@flue/sdk/node';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

const TriageResultSchema = v.object({
  decision: v.picklist(['leave-open', 'close-invalid', 'close-duplicate', 'close-done']),
  comment: v.nullish(v.string()),
  addLabels: v.nullish(v.array(v.string()), []),
  removeLabels: v.nullish(v.array(v.string()), []),
});

// gh and git run on the host via execFile, not in the sandbox's virtual bash.
// gh needs GH_TOKEN injected; git picks up credentials from checkout's config.
// The analyze job has only `issues: read` / `contents: read`, so no writes.
const gh = defineCommand('gh', {
  env: {
    GH_TOKEN: process.env.GH_TOKEN,
  },
});
const git = defineCommand('git');

export const triggers = {};

export default async function ({ init, payload }: FlueContext) {
  // Fetch issue details and repo labels via Octokit (read-only operations).
  // Write operations are handled separately by the process job.
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) throw new Error('GH_TOKEN is required');

  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) throw new Error('GITHUB_REPOSITORY is required');
  const [owner, repo] = repoFull.split('/');

  const octokit = new Octokit({ auth: ghToken });

  const [{ data: issue }, { data: labels }] = await Promise.all([
    octokit.issues.get({
      owner,
      repo,
      issue_number: payload.issueNumber,
    }),
    octokit.issues.listLabelsForRepo({
      owner,
      repo,
    }),
  ]);

  const repoData = {
    owner,
    name: repo,
    issueLabels: labels
      .map((l) => l.description ? `- ${l.name}: ${l.description}` : `- ${l.name}`)
      .join('\n')
  }

  // Paginate all comments and write to a file so the LLM can read on demand
  const allComments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: payload.issueNumber,
    per_page: 50,
  });

  const commentData = allComments.map((c) => ({
    author: c.user?.login ?? 'unknown',
    authorAssociation: c.author_association,
    body: c.body ?? '',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  const commentsPath = path.join(process.cwd(), '.kennybot', `comments-${payload.issueNumber}.json`);
  await fs.mkdir(path.dirname(commentsPath), { recursive: true });
  await fs.writeFile(commentsPath, JSON.stringify(commentData, null, 2));

  const issueData = {
    number: payload.issueNumber,
    title: issue.title,
    author: issue.user?.login ?? 'unknown',
    authorAssociation: issue.author_association,
    body: issue.body ?? '',
    labels: issue.labels.map((l: any) => l.name ?? '').filter(Boolean),
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    commentCount: issue.comments,
    commentsFile: issue.comments > 0 ? `/workspace/.kennybot/comments-${payload.issueNumber}.json` : undefined,
  };
  
  const agent = await init({
    sandbox: 'local',
    model: payload.model,
  });
  const session = await agent.session();
  // Agent analyzes the issue and returns a structured decision.
  // The skill has read-only gh access
  const result = await session.skill('kennybot-triage', {
    args: {
      repo: repoData,
      issue: issueData,
    },
    commands: [gh, git],
    result: TriageResultSchema,
  });

  // Write result to a file if a path was provided. The action reads this file
  // instead of parsing flue's stdout, which contains build progress interleaved.
  if (payload._resultPath) {
    await fs.writeFile(payload._resultPath, JSON.stringify(result));
  }

  return result;
}
