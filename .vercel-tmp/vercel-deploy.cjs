#!/usr/bin/env node
const { spawnSync } = require('child_process');
const os = require('os');
const isWindows = os.platform() === 'win32';
function log(msg) { console.error(msg); }
function main() {
  log('Starting Vercel deployment...');
  const args = ['vercel', '--yes', '--prod'];
  log(`Executing: npx ${args.join(' ')}`);
  try {
    const result = spawnSync('npx', args, {
      cwd: process.argv[2] || '.',
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: 300000,
      shell: isWindows
    });
    const output = (result.stdout || '') + (result.stderr || '');
    log(output);
    const aliasedMatch = output.match(/Aliased:\s*(https:\/\/[a-zA-Z0-9.-]+\.vercel\.app)/i);
    const deploymentMatch = output.match(/Production:\s*(https:\/\/[a-zA-Z0-9.-]+\.vercel\.app)/i);
    const urlMatch = output.match(/(https:\/\/[a-zA-Z0-9.-]+\.vercel\.app)/);
    const finalUrl = aliasedMatch?.[1] || deploymentMatch?.[1] || urlMatch?.[1];
    if (finalUrl) {
      log(`\nDeployment successful! URL: ${finalUrl}`);
      console.log(JSON.stringify({ status: 'success', url: finalUrl }));
    } else {
      log('\nDeployment completed');
      console.log(JSON.stringify({ status: 'success' }));
    }
  } catch (error) {
    log(`Deployment failed: ${error.message}`);
    process.exit(1);
  }
}
main();
