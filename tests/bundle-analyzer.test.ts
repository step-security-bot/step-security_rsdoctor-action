import * as path from 'path';
import { summary } from '@actions/core';
import {
  parseBundleManifest,
  renderProjectSection,
  emitJobSummary,
} from '../src/bundle-analyzer';
import { describe, it, expect } from 'rstack/test';

describe('BundleAnalyzer', () => {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const bundleManifestPath = path.join(fixturesDir, 'bundle-manifest.json');

  describe('parseBundleManifest', () => {
    it('should parse bundle manifest correctly', () => {
      const result = parseBundleManifest(bundleManifestPath);
      expect(result).toBeDefined();
      expect(result?.totalSize).toBe(62914560);
      expect(result?.jsSize).toBe(52428800);
      expect(result?.cssSize).toBe(10485760);
      expect(result?.totalGzipSize).toBe(11534336);
      expect(result?.jsGzipSize).toBe(10485760);
      expect(result?.cssGzipSize).toBe(1048576);
      expect(result?.assets).toHaveLength(2);
      expect(result?.chunks).toHaveLength(1);
    });

    it('should return null for non-existent file', () => {
      const result = parseBundleManifest('non-existent.json');
      expect(result).toBeNull();
    });

    describe('source map and license file exclusion', () => {
      it('should exclude .js.map, .css.map and .LICENSE.txt assets', () => {
        const result = parseBundleManifest(bundleManifestPath);
        expect(result?.assets).toHaveLength(2);
      });

      it('should not include source map or license file sizes in otherSize', () => {
        const result = parseBundleManifest(bundleManifestPath);
        expect(result?.otherSize).toBe(0);
      });
    });
  });

  describe('renderProjectSection', () => {
    const mockSnapshot = {
      totalSize: 1024 * 1024,
      jsSize: 512 * 1024,
      cssSize: 256 * 1024,
      htmlSize: 128 * 1024,
      otherSize: 128 * 1024,
      totalGzipSize: 384 * 1024,
      assets: [],
      chunks: [],
    };

    it('should render table without baseline', () => {
      const markdown = renderProjectSection(
        'test-project',
        'path/to/file.json',
        mockSnapshot,
      );
      expect(markdown).toContain('### 📁 test-project');
      expect(markdown).toContain('**Path:** `path/to/file.json`');
      expect(markdown).toContain('1.0 MB');
      expect(markdown).toContain('384.0 KB');
      expect(markdown).toContain('512.0 KB');
      expect(markdown).toContain('⚠️ **No baseline data found**');
      expect(markdown).toContain('| Metric | Current | Baseline | Change |');
      expect(markdown).toContain('| 📊 Total Size | 1.0 MB | - | - |');
      expect(markdown).toContain('| 🗜️ Gzip Size | 384.0 KB | - | - |');
      expect(markdown).toContain('| 📄 JavaScript | 512.0 KB | - | - |');
      expect(markdown).toContain('| 🎨 CSS | 256.0 KB | - | - |');
      expect(markdown).toContain('| 🌐 HTML | 128.0 KB | - | - |');
      expect(markdown).toContain('| 📁 Other Assets | 128.0 KB | - | - |');
    });

    it('should render table with baseline diff', () => {
      const baseline = {
        ...mockSnapshot,
        totalSize: 512 * 1024,
        totalGzipSize: 256 * 1024,
      };
      const markdown = renderProjectSection(
        'test-project',
        'path/to/file.json',
        mockSnapshot,
        baseline,
      );
      expect(markdown).toContain('### 📁 test-project');
      expect(markdown).toContain('**Path:** `path/to/file.json`');
      expect(markdown).toContain('+512.0 KB');
      expect(markdown).not.toContain('⚠️ **No baseline data found**');
    });

    it('should include project name in heading', () => {
      const markdown = renderProjectSection(
        'my-app',
        'packages/my-app/dist/.rsdoctor/rsdoctor-data.json',
        mockSnapshot,
      );
      expect(markdown).toContain('### 📁 my-app');
      expect(markdown).toContain(
        'packages/my-app/dist/.rsdoctor/rsdoctor-data.json',
      );
    });
  });

  describe('emitJobSummary', () => {
    const mockSnapshot = {
      totalSize: 1024 * 1024,
      jsSize: 512 * 1024,
      cssSize: 256 * 1024,
      htmlSize: 128 * 1024,
      otherSize: 128 * 1024,
      totalGzipSize: 384 * 1024,
      assets: [],
      chunks: [],
    };

    it('should emit summary without baseline', async () => {
      await emitJobSummary(mockSnapshot);
      expect(summary.addRaw).toHaveBeenCalledWith(
        '> ⚠️ **No baseline data found** - Unable to perform comparison analysis\n\n',
      );
    });

    it('should emit baseline commit info when baseline is provided', async () => {
      const baseline = {
        ...mockSnapshot,
        totalSize: 512 * 1024,
        totalGzipSize: 256 * 1024,
      };
      await emitJobSummary(mockSnapshot, baseline, true, 'abc123');
      expect(summary.addRaw).toHaveBeenCalledWith(
        expect.stringMatching(/^> 📌 \*\*Baseline Commit:\*\*.*\n\n$/),
      );
    });
  });
});
