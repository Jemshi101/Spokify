// Builds the store uploads into release/:
//   spokify-X.Y.Z-store.zip   upload to the Chrome Web Store and Opera add-ons (same file)
//   spokify-X.Y.Z-source.zip  source for Opera's reviewers (they ask for it when code is bundled)
// The store zip drops the manifest "key": the Chrome Web Store rejects uploads that carry one, and
// each store assigns its own extension id. Local builds (dist/) keep the key so the id stays pinned.
// Usage: npm run package
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
if (manifest.version !== version) {
  throw new Error(`static/manifest.json is ${manifest.version} but package.json is ${version}`);
}

const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim();
if (dirty) console.warn('⚠️  Uncommitted changes: the source zip is taken from HEAD and will not include them.\n' + dirty + '\n');

run('node', ['build.mjs']);

const out = path.resolve('release');
const stage = path.join(out, 'store');
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync('dist', stage, { recursive: true });

const storeManifest = JSON.parse(readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
delete storeManifest.key;
writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(storeManifest, null, 2) + '\n');

const storeZip = path.join(out, `spokify-${version}-store.zip`);
run('zip', ['-qr', '-X', storeZip, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: stage });

const sourceZip = path.join(out, `spokify-${version}-source.zip`);
run('git', ['archive', '--format=zip', `--prefix=spokify-${version}-source/`, '-o', sourceZip, 'HEAD']);

rmSync(stage, { recursive: true, force: true });

const size = (f) => `${(readFileSync(f).length / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n${path.relative('.', storeZip)}  ${size(storeZip)}`);
console.log(`${path.relative('.', sourceZip)}  ${size(sourceZip)}`);
if (!existsSync('store/images')) console.log('Store images: run `npm run store-images`.');
