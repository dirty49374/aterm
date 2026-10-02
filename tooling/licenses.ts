import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type Package = { name: string; version: string; license?: string; repository?: unknown };

async function owner(file: string): Promise<{ directory: string; manifest: Package } | undefined> {
  let directory = dirname(await realpath(file));
  const workspace = resolve('.');
  while (directory !== workspace && dirname(directory) !== directory) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name && manifest.version) return { directory, manifest };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    directory = dirname(directory);
  }
  return undefined;
}

// esbuild inputs identify the packages actually bundled, including transitive imports.
export async function publishLicenses(inputs: Iterable<string>): Promise<void> {
  const packages = new Map<string, { directory: string; manifest: Package }>();
  for (const input of inputs) {
    if (!input.includes('node_modules/')) continue;
    const found = await owner(input);
    if (!found) throw new Error(`No package metadata for bundled dependency: ${input}`);
    packages.set(`${found.manifest.name}@${found.manifest.version}`, found);
  }
  const destination = 'packages/core/webapp/licenses';
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const inventory = [];
  for (const [identity, { directory, manifest }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter(
        (file) =>
          file.isFile() && /^(licen[cs]e|notice|copying|copyright)([._-]|$)/i.test(file.name),
      )
      .map((file) => file.name)
      .sort();
    if (!files.some((file) => /^(licen[cs]e|copying)([._-]|$)/i.test(file))) {
      throw new Error(`Bundled package has no license file: ${identity}`);
    }
    const folder = identity.replaceAll('/', '__');
    await mkdir(join(destination, folder), { recursive: true });
    for (const file of files) await cp(join(directory, file), join(destination, folder, file));
    inventory.push({
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? 'See included license file',
      repository: manifest.repository,
      files: files.map((file) => `${folder}/${file}`),
    });
  }
  await writeFile(join(destination, 'packages.json'), JSON.stringify(inventory, null, 2) + '\n');
  for (const target of ['packages/core', 'packages/cli']) {
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(file, join(target, file));
  }
}
