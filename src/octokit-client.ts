import { getOctokit } from '@actions/github';
import { execSync } from 'child_process';

export interface RepoCoords {
  owner: string;
  repo: string;
}

export interface RunQueryParams {
  branch: string;
  status?: 'completed' | 'in_progress' | 'queued' | 'requested';
  limit?: number;
  skip?: number;
}

interface ArtifactRecord {
  id: number;
  name: string;
}

interface CommentRecord {
  id: number;
  body: string;
}

interface ApiError extends Error {
  status?: number;
  response?: { data?: { message?: string } };
}

function abbreviateSha(sha: string): string {
  return sha.substring(0, 10);
}

export class ActionsClient {
  private octokit: any;
  private coords: RepoCoords;

  constructor(token: string) {
    this.octokit = getOctokit(token);

    const { context } = require('@actions/github');
    this.coords = {
      owner: context.repo.owner,
      repo: context.repo.repo,
    };

    console.log(
      `ActionsClient initialized for: ${this.coords.owner}/${this.coords.repo}`,
    );
  }

  getCurrentCommitHash(): string {
    return execSync('git rev-parse --short=10 HEAD', {
      encoding: 'utf8',
    }).trim();
  }

  async resolveTargetBranch(
    dispatchOverride: string,
    configuredBranch: string,
  ): Promise<string> {
    const explicit = dispatchOverride || configuredBranch;
    if (explicit) return explicit;

    const { owner, repo } = this.coords;
    try {
      const res = await this.octokit.rest.repos.get({ owner, repo });
      const branch = res.data?.default_branch;
      if (!branch) throw new Error('Repository default branch unavailable');
      return branch;
    } catch (err) {
      const e = err as ApiError;
      console.warn(
        `Could not fetch default branch: ${e.message}. Defaulting to main.`,
      );
      return 'main';
    }
  }

