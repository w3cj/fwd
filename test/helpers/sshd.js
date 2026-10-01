// Starts a throwaway sshd on 127.0.0.1 as the current user, plus an ssh
// wrapper (for FWD_SSH) that points at it. Used by the integration tests.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export const SSHD = ['/usr/sbin/sshd', '/usr/local/sbin/sshd', '/opt/homebrew/sbin/sshd'].find((p) => existsSync(p));

/** @returns {Promise<number>} */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {net.AddressInfo} */ (server.address());
      server.close(() => resolve(address.port));
    });
  });
}

/**
 * @param {number} port
 * @param {number} timeoutMs
 */
async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sshd did not start listening on ${port}`);
}

export async function startSshd() {
  if (!SSHD) throw new Error('sshd not found');
  const dir = await mkdtemp(join(tmpdir(), 'fwd-sshd-'));
  const port = await freePort();
  // fwd should ignore forwards from the user's ssh config (ClearAllForwardings).
  const configForwardPort = await freePort();
  for (const name of ['host_key', 'client_key']) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, name)]);
  }
  await writeFile(
    join(dir, 'sshd_config'),
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(dir, 'host_key')}`,
      `PidFile ${join(dir, 'sshd.pid')}`,
      `AuthorizedKeysFile ${join(dir, 'client_key.pub')}`,
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'AllowTcpForwarding yes',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'ssh_config'),
    [
      'Host testvm',
      '  HostName 127.0.0.1',
      `  Port ${port}`,
      `  User ${userInfo().username}`,
      `  IdentityFile ${join(dir, 'client_key')}`,
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking no',
      '  UserKnownHostsFile /dev/null',
      '  LogLevel ERROR',
      '  BatchMode yes',
      `  LocalForward ${configForwardPort} 127.0.0.1:${port}`,
      '',
    ].join('\n'),
  );
  const wrapper = join(dir, 'ssh');
  await writeFile(wrapper, `#!/bin/sh\nexec ssh -F '${join(dir, 'ssh_config')}' "$@"\n`);
  await chmod(wrapper, 0o755);

  const proc = spawn(SSHD, ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForPort(port, 5000);
  } catch (err) {
    proc.kill();
    throw new Error(`${/** @type {Error} */ (err).message}\n${log}`);
  }

  return {
    host: 'testvm',
    sshWrapper: wrapper,
    configForwardPort,
    log: () => log,
    async stop() {
      proc.kill();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
