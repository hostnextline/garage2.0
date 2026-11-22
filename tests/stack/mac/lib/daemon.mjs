// Starts a program in the background, in its own session (macOS has no setsid command), and writes its pid.
// Usage: node daemon.mjs <pid file> <log file> <working folder> <program> [arguments…]   (the environment is passed on)
import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';

const [pidFile, logFile, cwd, cmd, ...args] = process.argv.slice(2);
const out = openSync(logFile, 'a');
const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', out, out], env: process.env });
child.on('error', (e) => { console.error(`could not start ${cmd}: ${e.message}`); process.exit(1); });
child.on('spawn', () => { writeFileSync(pidFile, String(child.pid)); child.unref(); process.exit(0); });
