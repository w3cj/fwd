# fwd

A dead simple zero dependency SSH port forward manager. No extra background processes, uses OpenSSH ControlMaster.

```bash
fwd add 5173            # localhost:5173 -> vm:5173
fwd add 8080:3000       # localhost:8080 -> vm:3000
fwd add 3000 --reverse  # vm:3000 -> localhost:3000
fwd ls
fwd rm 5173
```

One OpenSSH [ControlMaster](https://man.openbsd.org/ssh_config#ControlMaster) process holds the connection, and `fwd` asks it to add or cancel forwards with `ssh -O forward` / `ssh -O cancel`. OpenSSH does all the networking; `fwd` remembers what you asked for, so it can show status and restore forwards after a reboot or VM restart.

## Install

Requires Node 20+ and OpenSSH on macOS or Linux. Windows isn't supported, because its OpenSSH doesn't support ControlMaster. There are no runtime dependencies.

```bash
npm install -g @w3cj/fwd
```

## Setup

Point `fwd` at an alias in `~/.ssh/config`, so keys, user and IP all come from your normal SSH setup:

```
Host vm
  HostName 192.168.64.7
  User cj
```

```bash
fwd config set host vm
```

Check that it works with `ssh vm` first. Passphrase and host-key prompts still work when `fwd` starts the connection.

## Commands

| Command | What it does |
|---|---|
| `fwd add <local>[:<remote>] [--reverse] [--to <addr>]` | Forward `localhost:<local>` to `<remote>` on the host (same port by default). Starts the master if needed. `--to` connects to another address as seen from the host, e.g. `fwd add 5432 --to db`. |
| `fwd rm <port> [--reverse]` / `fwd rm --all` | Cancel a forward and forget it. `<port>` is the listening port. |
| `fwd ls [--json] [--all-hosts]` | List saved forwards with their status: `active`, `down` (master not running) or `broken` (master up, port not listening). `--all-hosts` lists every host. |
| `fwd up` | Start the master and re-apply every saved forward. Use it after a reboot, VM restart or network drop. |
| `fwd down` | Stop the master. Saved forwards are kept for `fwd up`. |
| `fwd status` | Show the host, control socket, master PID and log file. |
| `fwd watch [--interval <s>] [--all-hosts]` | Stay in the foreground and reconnect and restore forwards whenever the connection drops. |
| `fwd completion bash\|zsh\|fish` | Print a shell completion script. |
| `fwd config set\|get\|unset host` | Manage the default host. |

Every command accepts `--host <host>`, so several hosts can be used side by side, with one master each. `fwd <command> --help` shows details.

## Reverse forwards

`--reverse` makes the host listen and forward back to this machine (`ssh -R`). That's useful when something in the VM needs to reach a service on your laptop:

```bash
fwd add 3000 --reverse                 # vm:3000 -> localhost:3000
fwd add 3000:8000 --reverse            # vm:8000 -> localhost:3000
fwd add 5432 --reverse --to 10.0.0.5   # vm:5432 -> 10.0.0.5:5432, reached from this machine
fwd rm 8000 --reverse
```

The spec is always `<local>:<remote>`; `--reverse` only changes which side listens. The host listens on its loopback interface unless its sshd sets `GatewayPorts`. `fwd ls` can't check reverse forwards individually, so it shows them as `active` whenever the master is up.

## Staying connected

`fwd watch` checks every 5 seconds (`--interval` changes that). If the master has died because the VM restarted, slept or changed network, `watch` reconnects and restores your saved forwards. If a local forward stopped listening, it's re-applied. Forwards you add or remove while it runs are picked up. Stop it with Ctrl+C; the master keeps running.

## Shell completion

Completion covers commands, options, saved hosts for `--host`, and saved ports for `fwd rm`:

```bash
fwd completion bash > ~/.local/share/bash-completion/completions/fwd
fwd completion zsh > "${fpath[1]}/_fwd"      # or: source <(fwd completion zsh) in ~/.zshrc
fwd completion fish > ~/.config/fish/completions/fwd.fish
```

## Notes

- Local ports below 1024 are rejected. Use a higher local port, e.g. `fwd add 8080:80`.
- `active` means the local end of the forward is listening. It doesn't check that anything is running on the remote port. `ls` checks by briefly connecting to each local port, which ssh passes through, so the remote service sees a short connection.
- `LocalForward` and `RemoteForward` lines in your ssh config are ignored for `fwd`'s connection; `fwd` only opens the forwards you add.
- Connecting gives up after 10 seconds if the host doesn't respond.
- Commands that change state take a lock in the config directory, so running several `fwd` commands at once is safe.
- If the connection drops (the VM sleeps, the network changes), the master exits within about 45 seconds. The next `fwd add` or `fwd up` reconnects and restores forwards.
- Cancelling a forward stops new connections; connections that are already open stay open until they close.
- State, control sockets and the master's log live in `$XDG_CONFIG_HOME/fwd` (default `~/.config/fwd`).

## Development

```bash
npm test            # unit tests, plus end-to-end tests against a throwaway local sshd
npm run typecheck   # tsc over the JSDoc types; there's no build step
```

The end-to-end tests start `sshd` as your user on a random localhost port. They're skipped if `sshd` isn't installed, or if `FWD_SKIP_INTEGRATION=1` is set.
