import { getInput } from '@actions/core';

export interface ActionConfig {
  githubToken: string;
  filePathPattern: string;
  targetBranch: string;
  dispatchTargetBranch: string;
  enableIntelligence: boolean;
  aiModel: string;
}

export function isIntelligenceEnabled(value: string): boolean {
  return value.trim().toLowerCase() !== 'false';
}

export function loadConfig(): ActionConfig {
  const enableRaw = getInput('enable_ai_analysis') || 'true';
  return {
    githubToken: getInput('github_token', { required: true }),
    filePathPattern: getInput('file_path'),
    targetBranch: getInput('target_branch'),
    dispatchTargetBranch: getInput('dispatch_target_branch') || '',
    enableIntelligence: isIntelligenceEnabled(enableRaw),
    aiModel: getInput('ai_model') || 'claude-3-5-haiku-latest',
  };
}