  async listCompletedRuns(params: RunQueryParams) {
    const { owner, repo } = this.coords;
    const res = await this.octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      branch: params.branch,
      status: params.status || 'completed',
      per_page: (params.limit || 10) + (params.skip || 0),
    });
    return res.data;
  }

  async commitHasArtifacts(sha: string, branch?: string): Promise<boolean> {
    try {
      const runs = await this.findAllRunsForCommit(sha, 'completed', branch);
      for (const run of runs) {
        try {
          const arts = await this.listRunArtifacts(run.id);
          if (arts.artifacts?.length > 0) return true;
        } catch {
          continue;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async getParentSha(sha: string): Promise<string | null> {
    const { owner, repo } = this.coords;
    try {
      const res = await this.octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
      });
      return res.data.parents?.[0]?.sha ?? null;
    } catch (err) {
      const e = err as ApiError;
      console.warn(`Could not retrieve parent commit for ${sha}: ${e.message}`);
      return null;
    }
  }

  async resolveBaselineCommit(
    dispatchOverride: string,
    configuredBranch: string,
  ): Promise<{
    commitHash: string;
    usedFallback: boolean;
    latestCommit?: string;
  }> {
    const targetBranch = await this.resolveTargetBranch(
      dispatchOverride,
      configuredBranch,
    );

    console.log(`Resolving baseline commit from branch: ${targetBranch}`);
    console.log(`Repository: ${this.coords.owner}/${this.coords.repo}`);

    const { owner, repo } = this.coords;
    let branchRes: any;
    try {
      branchRes = await this.octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: targetBranch,
      });
    } catch (err) {
      const e = err as ApiError;
      throw new Error(
        `Failed to get target branch (${targetBranch}) commit: ${e.message}`,
      );
    }
    const headSha = branchRes.data?.commit?.sha;
    if (!headSha) throw new Error(`Branch ${targetBranch} has no commit SHA`);

    const shortHead = abbreviateSha(headSha);
    console.log(`Latest commit on ${targetBranch}: ${shortHead}`);

    const headHasArtifacts = await this.commitHasArtifacts(
      headSha,
      targetBranch,
    );
    if (headHasArtifacts) {
      console.log(`Commit ${shortHead} has baseline artifacts`);
      return { commitHash: headSha, usedFallback: false };
    }

    console.log(
      `Commit ${shortHead} has no artifacts — searching ancestors...`,
    );

    let cursor = headSha;
    const visited = new Set([cursor]);
    const maxDepth = 5;

    for (let depth = 0; depth < maxDepth; depth++) {
      const parent = await this.getParentSha(cursor);
      if (!parent) {
        console.log('Reached root commit, stopping ancestor search');
        break;
      }
      if (visited.has(parent)) {
        console.log('Detected cycle in ancestry, stopping');
        break;
      }
      visited.add(parent);

      const shortParent = abbreviateSha(parent);
      console.log(`Checking ancestor ${shortParent}...`);

      if (await this.commitHasArtifacts(parent, targetBranch)) {
        console.log(`Found artifacts at ancestor ${shortParent}`);
        return {
          commitHash: parent,
          usedFallback: true,
          latestCommit: headSha,
        };
      }

      cursor = parent;
    }

    console.log(
      `No ancestor with artifacts found in ${maxDepth} steps — using head`,
    );
    return { commitHash: headSha, usedFallback: false };
  }

  async listAllRepoArtifacts() {
    const { owner, repo } = this.coords;
    const res = await this.octokit.rest.actions.listArtifactsForRepo({
      owner,
      repo,
      per_page: 100,
    });
    return res.data;
  }

  async findRunForCommit(
    sha: string,
    status: 'completed' | 'in_progress' | 'queued' | 'requested' = 'completed',
    branch?: string,
  ) {
    const { owner, repo } = this.coords;
    try {
      const exact = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        head_sha: sha,
        status,
        per_page: 10,
      });
      if (exact.data.workflow_runs?.length > 0) {
        const success = exact.data.workflow_runs.find(
          (r: any) => r.conclusion === 'success',
        );
        return success || exact.data.workflow_runs[0];
      }

      const short = sha.substring(0, 10);
      const all = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        status,
        per_page: 100,
      });
      return (
        all.data.workflow_runs?.find(
          (r: any) =>
            r.head_sha.startsWith(short) || r.head_sha.startsWith(sha),
        ) || null
      );
    } catch (err) {
      const e = err as ApiError;
      console.warn(`Could not find run for commit ${sha}: ${e.message}`);
      return null;
    }
  }

  async findAllRunsForCommit(
    sha: string,
    status: 'completed' | 'in_progress' | 'queued' | 'requested' = 'completed',
    branch?: string,
  ) {
    const { owner, repo } = this.coords;
    try {
      const exact = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        head_sha: sha,
        status,
        per_page: 30,
      });
      if (exact.data.workflow_runs?.length > 0) return exact.data.workflow_runs;

      const short = sha.substring(0, 10);
      const all = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        status,
        per_page: 100,
      });
      return (
        all.data.workflow_runs?.filter(
          (r: any) =>
            r.head_sha.startsWith(short) || r.head_sha.startsWith(sha),
        ) || []
      );
    } catch (err) {
      const e = err as ApiError;
      console.warn(`Could not find runs for commit ${sha}: ${e.message}`);
      return [];
    }
  }

  async listRunArtifacts(runId: number) {
    const { owner, repo } = this.coords;
    const res = await this.octokit.rest.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: runId,
    });
    return res.data;
  }

  async downloadArtifactZip(artifactId: number) {
    const { owner, repo } = this.coords;
    const res = await this.octokit.rest.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: artifactId,
      archive_format: 'zip',
    });
    return res.data;
  }

  async findPRsForCommit(
    sha: string,
  ): Promise<Array<{ number: number; title: string; url: string }>> {
    const { owner, repo } = this.coords;
    try {
      const { data } =
        await this.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: sha,
        });
      return data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
      }));
    } catch (err) {
      console.warn(`Could not look up PRs for commit ${sha}: ${err}`);
      return [];
    }
  }

  async findExistingComment(
    prNumber: number,
    prefix: string,
  ): Promise<number | null> {
    const { owner, repo } = this.coords;
    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
      });
      const match = (comments as CommentRecord[]).find((c) =>
        c.body.startsWith(prefix),
      );
      return match ? match.id : null;
    } catch (err) {
      const e = err as ApiError;
      console.warn(`Could not list PR comments: ${e.message}`);
      return null;
    }
  }

  async upsertPRComment(prNumber: number, body: string): Promise<void> {
    const { owner, repo } = this.coords;
    const anchor = '## Rsdoctor Bundle Diff Analysis';

    const existingId = await this.findExistingComment(prNumber, anchor);

    if (existingId) {
      console.log(`Updating existing PR comment: ${existingId}`);
      await this.octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingId,
        body,
      });
    } else {
      console.log('Creating new PR comment');
      await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
    }
  }
}
