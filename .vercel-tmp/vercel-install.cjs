#!/usr/bin/env node
const { spawnSync } = require('child_process');
const os = require('os');
const isWindows = os.platform() === 'win32';
const ALLOWED_COMMANDS = new Set(['node', 'npm', 'pnpm', 'yarn', 'vercel']);
function log(msg) { console.error(msg); }
function commandExists(cmd) {
  if (!ALLOWED_COMMANDS.has(cmd)) throw new Error(`Command not in whitelist: ${cmd}`);
  try {
    if (isWindows) { return spawnSync('where', [cmd], { stdio: 'ignore' }).status === 0; }
    else { return spawnSync('sh', ['-c', `command -v "$1"`, '--', cmd], { stdio: 'ignore' }).status === 0; }
  } catch { return false; }
}
function getCommandOutput(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], shell: isWindows });
    return result.status === 0 ? (result.stdout || '').trim() : null;
  } catch { return null; }
}
function checkNode() {
  if (!commandExists('node')) { log('Error: Node.js is not installed'); process.exit(1); }
  log(`Detected Node.js: ${getCommandOutput('node', ['-v'])}`);
}
function checkVercel() {
  if (commandExists('vercel')) {
    const version = getCommandOutput('vercel', ['--version']) || 'unknown';
    log(`Vercel CLI installed: ${version}`);
    return true;
  }
  return false;
}
function detectPackageManager() {
  if (commandExists('pnpm')) return 'pnpm';
  if (commandExists('yarn')) return 'yarn';
  if (commandExists('npm')) return 'npm';
  return null;
}
function installVercel(pkgManager) {
  log(`Installing Vercel CLI using ${pkgManager}...`);
  const commands = { pnpm: ['pnpm', ['add', '-g', 'vercel']], yarn: ['yarn', ['global', 'add', 'vercel']], npm: ['npm', ['install', '-g', 'vercel']] };
  const entry = commands[pkgManager];
  if (!entry) { log('Error: No available package manager found'); process.exit(1); }
  try {
    const result = spawnSync(entry[0], entry[1], { stdio: 'inherit', shell: isWindows });
    if (result.status !== 0) throw new Error(`Exit code: ${result.status}`);
  } catch (error) { log(`Installation failed: ${error.message}`); process.exit(1); }
}
function main() {
  log('========================================');
  log('Vercel CLI Installation Script');
  log('========================================\n');
  checkNode();
  if (checkVercel()) { log('\nVercel CLI is already installed.'); console.log(JSON.stringify({ status: 'already_installed' })); process.exit(0); }
  const pkgManager = detectPackageManager();
  if (!pkgManager) { log('Error: No package manager found'); process.exit(1); }
  log(`Detected package manager: ${pkgManager}\n`);
  installVercel(pkgManager);
  if (checkVercel()) { log('\nVercel CLI installed successfully!\n'); console.log(JSON.stringify({ status: 'success' })); }
  else { log('Error: Cannot find vercel command after installation'); process.exit(1); }
}
main();
