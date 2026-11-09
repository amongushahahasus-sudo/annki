import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const paths = (await files('dist')).filter(path => !path.endsWith('/sw.js')).sort();
const hash = createHash('sha256');
for (const path of paths) hash.update(await readFile(path));
hash.update(await readFile('public/sw.js'));
const id = hash.digest('hex').slice(0, 12);
const precache = ['./', ...paths.map(path => `./${relative('dist', path)}`)];
let source = await readFile('public/sw.js', 'utf8');
source = source.replace("'akasheet-shell-v1'", `'akasheet-shell-${id}'`);
source = source.replace("['.', 'icon.svg', 'manifest.webmanifest', 'sample.pdf']", JSON.stringify(precache));
await writeFile('dist/sw.js', source);
console.log(`Offline cache prepared: ${paths.length} local files (${id})`);
