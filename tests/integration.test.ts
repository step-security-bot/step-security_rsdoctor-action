import * as path from 'path';
import {
  expect,
  describe,
  afterEach,
  beforeEach,
  it,
  rstest,
} from 'rstack/test';
const mockFs = require('mock-fs');
import { ActionsClient } from '../src/octokit-client';
import { uploadArtifact } from '../src/artifact-store';
import { parseBundleManifest, emitJobSummary } from '../src/bundle-analyzer';
import { silenceConsole } from './helpers/console-spy';

describe('Integration', () => {
  const mockCommitHash = 'abc1234567';
  const mockFilePath = path.join(
    process.cwd(),
    'dist/.rsdoctor/rsdoctor-data.json',
  );
  const mockManifestData = {
    data: {
      chunkGraph: {
        assets: [
          {
            id: 1,
            path: 'dist/static/js/index.js',
            size: 1024 * 1024,
            chunks: ['index'],
          },
        ],
        chunks: [
          {
            id: 'index',
            name: 'index',
            initial: true,
            size: 1024 * 1024,
            assets: ['dist/static/js/index.js'],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    silenceConsole();
    mockFs({
      'dist/.rsdoctor': {
        'rsdoctor-data.json': JSON.stringify(mockManifestData, null, 2),
      },
    });

    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_REF = 'refs/pull/123/merge';
  });

  afterEach(() => {
    mockFs.restore();
    rstest.restoreAllMocks();
  });

  describe('Pull Request Workflow', () => {
    it('should process pull request event correctly', async () => {
      const snapshot = parseBundleManifest(mockFilePath);
      expect(snapshot).toBeDefined();
      expect(snapshot?.totalSize).toBe(1024 * 1024);

      const uploadResponse = await uploadArtifact(mockFilePath, mockCommitHash);
      expect(uploadResponse.id).toBe(1);

      await emitJobSummary(snapshot!);
      expect(true).toBe(true);
    });
  });

  describe('ActionsClient Integration', () => {
    let client: ActionsClient;

    beforeEach(() => {
      client = new ActionsClient('test-token');
    });

    it('should handle the complete artifact workflow', async () => {
      rstest.spyOn(client, 'resolveBaselineCommit').mockResolvedValue({
        commitHash: 'test-commit-hash',
        usedFallback: false,
      });

      rstest.spyOn(client, 'listAllRepoArtifacts').mockResolvedValue({
        artifacts: [{ id: 1, name: 'rsdoctor-data' }],
      } as any);

      const baseline = await client.resolveBaselineCommit('', 'main');
      expect(baseline.commitHash).toBe('test-commit-hash');

      const arts = await client.listAllRepoArtifacts();
      expect(arts.artifacts[0].id).toBe(1);

      const uploadResponse = await uploadArtifact(mockFilePath, mockCommitHash);
      expect(uploadResponse.id).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing bundle manifest gracefully', async () => {
      mockFs.restore();
      const snapshot = parseBundleManifest('/non/existent/path.json');
      expect(snapshot).toBeNull();
    });

    it('should handle invalid bundle manifest format', async () => {
      mockFs({
        [mockFilePath]: '{ "invalid": "data" }',
      });
      const snapshot = parseBundleManifest(mockFilePath);
      expect(snapshot).toBeNull();
    });
  });
});
