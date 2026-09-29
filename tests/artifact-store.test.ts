import * as path from 'path';
const mockFs = require('mock-fs');
import { uploadArtifact, fingerprintPath } from '../src/artifact-store';
import { silenceConsole, restoreConsole } from './helpers/console-spy';
import {
  describe,
  beforeEach,
  rstest,
  afterEach,
  it,
  expect,
} from 'rstack/test';

describe('ArtifactStore', () => {
  const mockCommitHash = 'abc1234567';
  const mockFilePath = '/tmp/test/rsdoctor-data.json';
  const mockFileContent = JSON.stringify({ test: 'data' });

  beforeEach(() => {
    silenceConsole();
    mockFs({
      '/tmp/test': {
        'rsdoctor-data.json': mockFileContent,
        'other-file.txt': 'test content',
      },
    });

    rstest
      .spyOn(require('child_process'), 'execSync')
      .mockReturnValue(mockCommitHash);
  });

  afterEach(() => {
    mockFs.restore();
    rstest.restoreAllMocks();
    restoreConsole();
  });

  it('should upload artifact successfully', async () => {
    const result = await uploadArtifact(mockFilePath);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  it('should use provided commit hash', async () => {
    const customHash = 'custom123456';
    const result = await uploadArtifact(mockFilePath, customHash);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  it('should throw error for non-existent file', async () => {
    await expect(uploadArtifact('/non/existent/file.json')).rejects.toThrow(
      'Artifact source file not found',
    );
  });

  it('should prefix artifact name with rsdoctor for easier cleanup', async () => {
    const result = await uploadArtifact(mockFilePath, mockCommitHash);
    const relativePath = path.relative(process.cwd(), mockFilePath);
    const pathParts = relativePath.split(path.sep);
    const pathHash = fingerprintPath(pathParts, 'rsdoctor-data');

    expect(console.log).toHaveBeenCalledWith(
      `Uploading artifact: rsdoctor-${pathHash}-${mockCommitHash}`,
    );
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  it('should keep the historical short SHA when given a full commit SHA', async () => {
    const fullCommitHash = 'abc1234567abc1234567abc1234567abc1234567';
    const result = await uploadArtifact(mockFilePath, fullCommitHash);
    const relativePath = path.relative(process.cwd(), mockFilePath);
    const pathParts = relativePath.split(path.sep);
    const pathHash = fingerprintPath(pathParts, 'rsdoctor-data');

    expect(console.log).toHaveBeenCalledWith(
      `Uploading artifact: rsdoctor-${pathHash}-${mockCommitHash}`,
    );
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
  });

  describe('fingerprintPath', () => {
    it('should generate consistent hash for same path', () => {
      const pathParts = ['packages', 'app1', 'dist', '.rsdoctor'];
      const hash1 = fingerprintPath(pathParts, 'rsdoctor-data');
      const hash2 = fingerprintPath(pathParts, 'rsdoctor-data');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
    });

    it('should generate different hash for different paths', () => {
      const fileName = 'rsdoctor-data';
      const hash1 = fingerprintPath(
        ['packages', 'app1', 'dist', '.rsdoctor'],
        fileName,
      );
      const hash2 = fingerprintPath(
        ['packages', 'app2', 'dist', '.rsdoctor'],
        fileName,
      );
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different file names', () => {
      const pathParts = ['packages', 'app1', 'dist', '.rsdoctor'];
      const hash1 = fingerprintPath(pathParts, 'rsdoctor-data');
      const hash2 = fingerprintPath(pathParts, 'other-data');
      expect(hash1).not.toBe(hash2);
    });
  });
});
