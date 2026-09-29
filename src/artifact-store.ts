import path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

export const ARTIFACT_PREFIX = 'rsdoctor';

export function fingerprintPath(pathParts: string[], baseName: string): string {
  const combined = `${pathParts.join('-')}-${baseName}`;
  return createHash('sha256').update(combined).digest('hex').substring(0, 8);
}

export function buildArtifactKey(
  fingerprint: string,
  commitRef: string,
): string {
  return `${ARTIFACT_PREFIX}-${fingerprint}-${commitRef}`;
}

export function toShortSha(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.substring(0, 10) : sha;
}

export async function uploadArtifact(filePath: string, commitHash?: string) {
  const { DefaultArtifactClient } = await import(
    /* webpackChunkName: "actions-artifact" */ '@actions/artifact'
  );
  const client = new DefaultArtifactClient();

  const ref = toShortSha(
    commitHash ||
      execSync('git rev-parse --short=10 HEAD', { encoding: 'utf8' }).trim(),
  );

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Artifact source file not found: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const relative = path.relative(process.cwd(), filePath);
  const parts = relative.split(path.sep);
  const nameWithoutExt = path.parse(fileName).name;

  const fp = fingerprintPath(parts, nameWithoutExt);
  const artifactName = buildArtifactKey(fp, ref);

  console.log(`Uploading artifact: ${artifactName}`);
  console.log(`Source file: ${filePath}`);

  return client.uploadArtifact(
    artifactName,
    [filePath],
    path.dirname(filePath),
  );
}
