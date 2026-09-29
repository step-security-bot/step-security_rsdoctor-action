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
import * as bundleAnalyzer from '../src/bundle-analyzer';
import { silenceConsole } from './helpers/console-spy';

const { parseBundleManifest } = bundleAnalyzer;

const testSha = 'abc1234567';
const testDataPath = path.join(
  process.cwd(),
  'dist/.rsdoctor/rsdoctor-data.json',
);

const testManifest = {
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

describe('Integration', () => {
  beforeEach(() => {
    silenceConsole();
    mockFs({
      'dist/.rsdoctor': {
        'rsdoctor-data.json': JSON.stringify(testManifest, null, 2),
      },
    });
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_REF = 'refs/pull/123/merge';
  });

  afterEach(() => {
    mockFs.restore();
    rstest.restoreAllMocks();
  });

  describe('Error Handling', () => {
    it('returns null for a missing manifest file', () => {
      mockFs.restore();
      expect(parseBundleManifest('/non/existent/path.json')).toBeNull();
    });

    it('returns null for a manifest with unexpected shape', () => {
      mockFs({ [testDataPath]: '{ "invalid": "data" }' });
      expect(parseBundleManifest(testDataPath)).toBeNull();
    });
  });

  describe('Pull Request Workflow', () => {
    it('parses the manifest and uploads an artifact', async () => {
      const emitSpy = rstest
        .spyOn(bundleAnalyzer, 'emitJobSummary')
        .mockResolvedValue(undefined);

      const snapshot = parseBundleManifest(testDataPath);
      expect(snapshot).toBeDefined();
      expect(snapshot?.totalSize).toBe(1024 * 1024);

      const { id } = await uploadArtifact(testDataPath, testSha);
      expect(id).toBe(1);

      await bundleAnalyzer.emitJobSummary(snapshot!);
      expect(emitSpy).toHaveBeenCalledWith(snapshot);
    });
  });

  describe('ActionsClient', () => {
    let client: ActionsClient;

    beforeEach(() => {
      client = new ActionsClient('test-token');
    });

    it('resolves baseline commit and lists artifacts', async () => {
      rstest.spyOn(client, 'resolveBaselineCommit').mockResolvedValue({
        commitHash: 'test-commit-hash',
        usedFallback: false,
      });
      rstest.spyOn(client, 'listAllRepoArtifacts').mockResolvedValue({
        artifacts: [{ id: 1, name: 'rsdoctor-data' }],
      } as any);

      const baseline = await client.resolveBaselineCommit('', 'main');
      expect(baseline.commitHash).toBe('test-commit-hash');

      const { artifacts } = await client.listAllRepoArtifacts();
      expect(artifacts[0].id).toBe(1);

      const { id } = await uploadArtifact(testDataPath, testSha);
      expect(id).toBe(1);
    });
  });
});
