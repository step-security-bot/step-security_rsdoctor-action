import path from 'path';
import * as fs from 'fs';
import { getInput } from '@actions/core';
import { ActionsClient } from './octokit-client';
import * as yauzl from 'yauzl';
import {
  fingerprintPath,
  buildArtifactKey,
  toShortSha,
  ARTIFACT_PREFIX,
} from './artifact-store';

const ZIP_TIMEOUT_MS = 30_000;

type ZipOpener = (
  buffer: Buffer,
  options: yauzl.Options,
  callback: (err: Error | null, zip: yauzl.ZipFile) => void,
) => void;

function entryMatches(entryName: string, target: string): boolean {
  return entryName === target || entryName.endsWith(`/${target}`);
}

export function extractZipEntry(
  zipBuffer: Buffer,
  targetFile: string,
  timeoutMs = ZIP_TIMEOUT_MS,
  opener: ZipOpener = yauzl.fromBuffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let done = false;
    let zip: yauzl.ZipFile | undefined;

    const settle = (err?: Error, data?: Buffer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (zip?.isOpen) zip.close();
      if (err) reject(err);
      else if (data) resolve(data);
      else reject(new Error(`Entry ${targetFile} could not be read from zip`));
    };

    const timer = setTimeout(
      () =>
        settle(
          new Error(
            `Zip extraction timed out after ${timeoutMs}ms for ${targetFile}`,
          ),
        ),
      timeoutMs,
    );

    opener(zipBuffer, { lazyEntries: true }, (openErr, opened) => {
      if (openErr) {
        settle(openErr);
        return;
      }

      zip = opened;
      zip.once('error', settle);
      zip.once('end', () =>
        settle(new Error(`Entry ${targetFile} not found in zip`)),
      );

      zip.on('entry', (entry) => {
        if (!entryMatches(entry.fileName, targetFile)) {
          zip?.readEntry();
          return;
        }

        zip?.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) {
            settle(streamErr);
            return;
          }

          const parts: Buffer[] = [];
          stream.once('error', settle);
          stream.on('data', (chunk: Buffer | string) => {
            parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          stream.once('end', () => settle(undefined, Buffer.concat(parts)));
        });
      });

      zip.readEntry();
    });
  });
}

export async function fetchArtifactById(
  artifactId: number,
  fileName: string,
  client?: ActionsClient,
) {
  console.log(`Fetching artifact ID: ${artifactId}`);

  const activeClient =
    client ?? new ActionsClient(getInput('github_token', { required: true }));

  const zipData = await activeClient.downloadArtifactZip(artifactId);
  const zipBuffer = Buffer.from(zipData);
  console.log(`Downloaded zip (${zipBuffer.length} bytes)`);

  const fileBuffer = await extractZipEntry(zipBuffer, fileName);
  const fileContent = fileBuffer.toString('utf-8');
  const parsed = JSON.parse(fileContent);

  const tempDir = path.join(process.cwd(), 'temp-artifact', String(artifactId));
  await fs.promises.rm(tempDir, { recursive: true, force: true });
  await fs.promises.mkdir(tempDir, { recursive: true });

  const destPath = path.join(tempDir, fileName);
  await fs.promises.writeFile(destPath, fileBuffer);

  console.log(`Extracted to: ${destPath}`);

  return { downloadPath: tempDir, jsonData: parsed };
}

export async function resolveAndFetchBaseline(
  sha: string,
  fileName: string,
  filePath: string,
) {
  if (!filePath)
    throw new Error('filePath is required for baseline resolution');

  console.log(`Resolving baseline artifact for commit: ${sha}`);

  const client = new ActionsClient(
    getInput('github_token', { required: true }),
  );

  const relative = path.relative(process.cwd(), filePath);
  const parts = relative.split(path.sep);
  const baseName = path.parse(fileName).name;
  const fp = fingerprintPath(parts, baseName);
  const shortCommit = toShortSha(sha);
  const primaryName = buildArtifactKey(fp, shortCommit);

  const compatibleNames = new Set([
    primaryName,
    buildArtifactKey(fp, sha),
    `${fp}-${shortCommit}`,
    `${fp}-${shortCommit}${path.parse(fileName).ext}`,
    `${fp}-${sha}`,
    `${fp}-${sha}${path.parse(fileName).ext}`,
  ]);

  console.log(`Searching for artifact: ${primaryName}`);
  console.log(`  Fingerprint: ${fp}, commit: ${shortCommit}`);

  const runs = await client.findAllRunsForCommit(sha);
  let artifact: any = null;
  let allArtifacts: any = null;

  if (runs.length > 0) {
    console.log(`Found ${runs.length} workflow run(s) for commit ${sha}`);

    for (const run of runs) {
      console.log(`Checking run ${run.id} (${run.name || 'unnamed'})`);

      try {
        const runArts = await client.listRunArtifacts(run.id);
        const match = runArts.artifacts?.find((a: any) =>
          compatibleNames.has(a.name),
        );

        if (match) {
          artifact = match;
          allArtifacts = runArts;
          console.log(
            `Found artifact in run ${run.id}: ${artifact.name} (ID: ${artifact.id})`,
          );
          break;
        } else {
          const names =
            runArts.artifacts?.map((a: any) => a.name).join(', ') || 'none';
          console.log(`  Not found. Available: ${names}`);
        }
      } catch (err) {
        console.warn(`  Could not fetch artifacts for run ${run.id}: ${err}`);
      }
    }
  }

  if (!artifact) {
    console.log('Falling back to full repository artifact listing...');
    allArtifacts = await client.listAllRepoArtifacts();
    artifact = allArtifacts.artifacts?.find((a: any) =>
      compatibleNames.has(a.name),
    );
  }

  if (!artifact) {
    const available =
      allArtifacts?.artifacts?.map((a: any) => a.name).join(', ') || '';
    console.log(`No artifact found matching: ${primaryName}`);
    if (available) console.log(`Available: ${available}`);
    throw new Error(`No baseline artifact found matching: ${primaryName}`);
  }

  console.log(`Downloading artifact: ${artifact.name} (ID: ${artifact.id})`);

  return fetchArtifactById(artifact.id, fileName, client);
}
