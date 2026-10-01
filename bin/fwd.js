#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolveHost } from '../src/commands/common.js';
import { findCommand, optionsFor } from '../src/commands/index.js';
import { FwdError } from '../src/errors.js';
import { commandHelp, mainHelp, version } from '../src/help.js';
import { withLock } from '../src/lock.js';
import { loadState } from '../src/state.js';

/** @typedef {import('../src/commands/common.js').Command} Command */

/**
 * @param {Command} cmd
 * @param {string[]} argv
 */
function parse(cmd, argv) {
  const options = Object.fromEntries(
    Object.entries(optionsFor(cmd)).map(([name, { type, short }]) => [name, short ? { type, short } : { type }]),
  );
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (err) {
    // Drop Node's advice about "--" that follows unknown-option errors.
    const message = /** @type {Error} */ (err).message.replace(/\. To specify a positional.*$/s, '.');
    throw new FwdError(`${message}\nRun \`fwd ${cmd.name} --help\` for usage.`);
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main([name, ...rest]) {
  if (name === undefined || name === '-h' || name === '--help') {
    console.log(mainHelp());
    return 0;
  }
  if (name === '-v' || name === '--version') {
    console.log(version);
    return 0;
  }

  const cmd = findCommand(name);
  const { values: flags, positionals: args } = parse(cmd, rest);
  if (flags.help) {
    console.log(commandHelp(cmd));
    return 0;
  }
  const [min, max] = cmd.args;
  if (args.length > max) {
    throw new FwdError(`Unexpected argument "${args[max]}". Run \`fwd ${name} --help\` for usage.`);
  }
  if (args.length < min) {
    throw new FwdError(`Missing argument. Usage: ${cmd.usage.join(' | ')}`);
  }

  const run = async () => {
    const state = await loadState();
    const host = cmd.host ? '' : resolveHost(state, flags.host);
    return (await cmd.run({ args, flags, state, host })) ?? 0;
  };
  return cmd.readonly ? run() : withLock(run);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof FwdError ? `fwd: ${err.message}` : err);
  process.exitCode = 1;
}
