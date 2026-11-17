import { createHash, randomUUID, sign, verify } from 'node:crypto';
import { constants, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [exportDir, destination, manifestEndpoint] = process.argv.slice(2);
if (!exportDir || !destination) {
  throw new Error('Usage: node scripts/prepare-android-update.mjs <expo-export-dir> <publication-dir> [manifest-endpoint]');
}
const { expo: config } = JSON.parse(readFileSync('app.json', 'utf8'));
const url = new URL(manifestEndpoint || config.updates.url);
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '10.0.2.2')) {
  throw new Error('The update service must use HTTPS outside Android emulator testing');
}
const privateKey = readFileSync('.local/hku-walk-android-signing/ota/private-key.pem');
const certificate = readFileSync(config.updates.codeSigningCertificate);
const { fileMetadata } = JSON.parse(readFileSync(path.join(exportDir, 'metadata.json'), 'utf8'));
const android = fileMetadata.android;
const assetDir = path.join(destination, 'assets');
mkdirSync(assetDir, { recursive: true });

const contentTypes = {
  hbc: 'application/javascript', js: 'application/javascript', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json',
};

function asset(file, extension) {
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error('Invalid exported asset extension');
  const source = path.join(exportDir, file.replaceAll('\\', '/'));
  const checksum = createHash('sha256').update(readFileSync(source)).digest();
  const filename = `${checksum.toString('hex')}.${extension}`;
  try {
    copyFileSync(source, path.join(assetDir, filename), constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return {
    hash: checksum.toString('base64url'),
    key: path.basename(source, path.extname(source)),
    fileExtension: `.${extension}`,
    contentType: contentTypes[extension] || 'application/octet-stream',
    url: new URL(`../assets/${filename}`, url).href,
  };
}

const id = randomUUID();
const manifest = JSON.stringify({
  id,
  createdAt: new Date().toISOString(),
  runtimeVersion: config.version,
  launchAsset: asset(android.bundle, path.extname(android.bundle).slice(1)),
  assets: android.assets.map(({ path: file, ext }) => asset(file, ext)),
  metadata: {},
  extra: { expoClient: { name: config.name, slug: config.slug, version: config.version } },
});
const bytes = Buffer.from(manifest);
const signature = sign('sha256', bytes, privateKey);
if (!verify('sha256', bytes, certificate, signature)) {
  throw new Error('The update signing key does not match the certificate bundled in the APK');
}
const descriptor = path.join(destination, `android-${config.version}.json`);
const pending = `${descriptor}.${id}.tmp`;
writeFileSync(pending, JSON.stringify({
  id,
  signature: `sig="${signature.toString('base64')}", keyid="main", alg="rsa-v1_5-sha256"`,
  manifest,
}), { flag: 'wx' });
renameSync(pending, descriptor);
console.log(`Signed Android update ${id} for ${config.version}`);
