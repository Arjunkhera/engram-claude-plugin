#!/usr/bin/env node
// The checks a pull request must pass. No dependencies, no network.
// 1. The plugin and marketplace files parse, and name the same plugin.
// 2. The skill has front matter with a name and a description.
// 3. Every relative link in a Markdown file resolves to a file.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (m) => errors.push(m);

function json(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch (e) {
    fail(`${rel}: ${e.message}`);
    return null;
  }
}

const plugin = json('.claude-plugin/plugin.json');
const market = json('.claude-plugin/marketplace.json');
if (plugin && !/^\d+\.\d+\.\d+$/.test(plugin.version ?? '')) fail('plugin.json: version must be x.y.z');
if (plugin && market && !market.plugins?.some((p) => p.name === plugin.name)) {
  fail(`marketplace.json lists no plugin named "${plugin.name}"`);
}

const skillPath = 'skills/engram/SKILL.md';
const skill = fs.existsSync(path.join(root, skillPath)) ? fs.readFileSync(path.join(root, skillPath), 'utf8') : '';
const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
if (!fm) fail(`${skillPath}: no front matter`);
else {
  if (!/^name: \S+/m.test(fm[1])) fail(`${skillPath}: front matter has no name`);
  if (!/^description: \S+/m.test(fm[1])) fail(`${skillPath}: front matter has no description`);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}
let links = 0;
for (const file of walk(root)) {
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      links++;
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
        fail(`${path.relative(root, file)}: broken link ${m[1]}`);
      }
    }
  }
}
// A link check that finds no links checks nothing.
if (links < 5) fail(`only ${links} relative links found; the walk is broken`);

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
console.log(`OK: plugin ${plugin.name} ${plugin.version}, skill front matter, ${links} links`);
