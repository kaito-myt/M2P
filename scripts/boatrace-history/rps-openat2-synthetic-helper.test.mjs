import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sourcePath = fileURLToPath(new URL('./rps-openat2-synthetic-helper.c', import.meta.url));
const linuxOnly = process.platform === 'linux';

test('openat2 synthetic fixture reader enforces dirfd containment, identity, and byte bounds', {skip: !linuxOnly && 'Linux openat2 is required; unsupported platforms fail closed'}, async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'rps-openat2-fixture-'));
  t.after(() => rm(work, {recursive: true, force: true}));
  const root = path.join(work, 'root');
  await mkdir(path.join(root, 'nested'), {recursive: true});
  const payload = Buffer.from('synthetic bytes only\n');
  const fixture = path.join(root, 'nested', 'sample.json');
  await writeFile(fixture, payload);
  const {dev, ino} = await import('node:fs/promises').then(fs => fs.stat(root, {bigint: true}));

  const binary = path.join(work, 'rps-openat2-synthetic-helper');
  const compile = spawnSync('cc', ['-std=c11', '-O2', sourcePath, '-lcrypto', '-o', binary], {encoding: 'utf8'});
  assert.equal(compile.status, 0, `compile failed: ${compile.stderr}`);

  const invoke = (relativePath, options = {}) => {
    const args = [
      '--synthetic-fixture',
      '--root', options.root ?? root,
      '--expected-dev', String(options.expectedDev ?? dev),
      '--expected-ino', String(options.expectedIno ?? ino),
      '--expected-uid', String(options.expectedUid ?? process.getuid()),
      '--relative-path', relativePath,
      '--max-bytes', String(options.maxBytes ?? 1024),
      '--max-wall-ms', String(options.maxWallMs ?? 5000),
      '--max-address-bytes', String(options.maxAddressBytes ?? 268435456),
    ];
    if (options.blockingOpen) args.push('--synthetic-test-blocking-open', '1');
    return spawnSync(binary, args, {encoding: 'utf8', timeout: options.parentTimeoutMs, killSignal: 'SIGKILL'});
  };

  const success = invoke('nested/sample.json');
  assert.equal(success.status, 0, success.stderr);
  const receipt = JSON.parse(success.stdout);
  assert.deepEqual(receipt, {
    mode: 'SYNTHETIC_ONLY',
    bytes: String(payload.byteLength),
    sha256: createHash('sha256').update(payload).digest('hex'),
  });
  assert.equal(success.stdout.includes(payload.toString()), false, 'raw fixture bytes must not be emitted');

  for (const relativePath of ['/etc/passwd', '../outside', 'nested/../sample.json', 'nested//sample.json', 'nested/./sample.json']) {
    const rejected = invoke(relativePath);
    assert.notEqual(rejected.status, 0, `unexpected acceptance: ${relativePath}`);
    assert.match(rejected.stderr, /PATH_OR_TYPE|SYNTHETIC_MODE_REQUIRED/);
  }

  const outside = path.join(work, 'outside.json');
  await writeFile(outside, 'outside');
  await symlink(outside, path.join(root, 'nested', 'linked.json'));
  const symlinkRejected = invoke('nested/linked.json');
  assert.notEqual(symlinkRejected.status, 0);
  assert.match(symlinkRejected.stderr, /PATH_OR_TYPE/);

  const outsideDir = path.join(work, 'outside-dir');
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, 'escape.json'), 'escape');
  await symlink(outsideDir, path.join(root, 'nested', 'linked-dir'));
  const parentSymlinkRejected = invoke('nested/linked-dir/escape.json');
  assert.notEqual(parentSymlinkRejected.status, 0);
  assert.match(parentSymlinkRejected.stderr, /PATH_OR_TYPE/);

  const rootLink = path.join(work, 'root-link');
  await symlink(root, rootLink);
  const rootSymlinkRejected = invoke('nested/sample.json', {root: rootLink});
  assert.notEqual(rootSymlinkRejected.status, 0);
  assert.match(rootSymlinkRejected.stderr, /ROOT_OPEN_FAILED/);

  const wrongIdentity = invoke('nested/sample.json', {expectedIno: ino + 1n});
  assert.notEqual(wrongIdentity.status, 0);
  assert.match(wrongIdentity.stderr, /ROOT_IDENTITY_MISMATCH/);

  const wrongOwner = invoke('nested/sample.json', {expectedUid: process.getuid() + 1});
  assert.notEqual(wrongOwner.status, 0);
  assert.match(wrongOwner.stderr, /PATH_OR_TYPE/);

  const oversize = invoke('nested/sample.json', {maxBytes: payload.byteLength - 1});
  assert.notEqual(oversize.status, 0);
  assert.match(oversize.stderr, /PATH_OR_TYPE/);

  const noSyntheticMode = spawnSync(binary, ['--root', root], {encoding: 'utf8'});
  assert.notEqual(noSyntheticMode.status, 0);
  assert.match(noSyntheticMode.stderr, /SYNTHETIC_MODE_REQUIRED/);

  const fifo = path.join(root, 'blocked.fifo');
  const fifoCreate = spawnSync('mkfifo', [fifo], {encoding: 'utf8'});
  assert.equal(fifoCreate.status, 0, `mkfifo failed: ${fifoCreate.stderr}`);

  const selfTimedOut = invoke('blocked.fifo', {blockingOpen: true, maxWallMs: 100, parentTimeoutMs: 1500});
  assert.equal(selfTimedOut.signal, 'SIGALRM', `helper deadline did not stop blocked open: ${selfTimedOut.stderr}`);
  assert.notEqual(selfTimedOut.error?.code, 'ETIMEDOUT', 'outer process timeout should not be the active limit here');

  const parentTimedOut = invoke('blocked.fifo', {blockingOpen: true, maxWallMs: 10000, parentTimeoutMs: 150});
  assert.equal(parentTimedOut.error?.code, 'ETIMEDOUT', 'parent must hard-kill a stalled helper process');
});
