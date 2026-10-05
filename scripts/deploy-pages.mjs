// Builds the site for GitHub Pages (project page under /<repo>/) and force-pushes dist/ to the
// gh-pages branch of the "origin" remote. No extra dependencies; needs git push access.
// Usage: npm run deploy
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', ...opts }).trim();

const remote = out('git remote get-url origin');
const repoName = remote.replace(/\.git$/, '').split('/').pop();
const base = process.env.BASE || `/${repoName}/`;

console.log(`Building with BASE=${base} …`);
sh('npm run build', { env: { ...process.env, BASE: base } });

const dist = resolve('dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html missing after build');
// Disable Jekyll so folders/files starting with "_" are served as-is.
writeFileSync(join(dist, '.nojekyll'), '');
// Deep links like /history-of-earth/#y=… are hash-based, so no 404 fallback is needed.

const work = mkdtempSync(join(tmpdir(), 'gh-pages-'));
try {
  // Sync first, then init: rsync --delete would otherwise remove the fresh .git folder.
  sh(`rsync -a --delete "${dist}/" "${work}/"`);
  sh(`git init -q -b gh-pages "${work}"`);
  const sha = out('git rev-parse --short HEAD');
  sh(`git -C "${work}" add -A`);
  sh(`git -C "${work}" -c user.name="deploy" -c user.email="deploy@localhost" commit -q -m "Deploy ${sha} to GitHub Pages"`);
  sh(`git -C "${work}" push --force "${remote}" gh-pages:gh-pages`);
  console.log(`Pushed gh-pages (${sha}). Site: https://${remote.match(/github\.com[:/]([^/]+)/)[1]}.github.io${base}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
