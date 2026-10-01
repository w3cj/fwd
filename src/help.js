import { readFileSync } from 'node:fs';
import { commands, helpOption, hostOption, optionsFor } from './commands/index.js';

/** @typedef {import('./commands/common.js').Command} Command */
/** @typedef {import('./commands/common.js').Option} Option */

export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** @param {[string, string][]} rows */
function table(rows) {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`).join('\n');
}

/**
 * @param {Record<string, Option>} options
 * @returns {[string, string][]}
 */
function optionRows(options) {
  return Object.entries(options).map(([name, opt]) => [
    `${opt.short ? `-${opt.short}, ` : ''}--${name}${opt.type === 'string' ? ` <${opt.value ?? name}>` : ''}`,
    opt.help,
  ]);
}

export function mainHelp() {
  return `fwd ${version}: manage SSH port forwards over a single ControlMaster connection

Usage: fwd <command> [options]

Commands:
${table(commands.filter((c) => !c.hidden).map((c) => [c.name, c.summary]))}

Options:
${table([...optionRows({ ...hostOption, ...helpOption }), ['-v, --version', 'Show the version']])}

Run \`fwd help <command>\` for details. Start with \`fwd config set host <host>\`.`;
}

/** @param {Command} cmd */
export function commandHelp(cmd) {
  const usage = cmd.usage.map((line, i) => `${i === 0 ? 'Usage: ' : '       '}${line}`).join('\n');
  const description = cmd.description ? `\n\n${cmd.description}` : '';
  return `${usage}\n\n${cmd.summary}.${description}\n\nOptions:\n${table(optionRows(optionsFor(cmd)))}`;
}
