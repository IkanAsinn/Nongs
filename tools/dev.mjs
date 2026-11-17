// Runs the API server and the game's dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const run = (workspace) =>
  spawn('npm', ['run', 'dev', '-w', workspace], { stdio: 'inherit', shell: true });
const children = [run('@nongs/server'), run('@nongs/client')];
const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());
