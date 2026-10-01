import add from './add.js';
import complete from './complete.js';
import completion from './completion.js';
import config from './config.js';
import down from './down.js';
import help from './help.js';
import ls from './ls.js';
import rm from './rm.js';
import status from './status.js';
import up from './up.js';
import watch from './watch.js';
import { FwdError } from '../errors.js';

/** @typedef {import('./common.js').Command} Command */
/** @typedef {import('./common.js').Option} Option */

/** @type {Command[]} */
export const commands = [add, rm, ls, up, down, status, watch, config, completion, help, complete];

/**
 * @param {string} name
 * @returns {Command}
 */
export function findCommand(name) {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) throw new FwdError(`Unknown command "${name}". Run \`fwd help\` to see the commands.`);
  return cmd;
}

/** @type {Record<string, Option>} */
export const hostOption = {
  host: { type: 'string', value: 'host', complete: 'hosts', help: 'SSH host to use instead of the default' },
};

/** @type {Record<string, Option>} */
export const helpOption = { help: { type: 'boolean', short: 'h', help: 'Show this help' } };

/**
 * Every option a command accepts, including the shared ones.
 * @param {Command} cmd
 * @returns {Record<string, Option>}
 */
export function optionsFor(cmd) {
  return { ...cmd.options, ...(cmd.host === 'none' ? {} : hostOption), ...helpOption };
}
