import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outpaint-security-'));
const originalNodeEnv = process.env.NODE_ENV;
const originalDataDir = process.env.OUTPAINT_DATA_DIR;
process.env.NODE_ENV = 'production';
process.env.OUTPAINT_DATA_DIR = tempDir;

try {
  const [{ requireUser }, { storageForUser }] = await Promise.all([
    import('../lib/requestAuth.js'),
    import('../lib/storage.js'),
  ]);
  const response = () => ({
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
  });
  const request = (cookie) => ({
    socket: { remoteAddress: '127.0.0.1' },
    headers: cookie ? { cookie } : {},
  });

  const firstResponse = response();
  const alice = await requireUser(request(), firstResponse);
  assert.match(alice.id, /^[a-f0-9]{64}$/);
  const setCookie = firstResponse.headers['Set-Cookie'];
  assert.match(setCookie, /^__Host-outpaint_session=[A-Za-z0-9_-]{43}; Path=\/;/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) {
    assert.ok(setCookie.includes(flag));
  }
  const aliceCookie = setCookie.split(';')[0];
  const repeatedResponse = response();
  assert.deepEqual(await requireUser(request(`other=1; ${aliceCookie}`), repeatedResponse), alice);
  assert.equal(repeatedResponse.headers['Set-Cookie'].split(';')[0], aliceCookie);

  const bobResponse = response();
  const bob = await requireUser(request(), bobResponse);
  assert.notEqual(bob.id, alice.id);
  const invalidResponse = response();
  const invalid = await requireUser(request('__Host-outpaint_session=invalid'), invalidResponse);
  assert.notEqual(invalid.id, alice.id);
  assert.ok(invalidResponse.headers['Set-Cookie']);

  process.env.NODE_ENV = 'development';
  assert.deepEqual(await requireUser(request(), response()), { id: 'local', local: true });
  process.env.NODE_ENV = 'production';

  const aliceStorage = storageForUser(alice);
  const bobStorage = storageForUser(bob);
  await aliceStorage.writeFile('outpaint-studio/board.json', 'alice board');
  assert.equal(await aliceStorage.readFile('outpaint-studio/board.json', 'utf8'), 'alice board');
  await assert.rejects(bobStorage.readFile('outpaint-studio/board.json', 'utf8'), { code: 'ENOENT' });
  assert.throws(() => aliceStorage.readFile('../outside', 'utf8'), /Invalid storage key/);
  assert.throws(() => storageForUser({ id: '../outside' }), /Invalid user/);

  const legacy = path.join(tempDir, 'legacy', 'outpaint-studio');
  const persistent = path.join(tempDir, 'persistent');
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'board.json'), 'legacy board');
  const importArgs = ['scripts/import-legacy-data.mjs', legacy, bob.id];
  const importOptions = {
    cwd: process.cwd(),
    env: { ...process.env, OUTPAINT_DATA_DIR: persistent },
    encoding: 'utf8',
  };
  assert.equal(spawnSync(process.execPath, importArgs, importOptions).status, 0);
  const importedBoard = path.join(persistent, 'users', bob.id, 'outpaint-studio', 'board.json');
  assert.equal(await fs.readFile(importedBoard, 'utf8'), 'legacy board');
  assert.notEqual(spawnSync(process.execPath, importArgs, importOptions).status, 0);
  assert.equal(await fs.readFile(importedBoard, 'utf8'), 'legacy board');

  console.log('Security checks passed');
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDataDir === undefined) delete process.env.OUTPAINT_DATA_DIR;
  else process.env.OUTPAINT_DATA_DIR = originalDataDir;
  const absoluteTemp = path.resolve(tempDir);
  if (!absoluteTemp.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    || !path.basename(absoluteTemp).startsWith('outpaint-security-')) {
    throw new Error('Unsafe temporary directory');
  }
  await fs.rm(absoluteTemp, { recursive: true, force: true });
}
