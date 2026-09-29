import { promises as fsp } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const manifestPath = req.resolve('@rsdoctor/client/package.json');
const pkgRoot = dirname(manifestPath);
const buildDir = join(pkgRoot, 'dist');
const destRoot = resolve(
  process.cwd(),
  'dist',
  'node_modules',
  '@rsdoctor',
  'client',
);

function extractAssetRefs(html) {
  const refs = [];
  for (const attr of ['src="', "src='", 'href="', "href='"]) {
    const closing = attr.at(-1);
    let cursor = 0;
    while ((cursor = html.indexOf(attr, cursor)) !== -1) {
      cursor += attr.length;
      const end = html.indexOf(closing, cursor);
      if (end === -1) break;
      const val = html.slice(cursor, end);
      if (
        val &&
        !val.startsWith('http') &&
        !val.startsWith('//') &&
        !val.startsWith('data:')
      ) {
        refs.push(val);
      }
    }
  }
  return refs;
}

async function copyFile(src, dest) {
  await fsp.mkdir(dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

async function main() {
  await fsp.rm(destRoot, { recursive: true, force: true });
  await fsp.mkdir(destRoot, { recursive: true });

  await fsp.copyFile(manifestPath, join(destRoot, 'package.json'));

  const diffHtmlSrc = join(buildDir, 'diff.html');
  const htmlContent = await fsp.readFile(diffHtmlSrc, 'utf8');
  const assetRefs = extractAssetRefs(htmlContent);

  const filesToCopy = [
    diffHtmlSrc,
    ...assetRefs.map((ref) => join(buildDir, ref)),
  ];

  for (const srcPath of filesToCopy) {
    const rel = relative(pkgRoot, srcPath);
    if (rel.startsWith('..')) {
      throw new Error(
        `Refusing to copy asset outside @rsdoctor/client: ${srcPath}`,
      );
    }
    await copyFile(srcPath, join(destRoot, rel));
  }

  console.log(`Copied @rsdoctor/client assets to ${destRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
