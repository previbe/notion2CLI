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
    let killTimer = null;

    const clearTimers = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (child.exitCode == null) {
            child.kill('SIGKILL');
          }
        }, options.killAfterMs || 1000);
        killTimer.unref?.();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      timer.unref?.();
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimers();

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code, signal) => {
      clearTimers();

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
