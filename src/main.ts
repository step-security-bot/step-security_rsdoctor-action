import { setFailed, getInput, summary } from '@actions/core';
import { uploadArtifact } from './artifact-store';
import { resolveAndFetchBaseline } from './artifact-fetch';
import { ActionsClient } from './octokit-client';
import {
  parseBundleManifest,
  injectGzipMetrics,
  emitJobSummary,
  emitLegacySizeReport,
  readLegacyManifest,
  hasSizeDrifted,
  buildPRComment,
  BundleSnapshot,
} from './bundle-analyzer';
import type { IntelligenceResult } from './intelligence';
import { loadConfig } from './settings';
import path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';
import { validateSubscription } from './subscription';

type Trigger = 'push' | 'pull_request' | 'dispatch' | 'skip';

function detectTrigger(targetBranch: string): Trigger {
  const { context } = require('@actions/github');
  const event: string = context.eventName;

  if (event === 'workflow_dispatch') {
    console.log('Trigger: workflow_dispatch (manual)');
    return 'dispatch';
  }

  if (event === 'pull_request') {
    const action: string = context.payload.action;
    const merged: boolean = context.payload.pull_request?.merged === true;
    const num: number = context.payload.pull_request?.number;
    const base: string = context.payload.pull_request?.base?.ref;
    const head: string = context.payload.pull_request?.head?.ref;

    if (action === 'closed') {
      if (merged) {
        console.log(
          'PR closed and merged — artifact upload happens on subsequent push event',
        );
      } else {
        console.log('PR closed without merge — skipping');
      }
      return 'skip';
    }

    console.log(
      `Trigger: pull_request (action=${action}, PR #${num}: ${head} -> ${base})`,
    );
    return 'pull_request';
  }

  if (event === 'push') {
    const ref: string = context.ref;
    const expected = `refs/heads/${targetBranch}`;
    if (ref === expected) {
      console.log(`Trigger: push to target branch (${targetBranch})`);
      return 'push';
    }
    console.log(`Push to ${ref}, not target branch (${expected}) — skipping`);
    return 'skip';
  }

  console.log(`Unrecognised event: ${event} — skipping`);
  return 'skip';
}

export function resolveProjectLabel(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  const parts = relative.split(path.sep);

  const buildDirs = ['dist', '.rsdoctor', 'output', '.next', 'public'];
  const groupDirs = [
    'packages',
    'apps',
    'projects',
    'libs',
    'modules',
    'examples',
  ];

  const groupIdx = parts.findIndex((p) => groupDirs.includes(p));

  if (groupIdx >= 0 && groupIdx + 1 < parts.length) {
    let packageName: string | null = null;
    let packageIdx = -1;
    for (let i = groupIdx + 1; i < parts.length; i++) {
      if (!buildDirs.includes(parts[i])) {
        packageName = parts[i];
        packageIdx = i;
        break;
      }
    }

    if (packageName) {
      for (let i = parts.length - 2; i > packageIdx; i--) {
        if (!buildDirs.includes(parts[i])) {
          return `${packageName}/${parts[i]}`;
        }
      }
      return packageName;
    }
  }

  for (let i = parts.length - 2; i >= 0; i--) {
    if (!buildDirs.includes(parts[i])) return parts[i];
  }

  return parts[0] || 'root';
}

async function invokeBundleDiff(opts: {
  baseline: string;
  current: string;
  html?: boolean;
  json?: boolean | string;
  output?: string;
}) {
  const { execute } = await import(
    /* webpackChunkName: "rsdoctor-cli" */ '@rsdoctor/cli'
  );
  await execute('bundle-diff', opts);
}

interface FileAnalysis {
  projectName: string;
  filePath: string;
  current: BundleSnapshot | null;
  baseline: BundleSnapshot | null;
  baselineCommit?: string | null;
  baselinePRs?: Array<{ number: number; title: string; url: string }>;
  diffHtmlPath?: string;
  diffHtmlArtifactId?: number;
  baselineUsedFallback?: boolean;
  baselineLatestCommit?: string;
  intelligence?: IntelligenceResult | null;
}

