import { summary } from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';

export interface LegacySizeData {
  totalSize: number;
  totalGzipSize?: number;
  files: Array<{
    path: string;
    size: number;
    gzipSize?: number;
    brotliSize?: number;
  }>;
}

export interface ManifestData {
  data: {
    chunkGraph: {
      assets: Array<{
        id: number;
        path: string;
        size: number;
        gzipSize?: number;
        chunks: string[];
      }>;
      chunks: Array<{
        id: string;
        name: string;
        initial: boolean;
        size: number;
        assets: string[];
      }>;
    };
  };
}

export interface BundleSnapshot {
  totalSize: number;
  jsSize: number;
  cssSize: number;
  htmlSize: number;
  otherSize: number;
  totalGzipSize?: number;
  jsGzipSize?: number;
  cssGzipSize?: number;
  htmlGzipSize?: number;
  otherGzipSize?: number;
  assets: Array<{
    path: string;
    size: number;
    gzipSize?: number;
    type: 'js' | 'css' | 'html' | 'other';
  }>;
  chunks: Array<{
    name: string;
    size: number;
    isInitial: boolean;
  }>;
}

function redirectGitHubUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('https://redirect.github.com/')) return url;
  try {
    const parsed = new URL(url);
    return `https://redirect.github.com${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export function humanizeBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const negative = bytes < 0;
  const abs = Math.abs(bytes);

  if (abs === 0) return '0 B';

  const idx = Math.floor(Math.log(abs) / Math.log(1024));
  const formatted = (abs / Math.pow(1024, idx)).toFixed(1);

  return `${negative ? '-' : ''}${formatted} ${units[idx]}`;
}

function optionalBytes(bytes?: number): string {
  return typeof bytes === 'number' && !isNaN(bytes)
    ? humanizeBytes(bytes)
    : '-';
}

function optionalDelta(current?: number, baseline?: number): string {
  if (typeof current !== 'number' || typeof baseline !== 'number') return '-';
  return computeSizeDelta(current, baseline).label;
}

function locateAsset(assetPath: string, manifestPath: string): string | null {
  const rel = path.relative(process.cwd(), manifestPath);
  const isDownloaded = rel.split(path.sep)[0] === 'temp-artifact';
  const candidates = [
    path.isAbsolute(assetPath) && !isDownloaded ? assetPath : null,
    isDownloaded ? null : path.resolve(process.cwd(), assetPath),
    path.resolve(path.dirname(manifestPath), assetPath),
    path.resolve(path.dirname(manifestPath), '..', assetPath),
  ].filter(Boolean) as string[];

  return candidates.find((c) => fs.existsSync(c)) || null;
}

function measureGzip(
  asset: { path: string; gzipSize?: number },
  manifestPath: string,
): number | undefined {
  if (typeof asset.gzipSize === 'number' && !isNaN(asset.gzipSize)) {
    return asset.gzipSize;
  }
  const resolved = locateAsset(asset.path, manifestPath);
  if (!resolved) return undefined;
  return gzipSync(fs.readFileSync(resolved)).length;
}

export function injectGzipMetrics(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;

    const manifest: ManifestData = JSON.parse(
      fs.readFileSync(filePath, 'utf8'),
    );
    const assets = manifest.data?.chunkGraph?.assets;
    if (!Array.isArray(assets)) return false;

    let changed = false;
    for (const asset of assets) {
      if (typeof asset.gzipSize === 'number' && !isNaN(asset.gzipSize))
        continue;
      const gz = measureGzip(asset, filePath);
      if (typeof gz === 'number') {
        asset.gzipSize = gz;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    return changed;
  } catch (err) {
    console.warn(`Failed to inject gzip metrics into ${filePath}:`, err);
    return false;
  }
}

export function parseBundleManifest(filePath: string): BundleSnapshot | null {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      console.log(`Working directory: ${process.cwd()}`);
      try {
        fs.readdirSync(process.cwd()).forEach((f) => console.log(`  - ${f}`));
      } catch {
        // ignore
      }
      return null;
    }

    const manifest: ManifestData = JSON.parse(
      fs.readFileSync(filePath, 'utf8'),
    );
    const { assets, chunks } = manifest.data.chunkGraph;
    const skipExtensions = ['.js.map', '.css.map', '.ts.map', '.LICENSE.txt'];

    let totalSize = 0;
    let jsSize = 0;
    let cssSize = 0;
    let htmlSize = 0;
    let otherSize = 0;
    let totalGzipSize = 0;
    let jsGzipSize = 0;
    let cssGzipSize = 0;
    let htmlGzipSize = 0;
    let otherGzipSize = 0;
    let hasGzip = false;

    const assetList = assets.reduce((acc: BundleSnapshot['assets'], asset) => {
      if (skipExtensions.some((ext) => asset.path.endsWith(ext))) return acc;

      totalSize += asset.size;
      const gz = measureGzip(asset, filePath);
      if (typeof gz === 'number') {
        totalGzipSize += gz;
        hasGzip = true;
      }

      let kind: 'js' | 'css' | 'html' | 'other' = 'other';
      if (asset.path.endsWith('.js')) {
        kind = 'js';
        jsSize += asset.size;
        if (typeof gz === 'number') jsGzipSize += gz;
      } else if (asset.path.endsWith('.css')) {
        kind = 'css';
        cssSize += asset.size;
        if (typeof gz === 'number') cssGzipSize += gz;
      } else if (asset.path.endsWith('.html')) {
        kind = 'html';
        htmlSize += asset.size;
        if (typeof gz === 'number') htmlGzipSize += gz;
      } else {
        otherSize += asset.size;
        if (typeof gz === 'number') otherGzipSize += gz;
      }

      acc.push({
        path: asset.path,
        size: asset.size,
        gzipSize: gz,
        type: kind,
      });
      return acc;
    }, []);

    const chunkList = chunks.map((c) => ({
      name: c.name,
      size: c.size,
      isInitial: c.initial,
    }));

    return {
      totalSize,
      jsSize,
      cssSize,
      htmlSize,
      otherSize,
      totalGzipSize: hasGzip ? totalGzipSize : undefined,
      jsGzipSize: hasGzip ? jsGzipSize : undefined,
      cssGzipSize: hasGzip ? cssGzipSize : undefined,
      htmlGzipSize: hasGzip ? htmlGzipSize : undefined,
      otherGzipSize: hasGzip ? otherGzipSize : undefined,
      assets: assetList,
      chunks: chunkList,
    };
  } catch (err) {
    console.error(`Failed to parse bundle manifest from ${filePath}:`, err);
    return null;
  }
}

export function readLegacyManifest(filePath: string): LegacySizeData | null {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`Legacy size data not found: ${filePath}`);
      return null;
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!raw.totalSize && raw.files) {
      raw.totalSize = raw.files.reduce(
        (sum: number, f: any) => sum + (f.size || 0),
        0,
      );
    }
    if (
      !raw.totalGzipSize &&
      raw.files?.some((f: any) => typeof f.gzipSize === 'number')
    ) {
      raw.totalGzipSize = raw.files.reduce(
        (sum: number, f: any) => sum + (f.gzipSize || 0),
        0,
      );
    }

    return raw;
  } catch (err) {
    console.error(`Failed to load legacy size data from ${filePath}:`, err);
    return null;
  }
}

export function computeSizeDelta(
  current: number,
  baseline: number,
): { label: string; trend: string } {
  if (!baseline || baseline === 0 || isNaN(baseline)) {
    return { label: '0', trend: '❓' };
  }
  if (isNaN(current)) {
    return { label: '0', trend: '❓' };
  }

  const diff = current - baseline;
  if (diff === 0) return { label: '0', trend: '' };

  const pct = (diff / baseline) * 100;

  if (Math.abs(pct) < 1) {
    return {
      label:
        diff > 0
          ? `+${humanizeBytes(diff)} (${pct.toFixed(1)}%)`
          : `${humanizeBytes(diff)} (${pct.toFixed(1)}%)`,
      trend: '',
    };
  }

  return diff > 0
    ? { label: `+${humanizeBytes(diff)} (+${pct.toFixed(1)}%)`, trend: '📈' }
    : { label: `${humanizeBytes(diff)} (${pct.toFixed(1)}%)`, trend: '📉' };
}

export function hasSizeDrifted(
  current: BundleSnapshot,
  baseline: BundleSnapshot | null,
): boolean {
  if (!baseline) return true;

  const shifted = (a?: number, b?: number): boolean => {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    if (b === 0 || isNaN(b)) return false;
    return a - b !== 0;
  };

  return (
    shifted(current.totalSize, baseline.totalSize) ||
    shifted(current.totalGzipSize, baseline.totalGzipSize)
  );
}

export function renderProjectSection(
  projectName: string,
  filePath: string,
  current: BundleSnapshot,
  baseline?: BundleSnapshot,
  baselineCommit?: string | null,
  baselinePRs?: Array<{ number: number; title: string; url: string }>,
): string {
  let md = `### 📁 ${projectName}\n\n`;
  md += `**Path:** \`${filePath}\`\n\n`;

  if (!baseline) {
    md +=
      '> ⚠️ **No baseline data found** - Unable to perform comparison analysis\n\n';
  } else if (baselineCommit) {
    const link = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/commit/${baselineCommit}`;
    let baselineInfo = `> 📌 **Baseline Commit:** [\`${baselineCommit}\`](${link})`;
    if (baselinePRs && baselinePRs.length > 0) {
      const prLinks = baselinePRs
        .map((pr) => `[#${pr.number}](${redirectGitHubUrl(pr.url)})`)
        .join(', ');
      baselineInfo += ` | **PR:** ${prLinks}`;
    }
    md += `${baselineInfo}\n\n`;
  }

  md += '| Metric | Current | Baseline | Change |\n';
  md += '|--------|---------|----------|--------|\n';
  md += `| 📊 Total Size | ${humanizeBytes(current.totalSize)} | ${baseline ? humanizeBytes(baseline.totalSize) : '-'} | ${baseline ? computeSizeDelta(current.totalSize, baseline.totalSize).label : '-'} |\n`;
  md += `| 🗜️ Gzip Size | ${optionalBytes(current.totalGzipSize)} | ${baseline ? optionalBytes(baseline.totalGzipSize) : '-'} | ${baseline ? optionalDelta(current.totalGzipSize, baseline.totalGzipSize) : '-'} |\n`;
  md += `| 📄 JavaScript | ${humanizeBytes(current.jsSize)} | ${baseline ? humanizeBytes(baseline.jsSize) : '-'} | ${baseline ? computeSizeDelta(current.jsSize, baseline.jsSize).label : '-'} |\n`;
  md += `| 🎨 CSS | ${humanizeBytes(current.cssSize)} | ${baseline ? humanizeBytes(baseline.cssSize) : '-'} | ${baseline ? computeSizeDelta(current.cssSize, baseline.cssSize).label : '-'} |\n`;
  md += `| 🌐 HTML | ${humanizeBytes(current.htmlSize)} | ${baseline ? humanizeBytes(baseline.htmlSize) : '-'} | ${baseline ? computeSizeDelta(current.htmlSize, baseline.htmlSize).label : '-'} |\n`;
  md += `| 📁 Other Assets | ${humanizeBytes(current.otherSize)} | ${baseline ? humanizeBytes(baseline.otherSize) : '-'} | ${baseline ? computeSizeDelta(current.otherSize, baseline.otherSize).label : '-'} |\n`;
  md += '\n';

  return md;
}

export async function emitJobSummary(
  current: BundleSnapshot,
  baseline?: BundleSnapshot,
  flush = true,
  baselineCommit?: string | null,
  baselinePRs?: Array<{ number: number; title: string; url: string }>,
): Promise<void> {
  if (!baseline) {
    await summary
      .addRaw(
        '> ⚠️ **No baseline data found** - Unable to perform comparison analysis\n\n',
      )
      .addSeparator();
  } else {
    if (baselineCommit) {
      const link = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/commit/${baselineCommit}`;
      let info = `> 📌 **Baseline Commit:** [\`${baselineCommit}\`](${link})`;
      if (baselinePRs && baselinePRs.length > 0) {
        const prLinks = baselinePRs
          .map((pr) => `[#${pr.number}](${redirectGitHubUrl(pr.url)})`)
          .join(', ');
        info += ` | **PR:** ${prLinks}`;
      }
      await summary.addRaw(`${info}\n\n`);
    }
    await summary.addSeparator();
  }

  const table = [
    [
      { data: 'Metric', header: true },
      { data: 'Current', header: true },
      { data: 'Baseline', header: true },
      { data: 'Change', header: true },
    ],
    [
      { data: '📊 Total Size', header: false },
      { data: humanizeBytes(current.totalSize), header: false },
      {
        data: baseline
          ? humanizeBytes(baseline.totalSize)
          : humanizeBytes(current.totalSize),
        header: false,
      },
      {
        data: baseline
          ? computeSizeDelta(current.totalSize, baseline.totalSize).label
          : '0',
        header: false,
      },
    ],
    [
      { data: '🗜️ Gzip Size', header: false },
      { data: optionalBytes(current.totalGzipSize), header: false },
      {
        data: baseline
          ? optionalBytes(baseline.totalGzipSize)
          : optionalBytes(current.totalGzipSize),
        header: false,
      },
      {
        data: baseline
          ? optionalDelta(current.totalGzipSize, baseline.totalGzipSize)
          : '0',
        header: false,
      },
    ],
    [
      { data: '📄 JavaScript', header: false },
      { data: humanizeBytes(current.jsSize), header: false },
      {
        data: baseline
          ? humanizeBytes(baseline.jsSize)
          : humanizeBytes(current.jsSize),
        header: false,
      },
      {
        data: baseline
          ? computeSizeDelta(current.jsSize, baseline.jsSize).label
          : '0',
        header: false,
      },
    ],
    [
      { data: '🎨 CSS', header: false },
      { data: humanizeBytes(current.cssSize), header: false },
      {
        data: baseline
          ? humanizeBytes(baseline.cssSize)
          : humanizeBytes(current.cssSize),
        header: false,
      },
      {
        data: baseline
          ? computeSizeDelta(current.cssSize, baseline.cssSize).label
          : '0',
        header: false,
      },
    ],
    [
      { data: '🌐 HTML', header: false },
      { data: humanizeBytes(current.htmlSize), header: false },
      {
        data: baseline
          ? humanizeBytes(baseline.htmlSize)
          : humanizeBytes(current.htmlSize),
        header: false,
      },
      {
        data: baseline
          ? computeSizeDelta(current.htmlSize, baseline.htmlSize).label
          : '0',
        header: false,
      },
    ],
    [
      { data: '📁 Other Assets', header: false },
      { data: humanizeBytes(current.otherSize), header: false },
      {
        data: baseline
          ? humanizeBytes(baseline.otherSize)
          : humanizeBytes(current.otherSize),
        header: false,
      },
      {
        data: baseline
          ? computeSizeDelta(current.otherSize, baseline.otherSize).label
          : '0',
        header: false,
      },
    ],
  ];

  await summary.addTable(table).addSeparator();
  await summary.addSeparator();

  if (flush) {
    await summary.write();
  }

  console.log('Bundle analysis summary written');
}

export async function emitLegacySizeReport(
  current: LegacySizeData,
  baseline?: LegacySizeData,
): Promise<void> {
  const table = [
    [
      { data: 'Metric', header: true },
      { data: 'Current', header: true },
      { data: 'Baseline', header: true },
    ],
    [
      { data: '📊 Total Size', header: false },
      { data: humanizeBytes(current.totalSize), header: false },
      {
        data: baseline ? humanizeBytes(baseline.totalSize) : '0',
        header: false,
      },
    ],
  ];

  if (
    typeof current.totalGzipSize === 'number' ||
    typeof baseline?.totalGzipSize === 'number'
  ) {
    table.push([
      { data: '🗜️ Gzip Size', header: false },
      { data: optionalBytes(current.totalGzipSize), header: false },
      {
        data: baseline ? optionalBytes(baseline.totalGzipSize) : '0',
        header: false,
      },
    ]);
  }

  await summary.addTable(table).addSeparator();

  if (current.files && current.files.length > 0) {
    await summary.addHeading('📄 File Details', 3);

    const hasFileGzip = current.files.some(
      (f) => typeof f.gzipSize === 'number',
    );
    const fileTable: Array<Array<{ data: string; header: boolean }>> = [
      [
        { data: 'File', header: true },
        { data: 'Size', header: true },
        ...(hasFileGzip ? [{ data: 'Gzip Size', header: true }] : []),
      ],
    ];

    for (const f of current.files) {
      fileTable.push([
        { data: f.path, header: false },
        { data: humanizeBytes(f.size), header: false },
        ...(hasFileGzip
          ? [{ data: optionalBytes(f.gzipSize), header: false }]
          : []),
      ]);
    }

    await summary.addTable(fileTable);
  }

  await summary.addSeparator();
  await summary.write();

  console.log('Legacy size report written');
}

export interface PRCommentOptions {
  reports: Array<{
    projectName: string;
    filePath: string;
    current: BundleSnapshot | null;
    baseline: BundleSnapshot | null;
    baselineCommit?: string | null;
    baselinePRs?: Array<{ number: number; title: string; url: string }>;
    diffHtmlArtifactId?: number;
    baselineUsedFallback?: boolean;
    baselineLatestCommit?: string;
    intelligence?: { analysis: string; model: string } | null;
  }>;
}

export function buildPRComment(opts: PRCommentOptions): string {
  const { reports } = opts;
  let body = '## Rsdoctor Bundle Diff Analysis\n\n';

  const withCurrent = reports.filter((r) => r.current);

  const first = withCurrent[0];
  if (first?.baselineUsedFallback && first?.baselineLatestCommit) {
    body += `> ⚠️ **Note:** The latest commit (\`${first.baselineLatestCommit}\`) does not have baseline artifacts. Using commit \`${first.baselineCommit}\` for baseline comparison instead. If this seems incorrect, please wait a few minutes and try rerunning the workflow.\n\n`;
  }

  if (withCurrent.length > 1) {
    const changed = withCurrent.filter(
      (r) => r.current && hasSizeDrifted(r.current, r.baseline),
    ).length;
    const word = withCurrent.length === 1 ? 'project' : 'projects';
    const cword = changed === 1 ? 'project' : 'projects';
    body += `Found ${withCurrent.length} ${word} in monorepo, ${changed} ${cword} with changes.\n\n`;
  }

  if (withCurrent.length > 0) {
    const anyChanged = withCurrent.some(
      (r) => r.current && hasSizeDrifted(r.current, r.baseline),
    );
    const detailsOpen = anyChanged ? '<details open>\n' : '<details>\n';
    body += `${detailsOpen}<summary><b>📊 Quick Summary</b></summary>\n\n`;
    body += '| Project | Total Size | Gzip Size | Change | Gzip Change |\n';
    body += '|---------|------------|-----------|--------|-------------|\n';

    for (const r of withCurrent) {
      if (!r.current) continue;
      const sizeStr = humanizeBytes(r.current.totalSize);
      const gzStr =
        typeof r.current.totalGzipSize === 'number'
          ? humanizeBytes(r.current.totalGzipSize)
          : '-';
      const delta = r.baseline
        ? computeSizeDelta(r.current.totalSize, r.baseline.totalSize)
        : { label: '-', trend: '' };
      const gzDelta =
        typeof r.current.totalGzipSize === 'number' &&
        typeof r.baseline?.totalGzipSize === 'number'
          ? computeSizeDelta(r.current.totalGzipSize, r.baseline.totalGzipSize)
          : { label: '-', trend: '' };

      body += `| ${r.projectName} | ${sizeStr} | ${gzStr} | ${delta.trend} ${delta.label} | ${gzDelta.trend} ${gzDelta.label} |\n`;
    }

    body += '\n</details>\n\n';
  }

  const changed = reports.filter(
    (r) => r.current && hasSizeDrifted(r.current, r.baseline),
  );

  if (changed.length > 0) {
    body +=
      '<details>\n<summary><b>📋 Detailed Reports</b> (Click to expand)</summary>\n\n';

    for (const r of changed) {
      body += renderProjectSection(
        r.projectName,
        r.filePath,
        r.current!,
        r.baseline || undefined,
        r.baselineCommit,
        r.baselinePRs,
      );

      if (r.diffHtmlArtifactId) {
        const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
        const repository = process.env.GITHUB_REPOSITORY || '';
        const runId = process.env.GITHUB_RUN_ID || '';
        const link = `${serverUrl}/${repository}/actions/runs/${runId}/artifacts/${r.diffHtmlArtifactId}`;
        body += `\n📦 **Download Diff Report**: [${r.projectName} Bundle Diff](${link})\n\n`;
      }
    }

    if (changed.length > 1) {
      body += '</details>\n\n';
    }
  }

  const withIntelligence = reports.filter((r) => r.intelligence);
  if (withIntelligence.length > 0) {
    body +=
      '<details>\n<summary><b>🤖 AI Degradation Analysis</b> (Click to expand)</summary>\n\n';
    for (const r of withIntelligence) {
      if (!r.intelligence) continue;
      if (withIntelligence.length > 1) {
        body += `#### 📁 ${r.projectName}\n\n`;
      }
      body += r.intelligence.analysis + '\n\n';
      body += `<sub>Analysis by ${r.intelligence.model}</sub>\n\n`;
    }
    body += '</details>\n\n';
  }

  body +=
    '*Generated by [Rsdoctor GitHub Action](https://rsdoctor.rs/guide/start/action)*';
  return body;
}
