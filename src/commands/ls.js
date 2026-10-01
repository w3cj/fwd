import { FwdError } from '../errors.js';
import { describe } from '../spec.js';
import { checkMaster } from '../ssh.js';
import { getForwards } from '../state.js';
import { forwardStatus, pidSuffix, resolveHost } from './common.js';

/** @typedef {import('../state.js').State} State */

/** @param {string | undefined} iso */
function formatDate(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * @param {State} state
 * @param {string} host
 */
async function hostStatus(state, host) {
  const master = await checkMaster(host);
  const forwards = await Promise.all(
    getForwards(state, host).map(async (fwd) => ({ ...fwd, status: await forwardStatus(fwd, master.alive) })),
  );
  return { host, master: { alive: master.alive, pid: master.alive ? master.pid : null }, forwards };
}

/**
 * @param {State} state
 * @param {Awaited<ReturnType<typeof hostStatus>>} status
 */
function print(state, { host, master, forwards }) {
  console.log(`${host}: master ${master.alive ? `running${pidSuffix(master.pid)}` : 'not running'}`);
  if (!forwards.length) return void console.log('No saved forwards. Add one with `fwd add <port>`.');

  const rows = [
    ['FORWARD', 'STATUS', 'ADDED'],
    ...forwards.map((f) => [describe(f, host), f.status, formatDate(f.addedAt)]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd());
  }
  if (forwards.some((f) => f.status !== 'active')) {
    const flag = host === state.defaultHost ? '' : ` --host ${host}`;
    console.log(`\nRun \`fwd up${flag}\` to restore forwards that are down or broken.`);
  }
}

/** @type {import('./common.js').Command} */
export default {
  name: 'ls',
  summary: 'List saved forwards and their status',
  usage: ['fwd ls [--json] [--host <host> | --all-hosts]'],
  description: [
    'Statuses:',
    '  active   the local port is forwarded',
    '  down     the SSH master is not running (`fwd up` restores it)',
    '  broken   the master is up but the port is not listening (`fwd up` re-applies it)',
    '',
    'Local forwards are checked by connecting to the local port, which ssh passes on',
    'to the remote port, so the remote service sees a brief connection. Reverse',
    'forwards listen on the host and are reported active whenever the master is up.',
  ].join('\n'),
  args: [0, 0],
  host: 'self',
  readonly: true,
  options: {
    'all-hosts': { type: 'boolean', help: 'List forwards for every host' },
    json: { type: 'boolean', help: 'Print machine-readable JSON' },
  },

  async run({ flags, state }) {
    if (flags['all-hosts'] && flags.host !== undefined) throw new FwdError('Use either --host or --all-hosts, not both.');
    const hosts = flags['all-hosts'] ? Object.keys(state.hosts) : [resolveHost(state, flags.host)];
    const statuses = await Promise.all(hosts.map((host) => hostStatus(state, host)));

    if (flags.json) {
      return void console.log(JSON.stringify(flags['all-hosts'] ? statuses : statuses[0], null, 2));
    }
    if (!statuses.length) return void console.log('No saved forwards. Add one with `fwd add <port>`.');
    statuses.forEach((status, i) => {
      if (i > 0) console.log();
      print(state, status);
    });
  },
};