async function analyzeProjectFile(
  fullPath: string,
  currentCommit: string,
  baselineCommit: string | null,
  baselineFallback: boolean,
  baselineLatest: string | undefined,
  apiKey: string,
  aiModel: string,
): Promise<FileAnalysis> {
  const fileName = path.basename(fullPath);
  const relative = path.relative(process.cwd(), fullPath);
  const projectName = resolveProjectLabel(fullPath);

  console.log(`\nAnalyzing project: ${projectName} (${relative})`);

  const result: FileAnalysis = {
    projectName,
    filePath: relative,
    current: null,
    baseline: null,
  };

  const currentSnapshot = parseBundleManifest(fullPath);
  if (!currentSnapshot) {
    console.warn(`Could not parse bundle manifest from ${fullPath}, skipping`);
    return result;
  }
  result.current = currentSnapshot;

  let baselineFilePath: string | null = null;

  if (baselineCommit) {
    try {
      console.log(`Fetching baseline for ${projectName}...`);
      const fetched = await resolveAndFetchBaseline(
        baselineCommit,
        fileName,
        fullPath,
      );
      baselineFilePath = path.join(fetched.downloadPath, fileName);

      const baselineSnapshot = parseBundleManifest(baselineFilePath);
      if (baselineSnapshot) {
        result.baseline = baselineSnapshot;
        result.baselineCommit = baselineCommit;
        result.baselineUsedFallback = baselineFallback;
        result.baselineLatestCommit = baselineLatest;

        try {
          const client = new ActionsClient(
            getInput('github_token', { required: true }),
          );
          const prs = await client.findPRsForCommit(baselineCommit);
          if (prs.length > 0) {
            result.baselinePRs = prs;
            console.log(
              `Found ${prs.length} PR(s) for baseline commit ${baselineCommit}`,
            );
          }
        } catch {
          // non-fatal — PR metadata is supplementary
        }
      }
    } catch (err) {
      console.log(`Could not fetch baseline for ${projectName}: ${err}`);
      baselineFilePath = null;
    }
  }

  if (result.baseline && baselineFilePath) {
    const cwd = process.cwd();
    const safeProjectName = projectName.replace(/\//g, '-');

    const diffHtmlPath = path.join(
      cwd,
      `rsdoctor-diff-${safeProjectName}.html`,
    );

    try {
      await invokeBundleDiff({
        baseline: baselineFilePath,
        current: fullPath,
        html: true,
        output: diffHtmlPath,
      });
    } catch (err) {
      console.log(`HTML diff generation failed for ${projectName}: ${err}`);
    }

    result.diffHtmlPath = diffHtmlPath;

    if (fs.existsSync(diffHtmlPath)) {
      try {
        const uploaded = await uploadArtifact(diffHtmlPath, currentCommit);
        if (typeof uploaded.id === 'number') {
          result.diffHtmlArtifactId = uploaded.id;
          console.log(
            `Uploaded diff HTML for ${projectName} (artifact ID: ${uploaded.id})`,
          );
        }
      } catch (err) {
        console.warn(`Could not upload diff HTML for ${projectName}: ${err}`);
      }
    }

    if (apiKey && hasSizeDrifted(currentSnapshot, result.baseline)) {
      try {
        const diffJsonPath = path.join(
          cwd,
          `rsdoctor-diff-${safeProjectName}.json`,
        );

        try {
          await invokeBundleDiff({
            baseline: baselineFilePath,
            current: fullPath,
            json: diffJsonPath,
          });
        } catch (err) {
          console.log(`JSON diff generation failed for ${projectName}: ${err}`);
          return result;
        }

        const { runIntelligence } = await import(
          /* webpackChunkName: "ai-analysis" */ './intelligence'
        );
        result.intelligence = await runIntelligence(
          diffJsonPath,
          apiKey,
          aiModel,
        );
      } catch (err) {
        console.warn(`Intelligence analysis failed for ${projectName}: ${err}`);
      }
    } else if (apiKey) {
      console.log(
        `No size drift detected for ${projectName} — skipping intelligence analysis`,
      );
    }
  }

  return result;
}

export async function run(): Promise<void> {
  try {
    await validateSubscription();
    const config = loadConfig();

    if (!config.filePathPattern) {
      throw new Error('file_path input is required');
    }

    const matchedFiles = await fg(config.filePathPattern, {
      cwd: process.cwd(),
      absolute: true,
      onlyFiles: true,
    });

    if (matchedFiles.length === 0) {
      throw new Error(`No files matched pattern: ${config.filePathPattern}`);
    }

    console.log(
      `Found ${matchedFiles.length} file(s) for pattern: ${config.filePathPattern}`,
    );
    matchedFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

    const client = new ActionsClient(config.githubToken);
    const currentCommit = client.getCurrentCommitHash();
    console.log(`Current commit: ${currentCommit}`);

    const apiKey = config.enableIntelligence ? process.env.AI_TOKEN || '' : '';
    if (!config.enableIntelligence) {
      console.log('Intelligence analysis disabled');
    } else if (apiKey) {
      console.log(`Intelligence analysis enabled (model: ${config.aiModel})`);
    } else {
      console.warn('Intelligence analysis enabled but AI_TOKEN is not set');
    }

    const targetBranch = await client.resolveTargetBranch(
      config.dispatchTargetBranch,
      config.targetBranch,
    );

    const trigger = detectTrigger(targetBranch);

    let baselineCommit: string | null = null;
    let baselineFallback = false;
    let baselineLatest: string | undefined;

    if (trigger === 'pull_request' || trigger === 'dispatch') {
      try {
        console.log('Resolving baseline commit...');
        const resolved = await client.resolveBaselineCommit(
          config.dispatchTargetBranch,
          config.targetBranch,
        );
        baselineCommit = resolved.commitHash;
        baselineFallback = resolved.usedFallback;
        baselineLatest = resolved.latestCommit;
        console.log(`Baseline commit: ${baselineCommit}`);
        if (baselineFallback && baselineLatest) {
          console.log(
            `  (fallback — latest ${baselineLatest} has no artifacts)`,
          );
        }
      } catch (err) {
        console.error(`Could not resolve baseline commit: ${err}`);
      }
    }

    const analyses: FileAnalysis[] = [];

    if (trigger === 'push') {
      console.log('Push to target branch — uploading artifacts');

      for (const fullPath of matchedFiles) {
        injectGzipMetrics(fullPath);
        const uploaded = await uploadArtifact(fullPath, currentCommit);

        if (typeof uploaded.id === 'number') {
          console.log(`Uploaded artifact ID: ${uploaded.id} for ${fullPath}`);
        } else {
          console.warn(`Artifact upload failed for ${fullPath}`);
        }

        const snap = parseBundleManifest(fullPath);
        if (snap) {
          analyses.push({
            projectName: resolveProjectLabel(fullPath),
            filePath: path.relative(process.cwd(), fullPath),
            current: snap,
            baseline: null,
          });
        } else {
          const legacy = readLegacyManifest(fullPath);
          if (legacy) await emitLegacySizeReport(legacy);
        }
      }

      if (analyses.length === 1) {
        await emitJobSummary(
          analyses[0].current!,
          undefined,
          true,
          null,
          undefined,
        );
      } else if (analyses.length > 1) {
        await summary.addHeading('📦 Monorepo Bundle Analysis', 2);
        for (const a of analyses) {
          if (!a.current) continue;
          await summary.addHeading(`📁 ${a.projectName}`, 3);
          await summary.addRaw(`**Path:** \`${a.filePath}\`\n\n`);
          await emitJobSummary(a.current, undefined, false, null, undefined);
        }
        await summary.write();
      }
    } else if (trigger === 'pull_request' || trigger === 'dispatch') {
      if (trigger === 'dispatch') {
        console.log(
          'workflow_dispatch — uploading artifacts and comparing with baseline',
        );
      } else {
        console.log('pull_request — comparing with baseline');
      }

      for (const fullPath of matchedFiles) {
        const analysis = await analyzeProjectFile(
          fullPath,
          currentCommit,
          baselineCommit,
          baselineFallback,
          baselineLatest,
          apiKey,
          config.aiModel,
        );
        analyses.push(analysis);

        if (trigger === 'dispatch') {
          injectGzipMetrics(fullPath);
          const uploaded = await uploadArtifact(fullPath, currentCommit);
          if (typeof uploaded.id === 'number') {
            console.log(`Uploaded artifact ID: ${uploaded.id} for ${fullPath}`);
          } else {
            console.warn(`Artifact upload failed for ${fullPath}`);
          }
        }
      }

      if (analyses.length > 0) {
        if (analyses.length === 1) {
          const a = analyses[0];
          if (a.current) {
            if (a.baselineUsedFallback && a.baselineLatestCommit) {
              await summary.addRaw(
                `> ⚠️ **Note:** The latest commit (\`${a.baselineLatestCommit}\`) does not have baseline artifacts. Using commit \`${a.baselineCommit}\` for baseline comparison instead. If this seems incorrect, please wait a few minutes and try rerunning the workflow.\n\n`,
              );
            }
            await emitJobSummary(
              a.current,
              a.baseline || undefined,
              true,
              a.baselineCommit,
              a.baselinePRs,
            );
          }
        } else {
          await summary.addHeading('📦 Monorepo Bundle Analysis', 2);

          const first = analyses.find((a) => a.current);
          if (first?.baselineUsedFallback && first?.baselineLatestCommit) {
            await summary.addRaw(
              `> ⚠️ **Note:** The latest commit (\`${first.baselineLatestCommit}\`) does not have baseline artifacts. Using commit \`${first.baselineCommit}\` for baseline comparison instead. If this seems incorrect, please wait a few minutes and try rerunning the workflow.\n\n`,
            );
          }

          for (const a of analyses) {
            if (!a.current) continue;
            await summary.addHeading(`📁 ${a.projectName}`, 3);
            await summary.addRaw(`**Path:** \`${a.filePath}\`\n\n`);
            await emitJobSummary(
              a.current,
              a.baseline || undefined,
              false,
              a.baselineCommit,
              a.baselinePRs,
            );
          }

          await summary.write();
        }
      }
    } else {
      console.log(
        'This action only runs on push (to target branch), pull_request, and workflow_dispatch events.',
      );
      console.log(`Current event: ${process.env.GITHUB_EVENT_NAME}`);
      return;
    }

    if (trigger === 'pull_request' && analyses.length > 0) {
      const { context } = require('@actions/github');
      const prNumber: number = context.payload.pull_request.number;

      const commentBody = buildPRComment({
        reports: analyses.map((a) => ({
          projectName: a.projectName,
          filePath: a.filePath,
          current: a.current,
          baseline: a.baseline,
          baselineCommit: a.baselineCommit,
          baselinePRs: a.baselinePRs,
          diffHtmlArtifactId: a.diffHtmlArtifactId,
          baselineUsedFallback: a.baselineUsedFallback,
          baselineLatestCommit: a.baselineLatestCommit,
          intelligence: a.intelligence
            ? { analysis: a.intelligence.analysis, model: a.intelligence.model }
            : undefined,
        })),
      });

      try {
        await client.upsertPRComment(prNumber, commentBody);
        console.log('PR comment posted/updated');
      } catch (err) {
        console.warn(`Could not post PR comment: ${err}`);
      }
    }
  } catch (err) {
    setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
