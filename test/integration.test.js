// End-to-end tests against a throwaway sshd on localhost. The "remote" is this
// machine, so local and remote ports must differ. Skipped if sshd is missing.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { isPortListening } from '../src/ports.js';
import { BIN, runFwd } from './helpers/cli.js';
import { freePort, SSHD, startSshd } from './helpers/sshd.js';

const skip = !SSHD || process.env.FWD_SKIP_INTEGRATION ? 'sshd not available' : false;

describe('integration', { skip }, () => {
  /** @type {Awaited<ReturnType<typeof startSshd>>} */
  let sshd;
  /** @type {http.Server} */
  let server;
  /** @type {string} */
  let dir;
  /** @type {number} */
  let remote;
  /** @type {(args: string[]) => ReturnType<typeof runFwd>} */
  let fwd;

  before(async () => {
    sshd = await startSshd();
    dir = await mkdtemp(join(tmpdir(), 'fwd-int-'));
    remote = await freePort();
    server = http.createServer((_req, res) => res.end('hello from remote'));
    server.listen(remote, '127.0.0.1');
    await once(server, 'listening');
    fwd = (args) => runFwd([...args, '--host', sshd.host], { FWD_CONFIG_DIR: dir, FWD_SSH: sshd.sshWrapper });
  });

  after(async () => {
    await fwd?.(['down']);
    server?.close();
    await sshd?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /**
   * A fresh connection per request: cancelling a forward closes the listener
   * but not connections that are already open, so pooling would hide it.
   * @param {number} port
   * @returns {Promise<string>}
   */
  function get(port) {
    return new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, agent: false }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
  }

  /** @returns {Promise<{ master: { alive: boolean, pid: number | null }, forwards: { direction: string, local: number, status: string }[] }>} */
  async function ls() {
    const { code, stdout, stderr } = await fwd(['ls', '--json']);
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout);
  }

  /** @param {{ code: number, stdout: string, stderr: string }} result */
  function ok(result) {
    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    return result;
  }

  test('add starts the master and forwards traffic; rm stops it', async () => {
    const local = await freePort();
    const added = ok(await fwd(['add', `${local}:${remote}`]));
    assert.match(added.stdout, /Started SSH master/);
    assert.equal(await get(local), 'hello from remote');

    const listing = await ls();
    assert.equal(listing.master.alive, true);
    assert.deepEqual(listing.forwards.map((f) => [f.local, f.status]), [[local, 'active']]);

    ok(await fwd(['rm', String(local)]));
    await assert.rejects(get(local));
    assert.deepEqual((await ls()).forwards, []);
  });

  test('adding an active forward again is a no-op', async () => {
    const local = await freePort();
    ok(await fwd(['add', `${local}:${remote}`]));
    const again = ok(await fwd(['add', `${local}:${remote}`]));
    assert.match(again.stdout, /Already forwarding/);
    ok(await fwd(['rm', String(local)]));
  });

  test('a port that is already in use is reported clearly', async () => {
    const busy = await freePort();
    const blocker = http.createServer().listen(busy, '127.0.0.1');
    await once(blocker, 'listening');
    try {
      const result = await fwd(['add', `${busy}:${remote}`]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`Local port ${busy} is already in use`));
      assert.deepEqual((await ls()).forwards, []);
    } finally {
      blocker.close();
    }
  });

  test('down keeps saved forwards and up restores them', async () => {
    const a = await freePort();
    const b = await freePort();
    ok(await fwd(['add', `${a}:${remote}`]));
    ok(await fwd(['add', `${b}:${remote}`]));

    ok(await fwd(['down']));
    await assert.rejects(get(a));
    const down = await ls();
    assert.equal(down.master.alive, false);
    assert.deepEqual(down.forwards.map((f) => f.status), ['down', 'down']);

    const up = ok(await fwd(['up']));
    assert.match(up.stdout, /Started SSH master/);
    assert.equal(await get(a), 'hello from remote');
    assert.equal(await get(b), 'hello from remote');

    ok(await fwd(['rm', '--all']));
    assert.deepEqual((await ls()).forwards, []);
  });

  test('recovers from a master that died and left a stale socket', async () => {
    const local = await freePort();
    ok(await fwd(['add', `${local}:${remote}`]));
    const { master } = await ls();
    assert.ok(master.pid);
    process.kill(master.pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const status = await fwd(['status']);
    const socket = /Socket\s+(\S+)/.exec(status.stdout)?.[1];
    assert.ok(socket && (await stat(socket)).isSocket(), 'socket file should be left behind');
    assert.deepEqual((await ls()).forwards.map((f) => f.status), ['down']);

    ok(await fwd(['up']));
    assert.equal(await get(local), 'hello from remote');
    ok(await fwd(['rm', String(local)]));
  });

  test('concurrent adds share one master and all get saved', async () => {
    ok(await fwd(['down']));
    const ports = [await freePort(), await freePort(), await freePort()];
    const results = await Promise.all(ports.map((p) => fwd(['add', `${p}:${remote}`])));
    results.forEach(ok);
    for (const port of ports) assert.equal(await get(port), 'hello from remote');

    const status = await fwd(['status']);
    const socket = /Socket\s+(\S+)/.exec(status.stdout)?.[1];
    const masters = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes(` -S ${socket} `) && line.includes(' -M '));
    assert.equal(masters.length, 1, masters.join('\n'));
    assert.deepEqual((await ls()).forwards.map((f) => [f.local, f.status]), ports.sort((a, b) => a - b).map((p) => [p, 'active']));
    ok(await fwd(['rm', '--all']));
  });

  test('forwards from the ssh config are ignored', async () => {
    const local = await freePort();
    ok(await fwd(['add', `${local}:${remote}`]));
    assert.equal(await isPortListening(sshd.configForwardPort), false);
    ok(await fwd(['rm', String(local)]));
  });

  test('ls --all-hosts returns every saved host', async () => {
    const local = await freePort();
    ok(await fwd(['add', `${local}:${remote}`]));
    const { stdout } = ok(await runFwd(['ls', '--all-hosts', '--json'], { FWD_CONFIG_DIR: dir, FWD_SSH: sshd.sshWrapper }));
    assert.deepEqual(JSON.parse(stdout).map((/** @type {{ host: string }} */ h) => h.host), [sshd.host]);
    ok(await fwd(['rm', String(local)]));
  });

  test('--reverse exposes a port on this machine to the host', async () => {
    // Here "this machine" and the host are the same, so use distinct ports.
    const localPort = await freePort();
    const hostPort = await freePort();
    const local = http.createServer((_req, res) => res.end('hello from local'));
    local.listen(localPort, '127.0.0.1');
    await once(local, 'listening');
    try {
      const added = ok(await fwd(['add', `${localPort}:${hostPort}`, '--reverse']));
      assert.match(added.stdout, new RegExp(`Forwarding ${sshd.host}:${hostPort} -> localhost:${localPort}`));
      assert.equal(await get(hostPort), 'hello from local');
      assert.deepEqual((await ls()).forwards.map((f) => [f.direction, f.status]), [['remote', 'active']]);

      ok(await fwd(['down']));
      ok(await fwd(['up']));
      assert.equal(await get(hostPort), 'hello from local');

      const wrongDirection = await fwd(['rm', String(hostPort)]);
      assert.match(wrongDirection.stderr, new RegExp(`Did you mean \`fwd rm ${hostPort} --reverse\``));
      ok(await fwd(['rm', String(hostPort), '--reverse']));
      await assert.rejects(get(hostPort));
    } finally {
      local.close();
    }
  });

  test('watch reconnects a dead master and re-applies broken forwards', async () => {
    const local = await freePort();
    ok(await fwd(['add', `${local}:${remote}`]));
    const watcher = spawn(process.execPath, [BIN, 'watch', '--interval', '0.2', '--host', sshd.host], {
      env: { ...process.env, FWD_CONFIG_DIR: dir, FWD_SSH: sshd.sshWrapper },
    });
    let output = '';
    watcher.stdout.on('data', (chunk) => (output += chunk));
    watcher.stderr.on('data', (chunk) => (output += chunk));

    /** @param {string} what */
    const eventually = async (what) => {
      for (let i = 0; i < 50; i++) {
        if (await get(local).then(() => true, () => false)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail(`${what}: forward did not come back\n${output}`);
    };

    try {
      process.kill(/** @type {number} */ ((await ls()).master.pid), 'SIGKILL');
      await eventually('after killing the master');
      assert.match(output, /master is down, reconnecting/);

      const socket = /Socket\s+(\S+)/.exec((await fwd(['status'])).stdout)?.[1] ?? '';
      execFileSync(sshd.sshWrapper, ['-F', 'none', '-S', socket, '-O', 'cancel', '-L', `${local}:127.0.0.1:${remote}`, sshd.host]);
      await eventually('after cancelling the forward');
      assert.match(output, /some forwards are broken, re-applying/);
    } finally {
      watcher.kill('SIGTERM');
    }
    const [code] = await once(watcher, 'exit');
    assert.equal(code, 0, output);
    assert.match(output, /Stopped watching\./);
    ok(await fwd(['rm', String(local)]));
  });

  test('rm while the master is down only updates state', async () => {
    const local = await freePort();
    ok(await fwd(['add', `${local}:${remote}`]));
    ok(await fwd(['down']));
    ok(await fwd(['rm', String(local)]));
    assert.deepEqual((await ls()).forwards, []);
  });
});
