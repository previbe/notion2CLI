import { spawn } from 'node:child_process';

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (settled) {
        return;
      }

      settled = true;
      resolve({ code, signal, stdout, stderr });
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
    }

    child.stdin.end();
  });
}

