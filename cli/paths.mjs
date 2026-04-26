import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getPackageRoot() {
  return PACKAGE_ROOT;
}

export function getCliEntrypointPath() {
  return path.join(PACKAGE_ROOT, 'bin', 'notion2cli.mjs');
}

export function getBridgeServerPath() {
  return path.join(PACKAGE_ROOT, 'server', 'bridge-server.mjs');
}

export function getClaudeChannelServerPath() {
  return path.join(PACKAGE_ROOT, 'server', 'channel-server.mjs');
}

export function getNotion2cliHome() {
  return process.env.NOTION2CLI_HOME || path.join(os.homedir(), '.notion2cli');
}

export function getAppPaths() {
  const root = getNotion2cliHome();
  return {
    root,
    stateDir: path.join(root, 'state'),
    logsDir: path.join(root, 'logs'),
    artifactsDir: path.join(root, 'state', 'artifacts'),
    daemonFile: path.join(root, 'state', 'daemon.json'),
    claudeChannelMcpConfigFile: path.join(root, 'claude-channel.mcp.json'),
    claudeWorkerMcpConfigFile: path.join(root, 'claude-worker.mcp.json'),
    daemonOutLog: path.join(root, 'logs', 'daemon.log'),
    daemonErrLog: path.join(root, 'logs', 'daemon.err.log'),
  };
}

export async function ensureAppDirs() {
  const paths = getAppPaths();
  await mkdir(paths.stateDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
  return paths;
}

export function resolveWorkspaceCwd(requestedCwd) {
  return path.resolve(requestedCwd || process.cwd());
}

export async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function removeFile(filePath) {
  await rm(filePath, { force: true });
}

export function clearFileIfOwnedSync(filePath, pid) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.pid === pid) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {}
}
