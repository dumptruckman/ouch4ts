import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repository = path.resolve(process.argv[2] ?? process.cwd());
const cli = path.join(repository, 'node_modules/@changesets/cli/bin.js');
const workspace = mkdtempSync(path.join(tmpdir(), 'changesets-compatibility-'));
const config = JSON.parse(readFileSync(path.join(repository, '.changeset/config.json'), 'utf8'));
const cases = [
  { name: 'patch preview', bumps: ['patch'], snapshot: 'preview.1001', expected: '0.1.1-preview.1001' },
  { name: 'patch then minor preview', bumps: ['patch', 'minor'], snapshot: 'preview.1002', expected: '0.2.0-preview.1002' },
  { name: 'same preview on retry', bumps: ['patch', 'minor'], snapshot: 'preview.1002', expected: '0.2.0-preview.1002' },
  { name: 'major preview', bumps: ['patch', 'minor', 'major'], snapshot: 'preview.1003', expected: '1.0.0-preview.1003' },
  { name: 'stable patch', bumps: ['patch'], expected: '0.1.1' },
  { name: 'stable highest bump', bumps: ['patch', 'minor'], expected: '0.2.0' },
  { name: 'no-release-only stable', bumps: [], expected: '0.1.0', expectedExitCode: 1 },
  { name: 'no-release after patch', bumps: ['patch', null], expected: '0.1.1' },
  { name: 'maintenance patch preview', baseline: '0.1.3', branch: 'maintenance/0.1', bumps: ['patch'], snapshot: 'preview.1004', expected: '0.1.4-preview.1004' },
  { name: 'maintenance stable patch', baseline: '0.1.3', branch: 'maintenance/0.1', bumps: ['patch'], expected: '0.1.4' },
];
const results = [];
try {
  for (const [index, row] of cases.entries()) {
    const root = path.join(workspace, String(index));
    const baseline = row.baseline ?? '0.1.0';
    const run = (command, args) => {
      try { return execFileSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true', npm_config_cache: path.join(workspace, 'npm-cache'), npm_config_offline: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (error) {
        if (error.status !== row.expectedExitCode) process.stderr.write(`${row.name}: ${error.stdout ?? ''}${error.stderr ?? ''}\n`);
        throw error;
      }
    };
    mkdirSync(path.join(root, '.changeset'), { recursive: true });
    symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    writeFileSync(path.join(root, '.gitignore'), 'node_modules\npacked\n');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ouch-compatibility-fixture', version: baseline, type: 'module', license: 'MIT', files: ['index.js'] }));
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'ouch-compatibility-fixture', version: baseline, lockfileVersion: 3, requires: true, packages: { '': { name: 'ouch-compatibility-fixture', version: baseline, license: 'MIT' } } }));
    writeFileSync(path.join(root, 'index.js'), 'export const fixture = true;\n');
    writeFileSync(path.join(root, '.changeset/config.json'), JSON.stringify({ ...config, snapshot: { useCalculatedVersion: true, prereleaseTemplate: '{tag}' } }));
    run('git', ['init', '--initial-branch=main']);
    run('git', ['config', 'user.name', 'Compatibility fixture']);
    run('git', ['config', 'user.email', 'fixture@example.invalid']);
    run('git', ['add', '.']);
    run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Baseline']);
    if (row.branch) run('git', ['checkout', '-b', row.branch]);
    for (const [changeIndex, bump] of row.bumps.entries()) {
      if (bump === null) continue;
      writeFileSync(path.join(root, `.changeset/pr-${changeIndex + 1}.md`), `---\n"ouch-compatibility-fixture": ${bump}\n---\n\n[Change ${changeIndex + 1}](https://example.invalid/pr/${changeIndex + 1})\n`);
    }
    const args = [cli, 'version', ...(row.snapshot ? ['--snapshot', row.snapshot] : [])];
    let versionExitCode = 0;
    try { run(process.execPath, args); }
    catch (error) {
      if (error.status !== row.expectedExitCode) throw error;
      versionExitCode = error.status;
    }
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(pkg.version, row.expected, row.name);
    assert.equal(versionExitCode, row.expectedExitCode ?? 0, `${row.name} exit status`);
    assert.equal(lock.version, baseline, `${row.name} leaves top-level lock version unchanged`);
    assert.equal(lock.packages[''].version, baseline, `${row.name} leaves root lock version unchanged`);
    const remainingChangesets = readdirSync(path.join(root, '.changeset')).filter(name => name.endsWith('.md'));
    assert.equal(remainingChangesets.length, 0, `${row.name} consumes generated inputs`);
    let packResult;
    if (row.name === 'patch then minor preview') {
      const output = path.join(root, 'packed');
      const inputPlan = path.join(root, 'input-publish-plan.json');
      writeFileSync(inputPlan, JSON.stringify({ version: 1, plan: [[{ kind: 'publish', name: 'ouch-compatibility-fixture', version: row.expected, access: 'public', tag: 'preview' }]] }));
      run(process.execPath, [cli, 'pack', '--from-publish-plan', inputPlan, '--out-dir', output]);
      packResult = {};
      for (const file of readdirSync(output)) {
        if (file.endsWith('.json')) packResult[file] = JSON.parse(readFileSync(path.join(output, file), 'utf8'));
      }
      const archives = readdirSync(path.join(output, 'packages')).filter(file => file.endsWith('.tgz'));
      assert.equal(archives.length, 1, 'native pack creates one archive');
      const packedPkg = JSON.parse(run('tar', ['-xOf', path.join(output, 'packages', archives[0]), 'package/package.json']));
      assert.equal(packedPkg.version, row.expected, 'packed preview version');
      packResult.archives = archives;
      packResult.version = packedPkg.version;
    }
    results.push({ name: row.name, versionExitCode, version: pkg.version, lockVersion: lock.version, rootLockVersion: lock.packages[''].version, remainingChangesets, ...(packResult ? { packResult } : {}) });
  }
  console.log(JSON.stringify({ node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), changesets: JSON.parse(readFileSync(path.join(repository, 'node_modules/@changesets/cli/package.json'), 'utf8')).version, results }, null, 2));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
