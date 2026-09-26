import fs from 'fs/promises';
import path from 'path';

const [sourceArgument, storageId] = process.argv.slice(2);
const dataArgument = process.env.OUTPAINT_DATA_DIR;
if (!sourceArgument || !/^[a-f0-9]{64}$/.test(storageId || '') || !dataArgument) {
  throw new Error('Usage: OUTPAINT_DATA_DIR=<persistent dir> node scripts/import-legacy-data.mjs <old outpaint-studio dir> <storage id from /api/account>');
}

const source = path.resolve(sourceArgument);
const dataDir = path.resolve(dataArgument);
const userDir = path.join(dataDir, 'users', storageId);
const destination = path.join(userDir, 'outpaint-studio');

if (!(await fs.stat(source)).isDirectory()) throw new Error('Source is not a directory');
await fs.access(path.join(source, 'board.json'));
try {
  await fs.access(destination);
  throw new Error('Destination already exists; import cancelled');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

await fs.mkdir(userDir, { recursive: true });
const stagingDir = await fs.mkdtemp(path.join(userDir, '.import-'));
const stagedBoard = path.join(stagingDir, 'outpaint-studio');
await fs.cp(source, stagedBoard, { recursive: true, errorOnExist: true, force: false });
await fs.rename(stagedBoard, destination);
await fs.rmdir(stagingDir);
console.log(`Imported board to ${destination}`);
