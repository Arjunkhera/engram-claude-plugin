#!/usr/bin/env node
// The Atlas repo-shape check. Milestone M2, slice L1, design pages D1 and D4.
//
// This is the whole check, in one file. The package writes this file into a
// repo at .github/atlas/check.mjs, and a workflow there runs it on every pull
// request. Nothing else is needed. It holds the spec, the scanners, the YAML
// reader, the secret patterns and the report. It imports Node builtins only.
//
// What it reads: the checkout it is pointed at, and nothing else. It opens no
// network. It holds no token. It writes nothing back into the repo. In gate
// mode only, it reads git objects with the git binary, and writes two trees
// into a temp folder outside the checkout.
//
// What it reports: one state per part of the six files. Four states: filled,
// empty, stale, not listed. It leads with the count of listed parts that are
// not filled.
//
// It carries the version of the Atlas package it came from, so a copy in a
// repo says where it came from. It refuses a spec version it cannot read.
//
// Authority: the Atlas M2 study, design page D1 with its
// D7 amendment; the Atlas architecture review, build order B1.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, relative, posix, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// node:crypto is a builtin, so the check still imports nothing but builtins.
export const sha256 = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');

// The version of this check, as a whole number. It moves only when this file's
// own code changes, never with the Atlas package version (row F11, amendment
// A1.9). A release of Atlas that leaves the check alone leaves every repo's copy
// current, so the no-loss rule's check-file case does not fire on every release.
//
// Whether a copy is current or behind is not decided here. CI has no package
// and no network. The session verb decides it, from the release list that
// ships beside this file in the package, shape/releases.json.
export const CHECK_VERSION = 10;

// ---------------------------------------------------------------------------
// The spec. Spec 3 is a catalog, not a table (roadmap R62). Each repo lists in
// atlas.yaml the parts it carries, and the check scores those and no others:
//
// - `parts:` names the file parts of the catalog by id;
// - each key of `procedures:` is one procedure part;
// - each key of `files:` is one facts section part;
// - `areas:`, when it is there, is the areas part;
// - atlas.yaml itself is always scored.
//
// Every scored part is required. A part the repo does not list says "not
// listed" and does not count. Spec 1 and 2 held a table of kinds, and the
// check read the parts from the kind. The tables missed real parts: Atlas,
// kind library, never had its credentials file read. Check version 10 retired
// them. A repo on spec 1 or 2 keeps its older copy of the check until
// `atlas tooling` moves it.
// ---------------------------------------------------------------------------

// Deep frozen. `loadSpec` hands every caller the same object, so one caller
// must not be able to change what the next one reads (acceptance review of
// batch 14b, finding 9).
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// How a part is listed: by its id in `parts:`, as a key of `procedures:` or
// of `files:`, by the `areas:` key, or always.
export const LISTED_BY = Object.freeze(['parts', 'procedures', 'files', 'areas', 'always']);

export const SPEC_3 = deepFreeze({
  spec: 3,
  title: 'The parts a repo lists',
  authority: 'roadmap R62, design docs/design-docs/parts-and-areas/.',
  states: {
    filled: 'The part exists and matches the repo.',
    empty: 'The part is missing, or it holds nothing.',
    stale: 'The part exists but disagrees with the repo.',
    'not listed': 'atlas.yaml does not list the part, so the check does not score it.',
  },
  files: [
    {
      id: 'entry-map', number: 1, title: 'Entry map', class: 'instruction', written_by: 'the helper drafts; a person merges',
      parts: [
        { id: 'claude-md', listed_by: 'parts', path: 'CLAUDE.md', holds: 'What the repo is, how to build it, the layout, the modules, and one pointer to each file below. Facts only.', check: 'markdown', max_lines: 200 },
        { id: 'agents-md', listed_by: 'parts', path: 'AGENTS.md', holds: 'Two lines that point at CLAUDE.md.', check: 'markdown', max_lines: 200 },
      ],
    },
    {
      id: 'path-rules', number: 2, title: 'Path rules', class: 'instruction', written_by: 'the helper; a person merges',
      parts: [
        { id: 'rules', listed_by: 'parts', path: '.claude/rules', glob: '*.md', holds: 'One constraint that holds under one path only, such as "migrations are append-only".', check: 'path-rules' },
      ],
    },
    {
      id: 'procedures', number: 3, title: 'Procedures', class: 'instruction', written_by: 'the helper; a person merges',
      // One part for each key of `procedures:`. The name is the repo's own:
      // run-locally, test, deploy, release, or any other.
      parts: [
        { id: 'procedure', listed_by: 'procedures', holds: 'One skill that carries the procedure: how to run it, step by step.', check: 'procedure' },
      ],
    },
    {
      id: 'repo-facts', number: 4, title: 'Repo facts', class: 'instruction', written_by: 'an agent proposes; the owner merges',
      parts: [
        { id: 'root', listed_by: 'always', path: 'atlas.yaml', holds: 'The spec version, the product id, the repo id, the parts, the procedure map, and one pointer per section.', check: 'facts-root', keys: ['spec', 'product', 'repo', 'parts'] },
        { id: 'deploy', listed_by: 'files', section: 'deploy', default_path: 'atlas/deploy.yaml', holds: 'One entry per environment: the platform, the target and the health endpoint.', check: 'facts-section', keys: ['environments'] },
        { id: 'observability', listed_by: 'files', section: 'observability', default_path: 'atlas/observability.yaml', holds: 'Where the logs, the metrics, the traces and the dashboards are, per environment.', check: 'facts-section', keys: ['environments'] },
        { id: 'credentials', listed_by: 'files', section: 'credentials', default_path: 'atlas/credentials.yaml', holds: 'Each credential by name, with the environment it belongs to. Names only, never a value.', check: 'facts-credentials', keys: ['credentials'] },
        { id: 'dependencies', listed_by: 'files', section: 'dependencies', default_path: 'atlas/dependencies.yaml', holds: 'The other repos this one needs, by repo id, and what it takes from each.', check: 'facts-section', keys_present: ['repos'] },
        { id: 'upkeep', listed_by: 'files', section: 'upkeep', default_path: 'atlas/upkeep.yaml', holds: 'The budget and the kill switch for the upkeep task.', check: 'facts-section', keys: ['budget'] },
        { id: 'areas', listed_by: 'areas', path: 'atlas.yaml', holds: 'The folders where Atlas flows run, and which of them read text that other people write.', check: 'areas' },
      ],
    },
    {
      id: 'docs-index', number: 5, title: 'Docs index', class: 'docs', written_by: 'the upkeep task; merges on its own',
      parts: [
        { id: 'docs-index', listed_by: 'parts', path: 'docs/index.md', holds: 'One line per file under docs/, with a status. A design folder is one line, for its design.yaml.', check: 'docs-index' },
      ],
    },
    {
      id: 'tooling', number: 6, title: 'Tooling', class: 'instruction', written_by: 'the helper; a person merges',
      parts: [
        // The literal, not the constant: this object is data, and the constant
        // is declared below it. A test keeps the two equal.
        { id: 'check-file', listed_by: 'parts', path: '.github/atlas/check.mjs', holds: 'The check itself, the copy this repo runs. One file, no dependency, carrying the Atlas version and the package commit it came from.', check: 'check-file' },
        { id: 'gate-workflow', listed_by: 'parts', path: '.github/workflows/atlas-gate.yml', holds: 'The gate workflow. Its shape job runs the base copy of .github/atlas/check.mjs over the merge base and the head of each pull request.', check: 'workflow' },
        {
          id: 'linters', listed_by: 'parts', holds: "The repo's own linters and formatters.", check: 'linters',
          candidates: ['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.json', '.eslintrc.cjs', '.prettierrc', '.prettierrc.json', 'prettier.config.js', 'biome.json', 'ruff.toml', '.ruff.toml', 'setup.cfg', 'tox.ini', '.flake8', 'rustfmt.toml', '.golangci.yml', '.golangci.yaml', '.editorconfig'],
        },
      ],
    },
  ],
  by_reference: {
    rule: 'A file under docs/ that an instruction file points at is instruction class by reference (D7 finding R1). The check computes that set and reports each member.',
    scanned: ['CLAUDE.md', 'AGENTS.md', '.claude/rules/*.md', '.claude/skills/*/SKILL.md', 'atlas.yaml', 'atlas/*.yaml'],
  },
});

// The ids that `parts:` may name, and the sections that `files:` may name.
export const LISTABLE_PARTS = Object.freeze(SPEC_3.files.flatMap((file) => file.parts).filter((part) => part.listed_by === 'parts').map((part) => part.id));
export const FILE_SECTIONS = Object.freeze(SPEC_3.files.flatMap((file) => file.parts).filter((part) => part.listed_by === 'files').map((part) => part.section));

export const SPECS = Object.freeze({ 3: SPEC_3 });

export class SpecError extends Error {}

export function loadSpec(version) {
  // Number() turns true into 1 and "0x1" into 1, so a boolean or a hex string
  // would silently read spec 1 (acceptance review of batch 14b, finding 8).
  // Take a whole number, or a string of decimal digits, and nothing else.
  const decimal = typeof version === 'number' || (typeof version === 'string' && /^\s*\d+\s*$/.test(version));
  const wanted = decimal ? Number(version) : NaN;
  if (!Number.isInteger(wanted) || wanted < 1) throw new SpecError(`atlas.yaml names spec "${version}"; the spec version must be a whole number`);
  const spec = SPECS[wanted];
  if (!spec && wanted < 3) throw new SpecError(`atlas.yaml is spec ${wanted}, which named a kind and read its parts from a kind table. Check version ${CHECK_VERSION} reads spec 3 only, where atlas.yaml lists its own parts (roadmap R62). Run "atlas tooling write", which prints the lines that move atlas.yaml to spec 3`);
  if (!spec) throw new SpecError(`spec ${wanted} is unknown to this copy of the check, check version ${CHECK_VERSION}; it reads spec ${Object.keys(SPECS).join(', ')}. Refresh .github/atlas/check.mjs, or set spec to a version this copy reads`);
  if (spec.spec !== wanted) throw new SpecError(`the spec object for version ${wanted} names version ${spec.spec}`);
  return spec;
}

// ---------------------------------------------------------------------------
// The secret patterns. A credentials file carries names only. A value in one is
// an error, not a finding. The list is here, in this file, so it can never go
// missing and disarm the only content check (review R-6). A test keeps it equal
// to work/protected-paths.json in the Atlas package, which is the authority for the same list in the
// M1 verbs.
// ---------------------------------------------------------------------------

// Each pattern carries a canary: a string that pattern must catch. The check
// tests every pattern against its own canary on every run, and raises an error
// when one misses.
//
// Why. The guard used to count the patterns, not test them. A pull request
// could replace all five with patterns that match nothing, and `scan` saw five
// usable regular expressions and stayed green. The only content check in the
// whole check was then silent for every later run, with no sign of it
// (security persona, finding S2-5).
//
// Every canary is joined from pieces at run time. Written whole, a canary
// would look like a credential to a secret scanner, and this file is committed
// and copied into other repositories. The same rule already governs the test
// fixtures (acceptance review of batch 14b, finding 1).
const canary = (...pieces) => pieces.join('');

export const SECRET_PATTERNS = Object.freeze([
  {
    id: 'named-value',
    holds: 'A named credential field with a value after it.',
    source: '(?i)(api[_-]?key|secret|token|password|passwd|authorization)\\s*[:=]\\s*\\S{8,}',
    canary: canary('api', '_key: ', 'N', '0'.repeat(11)),
  },
  {
    id: 'json-web-token',
    holds: 'A JSON web token, three base64url parts.',
    source: '\\b(?:eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,})\\b',
    canary: canary('ey', 'J', 'A'.repeat(12), '.', 'B'.repeat(12), '.', 'C'.repeat(12)),
  },
  {
    id: 'github-token',
    holds: 'A GitHub personal access token.',
    source: '\\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b',
    canary: canary('gh', 'p', '_', 'A'.repeat(24)),
  },
  {
    id: 'vendor-key',
    holds: 'A model-vendor key or an AWS access key id.',
    source: '\\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\\b',
    canary: canary('sk', '-', 'A'.repeat(24)),
  },
  {
    id: 'private-key',
    holds: 'The header line of a private key block.',
    source: '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    canary: canary('-----', 'BEGIN ', 'RSA ', 'PRIVATE KEY', '-----'),
  },
  // The sixth. A connection string is the likely shape of a leaked credential
  // here, and none of the five above matches one (security persona, finding
  // S3-11). It needs a user and a password before the host, so an ordinary URL
  // never matches.
  {
    id: 'url-credential',
    holds: 'A credential in URL form: a scheme, then a user name and a password, then the host.',
    source: '\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s:@/]+:[^\\s:@/]+@[^\\s/]+',
    canary: canary('postgres', '://', 'demo', ':', 'pa55', 'word', '@', 'db.example/atlas'),
  },
]);

// The authority for this same list in the M1 verbs is the package's work/protected-paths.json,
// and a test keeps the two equal.
export const SECRET_PATTERN_SOURCES = Object.freeze(SECRET_PATTERNS.map((pattern) => pattern.source));

// The sources are written with a leading (?i), which JavaScript spells as a flag.
const compile = (source) => {
  const insensitive = source.startsWith('(?i)');
  return new RegExp(insensitive ? source.slice(4) : source, insensitive ? 'i' : '');
};

export function secretPatterns() {
  return SECRET_PATTERN_SOURCES.map(compile);
}

// Every pattern this file declares, tested against its own canary. Returns the
// ids that missed. An empty list means the patterns still bite.
export function canaryMisses() {
  const missed = [];
  for (const pattern of SECRET_PATTERNS) {
    let caught = false;
    try { caught = compile(pattern.source).test(pattern.canary); } catch { caught = false; }
    if (!caught) missed.push(pattern.id);
  }
  return missed;
}

// ---------------------------------------------------------------------------
// The workflow that runs this file: the gate (roadmap R7, design
// docs/design-docs/shape-check-from-base/ in the Atlas repo). The tooling
// writer puts it into each repo from here. It runs on pull_request_target, so
// GitHub takes it from the base branch, and the check that judges a pull
// request is the base copy. It reads the head as git objects only, it holds a
// read token, and it pins its one action by commit SHA (design review finding
// R11).
//
// Check version 6 moved the check here from the old atlas-check.yml, which ran
// on pull_request with the head's copy of this file. A pull request could edit
// the check to print GREEN, and the check only warned that a person merges it.
// ---------------------------------------------------------------------------

export const WORKFLOW_PATH = '.github/workflows/atlas-gate.yml';
// The workflow of check versions 1 to 5. The tooling writer removes it.
export const OLD_WORKFLOW_PATH = '.github/workflows/atlas-check.yml';
export const CHECK_PATH = '.github/atlas/check.mjs';

// Where a run by hand, or an old workflow, puts the base tree. `walk` and
// `symlinks` skip every entry whose name starts with a dot, and every other
// read names an exact path, so no scanner ever reaches into it.
export const BASE_DIR = '.atlas-base';

// The two trees of the gate, under the runner's temp folder, outside the
// checkout. Each is written from git objects, and loses every link.
export const GATE_TREES = Object.freeze({ base: 'atlas-base', head: 'atlas-head' });

// The job and the check name. The name says the job runs the shape rule
// only, so no reader takes it for the full gate, which keeps the name `gate`
// (roadmap R76). A repo may add jobs to this file; the shape job must stay as
// Atlas writes it, and `atlas status` compares that job.
export const SHAPE_JOB = 'shape';
export const SHAPE_CHECK = 'gate · shape';

export const WORKFLOW_HEADER = `# The Atlas gate workflow, in this repo's own CI. Its shape job is the repo
# shape check, judged from the base.
#
# It runs on pull_request_target, so GitHub runs this file as the base branch
# holds it. The job checks out the base and runs the base copy of
# ${CHECK_PATH}. It fetches the head as git objects only, and runs none of it.
#
# The check writes two trees from git objects, the merge base and the head, in
# the runner's temp folder, and scores them side by side. No attribute of a
# tree applies, and no link is written. The no-loss rule says red when a part
# that the base had is taken away. It says owner when only the owner may
# approve the change, such as a change to the check or to this file.
#
# The token can only read. No checkout keeps a credential: the one fetch of
# the head takes the token for that command alone. The check step holds no
# token. The job writes two output keys, result and class.
#
# Atlas writes this file and ${CHECK_PATH}; do not edit the shape job by hand.
# Design: docs/design-docs/shape-check-from-base/ in the Atlas repo.
name: atlas-gate
run-name: "gate #\${{ github.event.pull_request.number }} at \${{ github.event.pull_request.head.sha }}"
on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited, ready_for_review]
permissions:
  contents: read
concurrency:
  group: atlas-gate-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
`;

export const SHAPE_JOB_TEXT = `  ${SHAPE_JOB}:
    name: ${SHAPE_CHECK}
    runs-on: ubuntu-latest
    # The check reads two trees and opens no network. It finishes in seconds
    # on a small repo. The bound stops a runner being billed until someone
    # kills it; a run that hits it is red.
    timeout-minutes: 10
    outputs:
      result: \${{ steps.shape.outputs.result }}
      class: \${{ steps.shape.outputs.class }}
    steps:
      # actions/checkout v7.0.1
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          ref: \${{ github.sha }}
          fetch-depth: 0
          persist-credentials: false
      # actions/setup-node v7.0.0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version: "22.22.0"
      - name: Fetch the head as objects only
        env:
          PR: \${{ github.event.pull_request.number }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          TOKEN: \${{ github.token }}
        run: |
          set -euo pipefail
          header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)"
          git -c "http.https://github.com/.extraheader=$header" fetch --no-tags --no-recurse-submodules origin "+refs/pull/$PR/head:refs/atlas-gate/head"
          got="$(git rev-parse --verify refs/atlas-gate/head^{commit})"
          if [ "$got" != "$HEAD_SHA" ]; then
            echo "::error::the fetched head is $got, not the head of the event $HEAD_SHA. Push again."
            exit 1
          fi
      - name: Shape check from the base
        id: shape
        env:
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: |
          set -euo pipefail
          if [ ! -f ${CHECK_PATH} ]; then
            echo "OWNER: first-run: the base has no ${CHECK_PATH}, so the owner reads the first shape"
            echo "result=owner" >> "$GITHUB_OUTPUT"
            echo "class=first-run" >> "$GITHUB_OUTPUT"
            exit 1
          fi
          node ${CHECK_PATH} --gate --repo "$GITHUB_REPOSITORY" --base-commit "$GITHUB_SHA" --head-commit "$HEAD_SHA"
`;

export const WORKFLOW_TEMPLATE = `${WORKFLOW_HEADER}${SHAPE_JOB_TEXT}`;

// The shape job of a workflow text: from its key line to the next job key or
// the end. `atlas status` compares it with SHAPE_JOB_TEXT.
export function shapeJobOf(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.indexOf(`  ${SHAPE_JOB}:`);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^ {2}\S/.test(lines[end]) && !/^\S/.test(lines[end])) end += 1;
  return `${lines.slice(start, end).join('\n').replace(/\n+$/, '')}\n`;
}

// ---------------------------------------------------------------------------
// The YAML reader. Atlas ships no dependency, so the check reads the subset of
// YAML that atlas.yaml, the section files and a SKILL.md front matter block
// use: comments, nested maps by indentation, lists of scalars and of maps,
// quoted and plain scalars, null, booleans, numbers, and the block scalars
// | and >. Anything outside that subset raises, so a file is never half
// understood.
// ---------------------------------------------------------------------------

// A parse error names where it is. It never carries what is there.
//
// It used to put up to sixty characters of the offending line into the
// message, and `checkCredentials` returned that message before it ran the
// secret patterns. A credential written with bad indentation therefore reached
// the CI log and the job summary, and the scan that would have caught it never
// ran (security persona, finding S2-6; amendment A1.6 section 4.9). The line
// and the column say where to look. The reader opens the file.
export class YamlError extends Error {
  constructor(message, line, column) {
    const at = line === undefined ? '' : column === undefined
      ? ` (line ${line + 1})`
      : ` (line ${line + 1}, column ${column + 1})`;
    super(`${message}${at}`);
    this.name = 'YamlError';
    this.line = line;
    this.column = column;
  }
}

const KEY = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^:#]+?))\s*:(?:\s+(.*))?$/;

// One level of flow style, for scalars only: [a, b] and { a: 1, b: two }.
// A nested bracket raises, so a file is never half understood.
function flow(text, lineNumber) {
  const open = text[0], close = open === '[' ? ']' : '}';
  if (!text.endsWith(close)) throw new YamlError(`a flow ${open === '[' ? 'list' : 'map'} does not close`, lineNumber);
  const body = text.slice(1, -1);
  if (/[[\]{}]/.test(body)) throw new YamlError('a nested flow value is not read by this check; use a block list or map', lineNumber);
  const parts = body.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (open === '[') return parts.map((part) => scalar(part, lineNumber));
  const out = {};
  for (const part of parts) {
    const at = part.indexOf(':');
    if (at === -1) throw new YamlError('a flow map entry has no colon', lineNumber);
    out[part.slice(0, at).trim().replace(/^["']|["']$/g, '')] = scalar(part.slice(at + 1), lineNumber);
  }
  return out;
}

function scalar(raw, lineNumber) {
  const text = raw === undefined ? '' : raw.trim();
  if (!text || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  if (text === '[]') return [];
  if (text === '{}') return ({});
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new YamlError('a double quoted value does not close', lineNumber);
    return text.slice(1, -1).replace(/\\(.)/g, (_, character) => ({ n: '\n', t: '\t', r: '\r' })[character] ?? character);
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new YamlError('a single quoted value does not close', lineNumber);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.startsWith('[') || text.startsWith('{')) return flow(text, lineNumber);
  const plain = text.replace(/\s+#.*$/, '').trim();
  if (/^-?\d+$/.test(plain)) return Number(plain);
  if (/^-?\d+\.\d+$/.test(plain)) return Number(plain);
  return plain;
}

function indentOf(line) {
  if (/^\t/.test(line)) throw new YamlError('a tab starts a line; YAML indents with spaces');
  return line.length - line.trimStart().length;
}

// `strict` is for atlas.yaml. It refuses a key that appears twice, an anchor,
// an alias and a merge key. Each one lets two readers see two different maps
// in one file, and the owner-only reader and this check must see the same one
// (security review of the owner-only list, 24 October 2026).
export function parseYaml(source, { strict = false } = {}) {
  const raw = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // A document marker is allowed only before the first content line. After
    // that it starts a second document, and merging two documents into one map
    // lets a later key silently override an earlier one (review R-4). `spec`
    // and `parts` decide which files a repo needs, so a silent override there
    // is a silent wrong answer.
    if (/^(---|\.\.\.)\s*$/.test(line)) {
      if (lines.length) throw new YamlError('a second document starts here; this check reads one document per file', index, 0);
      continue;
    }
    if (/^\t/.test(line)) throw new YamlError('a tab starts a line; YAML indents with spaces', index, 0);
    lines.push({ text: line, number: index, indent: indentOf(line) });
  }
  if (!lines.length) return null;
  const state = { at: 0 };

  function blockScalar(header, indent) {
    const fold = header.startsWith('>');
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
    const parts = [];
    let inner = null;
    while (state.at < lines.length && lines[state.at].indent > indent) {
      const line = lines[state.at];
      if (inner === null) inner = line.indent;
      parts.push(line.text.slice(Math.min(inner, line.indent)));
      state.at += 1;
    }
    let text = fold ? parts.join(' ') : parts.join('\n');
    if (chomp !== 'strip') text += '\n';
    return text;
  }

  function value(indent) {
    if (state.at >= lines.length || lines[state.at].indent < indent) return null;
    return lines[state.at].text.trimStart().startsWith('- ') || lines[state.at].text.trim() === '-'
      ? list(lines[state.at].indent)
      : map(lines[state.at].indent);
  }

  function list(indent) {
    const out = [];
    while (state.at < lines.length && lines[state.at].indent === indent) {
      const line = lines[state.at];
      const body = line.text.trimStart();
      if (!body.startsWith('- ') && body !== '-') break;
      const rest = body === '-' ? '' : body.slice(2);
      if (strict && /^[&*]/.test(rest.trim())) throw new YamlError('an anchor or an alias is not read in strict mode', line.number, line.indent);
      state.at += 1;
      if (!rest.trim()) { out.push(value(indent + 1)); continue; }
      const match = KEY.exec(rest);
      if (match) {
        // A list entry that starts a map: re-read it at the column the key sits in.
        const keyColumn = indent + (body === '-' ? 1 : 2);
        state.at -= 1;
        lines[state.at] = { text: ' '.repeat(keyColumn) + rest, number: line.number, indent: keyColumn };
        out.push(map(keyColumn));
        continue;
      }
      out.push(scalar(rest, line.number));
    }
    return out;
  }

  function map(indent) {
    const out = {};
    while (state.at < lines.length && lines[state.at].indent === indent) {
      const line = lines[state.at];
      const body = line.text.trimStart();
      if (body.startsWith('- ')) break;
      const match = KEY.exec(body);
      if (!match) throw new YamlError('this line is neither a key nor a list entry', line.number, line.indent);
      const key = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2].replaceAll("''", "'") : match[3].trim();
      const rest = (match[4] ?? '').trim();
      if (strict) {
        if (Object.hasOwn(out, key)) throw new YamlError(`the key "${key}" appears twice`, line.number, line.indent);
        if (key === '<<' || /^[&*]/.test(key)) throw new YamlError('a merge key, an anchor or an alias is not read in strict mode', line.number, line.indent);
        if (/^[&*]/.test(rest)) throw new YamlError('an anchor or an alias is not read in strict mode', line.number, line.indent);
      }
      state.at += 1;
      if (/^[|>][-+]?\d*$/.test(rest)) { out[key] = blockScalar(rest, indent); continue; }
      if (rest && !rest.startsWith('#')) { out[key] = scalar(rest, line.number); continue; }
      out[key] = value(indent + 1);
    }
    return out;
  }

  const result = value(lines[0].indent);
  if (state.at < lines.length) throw new YamlError('the indentation goes back out to a column no parent uses', lines[state.at].number, lines[state.at].indent);
  return result;
}

// The front matter block of a SKILL.md or a rule file: the text between the
// first two `---` lines. Returns null when the file has no front matter.
export function frontMatter(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(4, end + 1);
  const parsed = parseYaml(block);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// The scanners. One per part of the spec.
// ---------------------------------------------------------------------------

export const STATES = Object.freeze(['filled', 'empty', 'stale', 'not listed']);
export const NOT_FILLED = Object.freeze(['empty', 'stale']);
export const CREDENTIAL_NAME = /^[A-Z][A-Z0-9_]*$/;
const PINNED = /^[0-9a-f]{40}$/;
const MAX_LISTED = 12;

const readText = (root, path) => { try { return readFileSync(join(root, path), 'utf8'); } catch { return null; } };
const isDirectory = (root, path) => { try { return statSync(join(root, path)).isDirectory(); } catch { return false; } };
const isFile = (root, path) => { try { return statSync(join(root, path)).isFile(); } catch { return false; } };

function walk(root, path, out = []) {
  let entries;
  try { entries = readdirSync(join(root, path), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const child = posix.join(path, entry.name);
    if (entry.isDirectory()) walk(root, child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

// Every symbolic link under a path. `walk` pushes only `entry.isFile()`, and a
// symbolic link is neither a file nor a directory, so it was invisible: a page
// under docs/ could be a link to any path in the repository, the check scored
// nothing, and a renderer that follows the link publishes what it points at
// (security persona, finding S3-10). This does not follow a link, so a loop is
// not reachable.
function symlinks(root, path, out = []) {
  let entries;
  try { entries = readdirSync(join(root, path), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const child = posix.join(path, entry.name);
    if (entry.isSymbolicLink()) out.push(child);
    else if (entry.isDirectory()) symlinks(root, child, out);
  }
  return out;
}

// A symbolic link is a finding, never a state on its own: the part it sits
// under says what state it makes.
function symlinkFindings(root, path) {
  const found = symlinks(root, path);
  return found.length
    ? [`${found.length} symbolic link(s) under ${path}/: ${found.slice(0, MAX_LISTED).join(', ')}; the check does not follow one`]
    : [];
}

// Relative link targets a markdown file points at. Placeholders and parent
// paths are left out: they are not this repo's files.
export function pointers(text) {
  const out = new Set();
  for (const [, target] of String(text ?? '').matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const path = target.split('#')[0].trim();
    if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.startsWith('..') || path.startsWith('#')) continue;
    if (/[<>*{}$\\]/.test(path) || path.includes('...')) continue;
    out.add(path.replace(/^\.\//, ''));
  }
  return [...out];
}

// Every docs/ path an instruction file names, as a link, in backticks, or bare.
// One spelling per file. `docs/./index.md` and `docs//index.md` name the file
// `docs/index.md` names, and every consumer compares these paths as strings:
// the exemption below, and the merge actor of slice L4, which takes its
// excluded set from this list. Two characters of spelling would otherwise make
// a second row and leave the first one reading "nothing else names it", which
// is a false sentence in a report a gate reads.
export function normalizeDocsPath(path) {
  const parts = [];
  for (const piece of String(path).split('/')) {
    if (piece === '' || piece === '.') continue;
    if (piece === '..') { parts.pop(); continue; }
    parts.push(piece);
  }
  return parts.join('/');
}

export function docsReferences(text) {
  const out = new Set();
  for (const [, path] of String(text ?? '').matchAll(/(?:^|[\s`(\[<"'])(docs\/[A-Za-z0-9._/-]+)/g)) {
    const clean = normalizeDocsPath(path.replace(/[.,;:]+$/, ''));
    if (!clean.startsWith('docs/') || clean.endsWith('/') || /[<>*{}$]/.test(clean)) continue;
    out.add(clean);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// The docs index rule. One rule, here, for the check and for `atlas upkeep
// check` (roadmap R62 line 5). Before check version 10 each one read the index
// its own way: the check read every link, and upkeep read links outside code,
// skipped archive/ and fixtures/, and counted a design folder as one line. On
// one tree they gave two counts.
//
// 1. docs/index.md lists each .md file under docs/.
// 2. A file in a design folder (a folder that holds design.yaml) counts as
//    listed when the index lists that folder's design.yaml.
// 3. Each listed path exists.
// 4. A link inside code is not a listing. Dot folders, node_modules, archive/
//    and any folder named fixtures are skipped.
// ---------------------------------------------------------------------------

export const DOCS_INDEX_PATH = 'docs/index.md';
const DOCS_SKIP = new Set(['node_modules', 'archive', 'fixtures']);

// Every .md file under the root, as a posix path. Dot folders, node_modules,
// archive/ and any folder named fixtures are skipped.
export function markdownFiles(root, under = '') {
  const out = [];
  const visit = (rel) => {
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!DOCS_SKIP.has(entry.name)) visit(path); }
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path);
    }
  };
  visit(under);
  return out.sort();
}

// Text outside code: fenced blocks of three or more marks, and inline code.
export function proseOf(text) {
  const lines = String(text ?? '').split('\n');
  const kept = [];
  let fence = null;
  for (const one of lines) {
    const open = one.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !one.trim().slice(open[1].length).trim()) fence = null;
      kept.push('');
      continue;
    }
    if (open) { fence = open[1]; kept.push(''); continue; }
    kept.push(one.replace(/`+[^`\n]*`+/g, ''));
  }
  return kept.join('\n');
}

// The relative link targets in one markdown text, with their line numbers.
export function linkTargets(text) {
  const out = [];
  proseOf(text).split('\n').forEach((one, index) => {
    for (const [, angled, bare] of one.matchAll(/\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g)) {
      const raw = angled ?? bare;
      const target = raw.split('#')[0].split('?')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
      if (/[{}$*\\]/.test(target)) continue;
      let decoded = target;
      try { decoded = decodeURIComponent(target); } catch { /* keep it as written */ }
      out.push({ target: decoded, line: index + 1 });
    }
  });
  return out;
}

// The nearest folder at or above `file` that holds design.yaml, or null.
function designFolderOf(root, file) {
  let dir = posix.dirname(file);
  while (dir && dir !== '.' && dir !== 'docs') {
    if (existsSync(join(root, dir, 'design.yaml'))) return dir;
    dir = posix.dirname(dir);
  }
  return null;
}

// The answer: `checked` is false with no docs/ folder; `missing` is true with
// no index; `unlisted` and `gone` are sorted paths; `files` is the count of
// .md files under docs/ besides the index.
export function docsIndexRule(root) {
  if (!isDirectory(root, 'docs')) return { checked: false, missing: false, files: 0, unlisted: [], gone: [] };
  const onDisk = markdownFiles(root, 'docs').filter((path) => path !== DOCS_INDEX_PATH);
  const text = readText(root, DOCS_INDEX_PATH);
  if (text === null || !text.trim()) return { checked: true, missing: true, files: onDisk.length, unlisted: onDisk, gone: [] };
  const listed = new Set();
  for (const { target } of linkTargets(text)) {
    if (target.startsWith('/')) continue;
    const path = posix.normalize(posix.join('docs', target)).replace(/\/$/, '');
    if (path.startsWith('docs/')) listed.add(path);
  }
  const unlisted = onDisk.filter((path) => {
    if (listed.has(path)) return false;
    const folder = designFolderOf(root, path);
    return !(folder && listed.has(`${folder}/design.yaml`));
  });
  const gone = [...listed].filter((path) => !existsSync(join(root, path))).sort();
  return { checked: true, missing: false, files: onDisk.length, unlisted, gone };
}

const result = (part, state, findings = []) => ({ id: part.id, path: part.path ?? part.default_path ?? null, procedure: part.procedure ?? null, holds: part.holds ?? '', class: part.class ?? null, state, findings });

function checkMarkdown(context, part) {
  const text = readText(context.root, part.path);
  if (text === null || !text.trim()) return result(part, 'empty', [`${part.path} is missing or holds nothing`]);
  // Design page D1 says the check says "wrong" when the entry map is missing,
  // over its line limit, or a pointer is dead. All three are states, not notes
  // on a filled file, or the count the report leads with is short (review R-1).
  const findings = [];
  const lines = text.replace(/\n$/, '').split('\n').length;
  if (part.max_lines && lines > part.max_lines) findings.push(`${lines} lines, over the ${part.max_lines}-line limit`);
  const dead = pointers(text).filter((path) => !existsSync(join(context.root, path)));
  if (dead.length) findings.push(`${dead.length} pointer(s) name nothing on disk: ${dead.slice(0, MAX_LISTED).join(', ')}`);
  return findings.length ? result(part, 'stale', findings) : result(part, 'filled');
}

function checkPathRules(context, part) {
  if (!isDirectory(context.root, part.path)) return result(part, 'empty', [`${part.path}/ does not exist`]);
  const files = walk(context.root, part.path).filter((path) => path.endsWith('.md'));
  if (!files.length) return result(part, 'empty', [`${part.path}/ holds no rule`]);
  const bad = [];
  for (const file of files) {
    const front = frontMatter(readText(context.root, file) ?? '');
    const paths = front?.paths;
    const list = Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : [];
    if (!list.length) { bad.push(`${file} has no paths: key`); continue; }
    for (const pattern of list) {
      const base = String(pattern).split(/[*?[]/)[0].replace(/\/+$/, '');
      if (base && !insideRepo(context.root, base)) { bad.push(`${file} names a path outside the repo`); continue; }
      if (base && !existsSync(join(context.root, base))) bad.push(`${file} names ${pattern}, which does not exist`);
    }
  }
  return bad.length ? result(part, 'stale', bad.slice(0, MAX_LISTED)) : result(part, 'filled', [`${files.length} rule file(s)`]);
}

const SKILL_NAME = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

function checkProcedure(context, part) {
  const named = context.facts?.procedures?.[part.procedure];
  if (named === undefined) return result(part, 'empty', [`atlas.yaml has no procedures entry for ${part.procedure}`]);
  if (named === null || named === '') return result(part, 'empty', [`atlas.yaml sets procedures.${part.procedure} to null: the repo has no skill for it yet`]);
  // A skill name is one folder name. A slash, a dot pair or a control
  // character would let atlas.yaml point the check outside the skills folder,
  // or outside the tree it scores (security review of roadmap R7).
  if (!SKILL_NAME.test(String(named))) return result(part, 'stale', [`atlas.yaml names a skill for ${part.procedure} that is not one folder name`]);
  const skill = posix.join('.claude/skills', String(named), 'SKILL.md');
  const at = { ...part, path: skill };
  if (!isFile(context.root, skill)) return result(at, 'stale', [`atlas.yaml names skill "${named}", and ${skill} does not exist`]);
  const front = frontMatter(readText(context.root, skill) ?? '');
  if (!front?.name || !front?.description) return result(at, 'stale', [`${skill} has no name or no description in its front matter`]);
  return result(at, 'filled', [skill]);
}

// `scan` reports a missing or unreadable atlas.yaml as an error and returns
// before it scans any part, because the file lists the parts. So this scanner
// only ever runs on a file that parsed (acceptance review of batch 14b,
// finding 4).
function checkFactsRoot(context, part) {
  const missing = (part.keys ?? []).filter((key) => context.facts[key] === undefined || context.facts[key] === null || context.facts[key] === '');
  if (missing.length) return result(part, 'stale', [`atlas.yaml has no ${missing.join(', ')}`]);
  if (context.repoId && String(context.facts.repo) !== context.repoId) return result(part, 'stale', [`atlas.yaml names repo "${context.facts.repo}"; this checkout is ${context.repoId}`]);
  return result(part, 'filled');
}

function sectionPath(context, part) {
  const pointed = context.facts?.files?.[part.section];
  return typeof pointed === 'string' && pointed.trim() ? pointed.trim() : part.default_path;
}

// A pointer in atlas.yaml names a file inside this repo. One that leaves the
// checkout would make the check read a stranger's file, and a parse error
// would carry a line of it into the CI log (review R-5).
export function insideRepo(root, path) {
  const base = resolve(root);
  const target = resolve(base, path);
  const step = relative(base, target);
  return step !== '' && !step.startsWith('..') && !posix.isAbsolute(step.split('\\').join('/'));
}

function readSection(context, part) {
  const path = sectionPath(context, part);
  if (!insideRepo(context.root, path)) return { path, outside: true };
  const text = readText(context.root, path);
  if (text === null || !text.trim()) return { path, missing: true };
  try { return { path, text, data: parseYaml(text) }; }
  catch (error) { return { path, text, error: error instanceof YamlError ? error.message : String(error?.message ?? error) }; }
}

const emptyValue = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);

// A secret in any file the check reads, over the raw text, before anything is
// parsed or echoed. The patterns used to run over atlas/credentials.yaml alone,
// and every other facts file has its values quoted into findings: the
// repo id, a procedure's skill name, a pointer path (acceptance review of batch
// 16, note S3-2).
function secretIn(context, path, text) {
  if (context.secretsAt.has(path)) return true;
  for (const pattern of context.secretPatterns) {
    if (pattern.test(text ?? '')) {
      context.secretsAt.add(path);
      context.errors.push(`${path} holds something that looks like a secret value; no file the check reads carries one`);
      return true;
    }
  }
  return false;
}

function checkFactsSection(context, part) {
  const section = readSection(context, part);
  const withPath = { ...part, path: section.path };
  if (section.outside) return result(withPath, 'stale', [`atlas.yaml points at "${section.path}", which is outside the repo; the check reads this repo only`]);
  if (section.missing) return result(withPath, 'empty', [`${section.path} does not exist`]);
  if (secretIn(context, section.path, section.text)) return result(withPath, 'stale', [`${section.path} holds something that looks like a secret value`]);
  if (section.error) return result(withPath, 'stale', [`${section.path} cannot be read: ${section.error}`]);
  // `keys` must hold content. `keys_present` must exist and may be empty: a
  // repo with no dependency still answers, with `repos: []`.
  const missing = (part.keys ?? []).filter((key) => emptyValue(section.data?.[key]));
  const absent = (part.keys_present ?? []).filter((key) => section.data?.[key] === undefined || section.data?.[key] === null);
  const findings = [...missing, ...absent];
  if (findings.length) return result(withPath, 'stale', [`${section.path} has no ${findings.join(', ')}`]);
  return result(withPath, 'filled');
}

function checkCredentials(context, part) {
  const section = readSection(context, part);
  const withPath = { ...part, path: section.path };
  if (section.outside) return result(withPath, 'stale', [`atlas.yaml points at "${section.path}", which is outside the repo; the check reads this repo only`]);
  if (section.missing) return result(withPath, 'empty', [`${section.path} does not exist`]);
  // The patterns run over the raw text FIRST, before anything reads the parse
  // result and before a parse error can be reported. A credential written with
  // bad indentation used to take the parse-error path out of this function, so
  // the one content check in the whole check never ran on the one file it
  // guards (security persona, finding S2-6).
  if (secretIn(context, section.path, section.text)) return result(withPath, 'stale', [`${section.path} holds something that looks like a secret value`]);
  if (section.error) return result(withPath, 'stale', [`${section.path} cannot be read: ${section.error}`]);
  const rows = section.data?.credentials;
  if (emptyValue(rows)) return result(withPath, 'stale', [`${section.path} has no credentials`]);
  const names = (Array.isArray(rows) ? rows : Object.values(rows)).map((row) => (typeof row === 'string' ? row : row?.name));
  const bad = names.filter((name) => !CREDENTIAL_NAME.test(String(name ?? '')));
  if (bad.length) return result(withPath, 'stale', [`${bad.length} credential name(s) are not written as A-Z, digits and underscore: ${bad.slice(0, MAX_LISTED).join(', ')}`]);
  return result(withPath, 'filled', [`${names.length} credential name(s)`]);
}

// The areas part: where Atlas flows run, and which areas read text that
// other people write. Each entry is a path, or a map with `path` and
// `outside_text: true`. A path is "." or a folder inside the repo, by the
// same test as a pointer (design parts-and-areas, security 4).
const AREA_KEYS = Object.freeze(['path', 'outside_text']);

function checkAreas(context, part) {
  const list = context.facts?.areas;
  if (!Array.isArray(list) || !list.length) return result(part, 'empty', ['atlas.yaml has an areas key that is not a list of areas']);
  const bad = [];
  let outside = 0;
  list.forEach((entry, index) => {
    const at = `areas[${index}]`;
    const map = typeof entry === 'string' ? { path: entry } : entry;
    if (!map || typeof map !== 'object' || Array.isArray(map)) { bad.push(`${at} is not a path or a map with a path`); return; }
    for (const key of Object.keys(map)) if (!AREA_KEYS.includes(key)) bad.push(`${at} has the key "${key}"; the keys are ${AREA_KEYS.join(' and ')}`);
    if (map.outside_text !== undefined && typeof map.outside_text !== 'boolean') bad.push(`${at}.outside_text is not true or false`);
    if (map.outside_text === true) outside += 1;
    const path = typeof map.path === 'string' ? map.path.trim().replace(/\/+$/, '') : '';
    if (!path) { bad.push(`${at} has no path`); return; }
    if (path !== '.' && !insideRepo(context.root, path)) { bad.push(`${at} names a path outside the repo`); return; }
    if (!isDirectory(context.root, path)) bad.push(`${at} names ${path}, which is not a folder`);
  });
  if (bad.length) return result(part, 'stale', bad.slice(0, MAX_LISTED));
  return result(part, 'filled', [`${list.length} area(s), ${outside} read outside text`]);
}

function checkDocsIndex(context, part) {
  const rule = docsIndexRule(context.root);
  if (!rule.checked || rule.missing) return result(part, 'empty', [`${part.path} is missing or holds nothing`]);
  const findings = [];
  if (rule.unlisted.length) findings.push(`${rule.unlisted.length} file(s) under docs/ are not listed: ${rule.unlisted.slice(0, MAX_LISTED).join(', ')}`);
  if (rule.gone.length) findings.push(`${rule.gone.length} listed file(s) are gone: ${rule.gone.slice(0, MAX_LISTED).join(', ')}`);
  findings.push(...symlinkFindings(context.root, 'docs'));
  return findings.length ? result(part, 'stale', findings) : result(part, 'filled', [`${rule.files} file(s) listed`]);
}

// Every permission the workflow grants at anything other than read. It reads a
// block map under `permissions:` and a flow map on the same line.
function writeGrants(text) {
  const out = [];
  const flow = /^\s*permissions\s*:\s*\{([^}]*)\}/m.exec(text);
  if (flow) {
    for (const pair of flow[1].split(',')) {
      const [name, value] = pair.split(':').map((piece) => (piece ?? '').trim());
      if (name && value && value !== 'read' && value !== 'none') out.push(`${name}: ${value}`);
    }
    return out;
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const head = lines.findIndex((line) => /^\s*permissions\s*:\s*$/.test(line));
  if (head === -1) return out;
  const indent = lines[head].length - lines[head].trimStart().length;
  for (let index = head + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.length - line.trimStart().length <= indent) break;
    const [name, value] = line.split(':').map((piece) => (piece ?? '').trim());
    if (name && value && value !== 'read' && value !== 'none') out.push(`${name}: ${value}`);
  }
  return out;
}

// Everything the check can only learn from the workflow's STRUCTURE, read from
// the parsed document and never from a line of text.
//
// The first version of this read lines. The acceptance reviewer of batch 16
// defeated it nine ways (finding S2-1). Three of those mattered most: replace
// the step that runs the check, delete it, or set `steps: []`, and the part
// still read "filled". A rule about "an `if:` on the check step" means nothing
// when nothing requires the check step to be there at all.
//
// A workflow this function cannot read is a finding, not a pass. That is the
// safe direction: the check says it cannot confirm the job runs, instead of
// saying the job is fine.
// The step that runs the shape check, and the flags it must pass.
const GATE_RUNNER = Object.freeze({ runs: `node ${CHECK_PATH} `, flags: ['--gate', '--base-commit', '--head-commit'] });

function workflowStructure(document) {
  const out = [];
  const jobs = document?.jobs;
  if (!jobs || typeof jobs !== 'object') return ['the workflow declares no jobs'];

  // The trigger. `paths` and `paths-ignore` stop the job from running at all on
  // the pull requests that change the files it guards, and the pull request
  // still reads green, because a job that never ran reports nothing (P13).
  const on = document.on;
  const trigger = on && typeof on === 'object' && !Array.isArray(on) ? on.pull_request_target : null;
  if (trigger && typeof trigger === 'object' && !Array.isArray(trigger)) {
    for (const key of ['paths', 'paths-ignore', 'branches-ignore']) {
      if (trigger[key] !== undefined && trigger[key] !== null) {
        out.push(`the workflow narrows its trigger with ${key}; this check must run on every pull request`);
      }
    }
  }

  // The step that runs the check. Without it the workflow is a workflow that
  // runs nothing, and every rule below has nothing to attach to.
  let found = null;
  for (const [jobName, job] of Object.entries(jobs)) {
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      const runs = typeof step?.run === 'string' ? step.run : '';
      if (runs.includes(GATE_RUNNER.runs)) found = { jobName, job, step, runs, runner: GATE_RUNNER };
    }
  }
  if (!found) {
    out.push(`no step in this workflow runs "node ${CHECK_PATH} --gate", so the job reports nothing`);
    return out;
  }

  // The flags. Without them the check still runs and still goes green, and the
  // no-loss rule never runs at all, or it scores the wrong tree. Deleting a
  // flag is the cheapest way to silence the job, so the scanner reads the flags,
  // not just the path (finding S2-1).
  for (const flag of found.runner.flags) {
    if (!new RegExp(`${flag}(?:[ \t=]|$)`, 'm').test(found.runs)) {
      out.push(`the check step does not pass ${flag}, so the no-loss rule cannot judge the pull request from the base`);
    }
  }
  // Every checkout is of the base commit and keeps no credential. A checkout
  // of the head would run the head's copy of the check: the hole this
  // workflow exists to close.
  const checkouts = (Array.isArray(found.job?.steps) ? found.job.steps : [])
    .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout'));
  if (!checkouts.length) out.push('no step checks the base commit out, so there is no base copy of the check to run');
  for (const step of checkouts) {
    if (String(step?.with?.ref ?? '').replace(/\s+/g, '') !== '${{github.sha}}') out.push('a checkout step does not check out github.sha, the base commit; the check must run from the base');
    if (step?.with?.['persist-credentials'] !== false) out.push('a checkout step keeps its credential; set persist-credentials: false');
  }

  // A condition switches the step, or its whole job, off. Same effect as a
  // narrowed trigger, by another route.
  if (found.step.if !== undefined) out.push('the workflow puts an if: on the check step; the step must always run');
  if (found.job.if !== undefined) out.push("the workflow puts an if: on the check's job; the job must always run");
  // Two more ways to make a red check look green (reviewer of batch 16, S2-1).
  if (found.step['continue-on-error'] === true || found.job['continue-on-error'] === true) {
    out.push('the workflow sets continue-on-error on the check; a failed check would not turn the job red');
  }
  if (/\|\|\s*(true|exit\s+0|:)\s*$/m.test(found.runs)) {
    out.push('the check step swallows its own exit code, so a failed check would not turn the job red');
  }
  return out;
}

// The shape check takes no secret. The rule reads the job that runs the check
// and the workflow-wide env, which every job gets. Another job of the same file
// may give one step a secret: the gate step gets the private terms (roadmap
// R18), and it runs the base code too. When the file cannot be read, or no job
// runs the check, the rule reads the whole text.
function readsSecret(text) {
  const READS = /\bsecrets\./;
  let document = null;
  try { document = parseYaml(text); } catch { return READS.test(text); }
  const jobs = document?.jobs && typeof document.jobs === 'object' ? Object.values(document.jobs) : [];
  const job = jobs.find((candidate) => (Array.isArray(candidate?.steps) ? candidate.steps : [])
    .some((step) => typeof step?.run === 'string' && step.run.includes(GATE_RUNNER.runs)));
  if (!job) return READS.test(text);
  return READS.test(JSON.stringify(job)) || READS.test(JSON.stringify(document.env ?? null));
}

function checkWorkflow(context, part) {
  const text = readText(context.root, part.path);
  if (text === null || !text.trim()) return result(part, 'empty', [`${part.path} is missing or holds nothing`]);
  const findings = [];
  // pull_request_target takes this file from the base branch. On pull_request,
  // GitHub runs the copy the pull request carries, and the pull request can
  // change its own judge (roadmap R7).
  if (!/^\s*pull_request_target\s*:/m.test(text)) findings.push('the workflow does not run on pull_request_target; it must take its file and the check from the base');
  if (/^\s*pull_request\s*:/m.test(text)) findings.push('the workflow also runs on pull_request, which runs the head copy of this file');
  // The structure, from the parsed document. A workflow this check cannot read
  // is a finding: it can no longer say the job runs at all.
  try {
    findings.push(...workflowStructure(parseYaml(text)));
  } catch (error) {
    findings.push(`${part.path} cannot be read, so the check cannot confirm this workflow runs it: ${error instanceof YamlError ? error.message : 'the file is not the YAML subset this check reads'}`);
  }
  if (!/^\s*timeout-minutes\s*:\s*\d+\s*$/m.test(text)) findings.push('the workflow sets no timeout-minutes; a run with no wall-clock bound is billed until it is killed');
  if (!/^\s*contents\s*:\s*read\s*$/m.test(text)) findings.push('the workflow does not set permissions contents: read');
  // A write permission beside the read one still grants write. GitHub accepts
  // a block map and a flow map for both permissions and steps, so read both
  // spellings or a workflow can widen itself past the check (review R-3).
  for (const grant of writeGrants(text)) findings.push(`the workflow grants ${grant}; this check needs read access only`);
  if (readsSecret(text)) findings.push('the workflow reads a repository secret; this check takes none');
  const unpinned = [...text.matchAll(/uses[ \t]*:[ \t]*["']?([^\s,}\]"']+)/g)]
    .map(([, value]) => value)
    .filter((value) => !value.startsWith('./'))
    .filter((value) => !PINNED.test(value.split('@')[1] ?? ''));
  if (unpinned.length) findings.push(`${unpinned.length} action(s) are not pinned by commit SHA: ${unpinned.slice(0, MAX_LISTED).join(', ')}`);
  return findings.length ? result(part, 'stale', findings) : result(part, 'filled');
}

// The stamps a copy of the check carries, read from its text. Reading the text
// works for any copy; importing it would only work for this one.
//
// A copy from before row F11 carries no CHECK_VERSION. When it declares a spec,
// it still reads as the Atlas check, so the no-loss rule can score a base tree that
// holds an old copy.
export function checkStamps(text) {
  const check = /^export const CHECK_VERSION = (\d+);/m.exec(text ?? '');
  const specs = [...String(text ?? '').matchAll(/^export const SPEC_(\d+) = /gm)].map(([, version_]) => Number(version_));
  return {
    check_version: check ? Number(check[1]) : null,
    version: check ? `check ${check[1]}` : specs.length ? 'a check from before check versions' : null,
    specs: specs.sort((a, b) => a - b),
  };
}

// File 7's own part, from spec 2. The check is judging its own sibling here, so
// it says only what a clone can prove. It never asks whether the copy is
// current: CI has no package to compare with, and a check with no network
// cannot learn the package's hash. The session verb makes that judgement from
// the package's release list (amendment A1.9), and the merge actor makes it
// again at slice L4.
//
// What it does prove, and what it puts in the report: the copy is there, it is
// the Atlas check, it can read the spec version this repo declares, and its
// sha256. The hash is the value the session verb and the merge actor compare,
// so the report is where they read it.
function checkCheckFile(context, part) {
  const text = readText(context.root, part.path);
  if (text === null || !text.trim()) return result(part, 'empty', [`${part.path} is missing or holds nothing; this repo runs no check of its own`]);
  const stamps = checkStamps(text);
  if (!stamps.version || !stamps.specs.length) {
    return result(part, 'stale', [`${part.path} does not read as the Atlas check: it carries no check version or no spec`]);
  }
  const declared = Number(context.facts?.spec);
  const findings = [stamps.version, `reads spec ${stamps.specs.join(', ')}`, `sha256 ${sha256(text)}`];
  if (Number.isInteger(declared) && !stamps.specs.includes(declared)) {
    return result(part, 'stale', [...findings, `this copy cannot read spec ${declared}, which atlas.yaml declares; refresh it`]);
  }
  return result(part, 'filled', findings);
}

function checkLinters(context, part) {
  const found = (part.candidates ?? []).filter((path) => existsSync(join(context.root, path)));
  return found.length ? result(part, 'filled', [found.slice(0, MAX_LISTED).join(', ')]) : result(part, 'empty', ['no linter or formatter config at the root']);
}

const CHECKS = {
  markdown: checkMarkdown,
  'path-rules': checkPathRules,
  procedure: checkProcedure,
  'facts-root': checkFactsRoot,
  'facts-section': checkFactsSection,
  'facts-credentials': checkCredentials,
  'docs-index': checkDocsIndex,
  areas: checkAreas,
  workflow: checkWorkflow,
  'check-file': checkCheckFile,
  linters: checkLinters,
};

// The one exemption in the by-reference set, and it is exactly one.
//
// File 1, the entry map, must hold a pointer to each of the six files, and
// `docs/index.md` is one of them. Rule R1 makes any `docs/` file an instruction
// file points at instruction class by reference. Those two together make the
// index instruction class, and the frozen L4 path limit lets the upkeep routine
// self-merge it. Three rules, and the index can satisfy none of them.
//
// The owner cut the knot: a pointer from the entry map to
// `docs/index.md` does not make the index instruction class. An index lists
// files; it does not steer an agent.
//
// Bounded three ways, because the reason is true of a list and false of prose:
// only this one path, only these two pointing files, and the row stays in the
// report with `exempt: true` so nothing is hidden. Any other instruction file
// that names the index still makes it instruction class, and the index's own
// row then carries that file.
export const EXEMPT_PATH = 'docs/index.md';
export const EXEMPT_FROM = Object.freeze(['CLAUDE.md', 'AGENTS.md']);

export function applyExemption(rows) {
  return rows.map((row) => {
    if (row.path !== EXEMPT_PATH) return row;
    const kept = row.pointed_at_by.filter((path) => !EXEMPT_FROM.includes(path));
    if (kept.length === row.pointed_at_by.length) return row;
    const exempt = !kept.length;
    return {
      ...row,
      pointed_at_by: kept,
      exempt,
      exempt_note: exempt
        ? `the entry map points here and that alone does not make it instruction class; nothing else names it`
        : `the entry map points here and that alone does not make it instruction class; ${kept.join(', ')} still does`,
    };
  });
}

function byReference(context, spec) {
  const scanned = [];
  for (const pattern of spec.by_reference?.scanned ?? []) {
    if (!pattern.includes('*')) { if (isFile(context.root, pattern)) scanned.push(pattern); continue; }
    const [head] = pattern.split('*');
    const directory = head.replace(/\/+$/, '');
    const tail = pattern.slice(pattern.lastIndexOf('*') + 1);
    for (const file of walk(context.root, directory)) if (file.endsWith(tail)) scanned.push(file);
  }
  const found = new Map();
  for (const file of scanned) {
    for (const path of docsReferences(readText(context.root, file) ?? '')) {
      if (!found.has(path)) found.set(path, { path, exists: existsSync(join(context.root, path)), pointed_at_by: [] });
      found.get(path).pointed_at_by.push(file);
    }
  }
  return applyExemption([...found.values()].sort((a, b) => a.path.localeCompare(b.path)));
}

// The eight classes of the owner-only list. The authority is the package's
// owner-only.yaml, and a test keeps the two equal. This copy exists because the
// check runs alone in each repo's CI, where the package is not there.
export const OWNER_ONLY_CLASSES = Object.freeze(['money', 'credentials', 'outside-visibility', 'lost-data', 'security', 'new-service', 'rule-book', 'direction']);

const stringList = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '');

// The three keys of the owner-only list in atlas.yaml. Each is optional. When
// one is there, its shape is checked, and an unknown class is an error.
export function ownerOnlyErrors(facts) {
  const errors = [];
  if (!facts || typeof facts !== 'object') return errors;
  if (Object.hasOwn(facts, 'owner_only')) {
    const list = facts.owner_only;
    if (!Array.isArray(list)) errors.push('atlas.yaml: owner_only is not a list');
    else list.forEach((entry, index) => {
      const at = `atlas.yaml: owner_only[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at} is not a map with a path and a class`); return; }
      for (const key of Object.keys(entry)) if (!['path', 'class', 'why', 'except'].includes(key)) errors.push(`${at} has the key "${key}"; the keys are path, class, why and except`);
      if (typeof entry.path !== 'string' || !entry.path.trim()) errors.push(`${at} has no path`);
      if (!OWNER_ONLY_CLASSES.includes(entry.class)) errors.push(`${at}.class "${entry.class}" is not a class of owner-only.yaml; the classes are ${OWNER_ONLY_CLASSES.join(', ')}`);
      if (entry.except !== undefined && !stringList(entry.except)) errors.push(`${at}.except is not a list of paths`);
    });
  }
  for (const key of ['required_checks', 'product_paths']) {
    if (Object.hasOwn(facts, key) && !stringList(facts[key])) errors.push(`atlas.yaml: ${key} is not a list of names`);
  }
  return errors;
}

export function readFacts(root) {
  const text = readText(root, 'atlas.yaml');
  if (text === null || !text.trim()) return { facts: null, error: null };
  try {
    const data = parseYaml(text, { strict: true });
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { facts: null, error: 'atlas.yaml is not a map of keys' };
    return { facts: data, error: null };
  } catch (error) { return { facts: null, error: `atlas.yaml cannot be read: ${error.message}` }; }
}

// The lists of atlas.yaml: what the repo says it carries. Each value is read
// as it stands; `listErrors` says what is wrong with its shape.
export function listsOf(facts) {
  const parts = Array.isArray(facts?.parts) ? facts.parts.map(String) : [];
  const procedures = facts?.procedures && typeof facts.procedures === 'object' && !Array.isArray(facts.procedures) ? Object.keys(facts.procedures) : [];
  const files = facts?.files && typeof facts.files === 'object' && !Array.isArray(facts.files) ? Object.keys(facts.files) : [];
  return { parts, procedures, files, areas: facts?.areas !== undefined };
}

// The errors of the lists. A list the check cannot read would hide a part, so
// each one is an error, not a finding. `kind:` is an error too: spec 3 has
// none, and a repo that keeps it may believe the kind still picks its parts.
export function listErrors(facts) {
  const errors = [];
  if (!facts || typeof facts !== 'object') return errors;
  if (Object.hasOwn(facts, 'kind')) errors.push('atlas.yaml has a kind key. Spec 3 has no kind: the parts key lists what the repo carries. Remove the kind line');
  if (Object.hasOwn(facts, 'parts')) {
    if (!stringList(facts.parts) && !(Array.isArray(facts.parts) && !facts.parts.length)) errors.push('atlas.yaml: parts is not a list of part ids');
    else {
      const unknown = facts.parts.filter((id) => !LISTABLE_PARTS.includes(id));
      if (unknown.length) errors.push(`atlas.yaml: parts names ${unknown.join(', ')}, which the catalog does not hold; the ids are ${LISTABLE_PARTS.join(', ')}`);
      const twice = facts.parts.filter((id, index) => facts.parts.indexOf(id) !== index);
      if (twice.length) errors.push(`atlas.yaml: parts names ${[...new Set(twice)].join(', ')} more than once`);
    }
  }
  for (const key of ['procedures', 'files']) {
    const value = facts[key];
    if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push(`atlas.yaml: ${key} is not a map`);
  }
  const files = facts.files && typeof facts.files === 'object' && !Array.isArray(facts.files) ? Object.keys(facts.files) : [];
  const unknown = files.filter((section) => !FILE_SECTIONS.includes(section));
  if (unknown.length) errors.push(`atlas.yaml: files names ${unknown.join(', ')}, which the catalog does not hold; the sections are ${FILE_SECTIONS.join(', ')}`);
  return errors;
}

// Is this catalog part listed? A procedure part is expanded before this.
function isListed(part, lists) {
  if (part.listed_by === 'always') return true;
  if (part.listed_by === 'parts') return lists.parts.includes(part.id);
  if (part.listed_by === 'files') return lists.files.includes(part.section);
  if (part.listed_by === 'areas') return lists.areas;
  return false;
}

// `scoreAs` is the no-loss rule's one lever. It replaces the spec and the
// lists this tree declares with the ones handed in, so two trees are scored
// by the same yardstick. Without it a head that drops `rules` from `parts:`
// would stop scoring its rules, and the part could go without a sign (design
// parts-and-areas, security 2). Nothing else about the scan changes: the tree
// still speaks for itself about every part.
export function scan({ root, repoId = null, secretPatterns: patterns = secretPatterns(), scoreAs = null }) {
  const { facts, error: factsError } = readFacts(root);
  const errors = [];
  // The credential-value check is the only thing that turns the job red at the
  // shipped fail-on level. An empty pattern list disarms it, so it is an error,
  // never a silent pass (review R-6).
  // A list that is not a list of patterns used to crash here. It must refuse
  // the same way an empty list does (acceptance review of batch 14b, finding 10).
  const usable = Array.isArray(patterns) && patterns.every((pattern) => pattern instanceof RegExp) ? patterns : [];
  if (!usable.length) errors.push('the secret pattern list is empty or is not a list of patterns, so a credential value could not be caught; this check cannot be trusted');
  // Counting the patterns was never enough. Each one is tested against its own
  // canary, so a pattern edited to match nothing is loud (finding S2-5).
  const missed = canaryMisses();
  if (missed.length) errors.push(`${missed.length} secret pattern(s) no longer catch their own canary: ${missed.join(', ')}; this check cannot be trusted`);
  if (!facts && !factsError) errors.push('atlas.yaml does not exist, so the check cannot learn the spec version or the parts the repo lists');
  if (factsError) errors.push(factsError);
  errors.push(...ownerOnlyErrors(facts));
  const wantedSpec = scoreAs ? scoreAs.spec : facts?.spec;
  let spec = null;
  if (facts) {
    try { spec = loadSpec(wantedSpec); }
    catch (error) { errors.push(error.message); }
  }
  const context = { root, facts, factsError, repoId, secretPatterns: usable, errors, secretsAt: new Set() };
  // The sweep (roadmap R62 line 2). atlas.yaml's own values reach the report:
  // the repo id, a procedure's skill name, every pointer path. And a file
  // under atlas/ can hold a value whether the repo lists it or not: Atlas, a
  // library at spec 2, never had its credentials file read. So the patterns
  // read atlas.yaml and every file under atlas/, before any value is quoted
  // (acceptance review of batch 16, note S3-2).
  if (facts || factsError) secretIn(context, 'atlas.yaml', readText(root, 'atlas.yaml'));
  for (const path of walk(root, 'atlas')) secretIn(context, path, readText(root, path));
  if (!spec) return { ok: false, check_version: CHECK_VERSION, repo: repoId, spec: wantedSpec ?? null, scored_as: scoreAs, product: facts?.product ?? null, files: [], by_reference: [], counts: counts([], facts), errors };
  errors.push(...listErrors(scoreAs ? { ...facts, ...scoreAs.facts } : facts));

  // The no-loss rule can score a tree at another tree's lists and pointers:
  // the parts it carries, and the paths that atlas.yaml names for the
  // procedures and the facts files. So a part that a pull request drops or
  // moves is also scored where the base had it (roadmap R7 line 3).
  if (scoreAs) context.facts = { ...facts, spec: scoreAs.spec, ...(scoreAs.facts ?? {}) };
  const lists = listsOf(context.facts);
  const files = spec.files.map((file) => ({
    id: file.id,
    number: file.number,
    title: file.title,
    class: file.class,
    written_by: file.written_by,
    parts: file.parts.flatMap((catalog) => {
      const expanded = catalog.listed_by === 'procedures'
        ? lists.procedures.map((name) => ({ ...catalog, id: name, procedure: name }))
        : [catalog];
      return expanded.map((part) => {
        if (part.listed_by !== 'procedures' && !isListed(part, lists)) {
          const why = part.listed_by === 'files' ? `atlas.yaml files has no ${part.section} key` : part.listed_by === 'areas' ? 'atlas.yaml has no areas key; the repo is one area' : `atlas.yaml parts does not name ${part.id}`;
          return { ...result(part, 'not listed', [why]), required: 'not listed', listed: false };
        }
        const check = CHECKS[part.check];
        if (!check) throw new SpecError(`the spec names check "${part.check}", which this version of the check does not have`);
        return { ...check(context, part), required: 'required', listed: true };
      });
    }),
  }));
  return { ok: !errors.length, check_version: CHECK_VERSION, repo: repoId ?? facts.repo ?? null, spec: spec.spec, scored_as: scoreAs, product: facts.product ?? null, files, by_reference: byReference(context, spec), counts: counts(files, context.facts), errors };
}

// The counts. Every listed part is required, so `required` and `listed` are
// one number; the old name stays for the readers of the report. `procedures`
// and `jobs` are the numbers outcome O7 counts for each repo (roadmap R62
// line 6): the keys of `procedures:`, and the jobs that `jobs:` turns on.
export function counts(files, facts = null) {
  const out = { filled: 0, empty: 0, stale: 0, 'not listed': 0, listed: 0, listed_not_filled: 0, required: 0, not_filled: 0, required_not_filled: 0, procedures: 0, jobs: 0 };
  for (const file of files) for (const part of file.parts) {
    out[part.state] += 1;
    if (part.required !== 'required') continue;
    out.listed += 1;
    if (NOT_FILLED.includes(part.state)) out.listed_not_filled += 1;
  }
  out.required = out.listed;
  out.not_filled = out.listed_not_filled;
  out.required_not_filled = out.listed_not_filled;
  out.procedures = listsOf(facts).procedures.length;
  const jobs = facts?.jobs;
  if (jobs && typeof jobs === 'object' && !Array.isArray(jobs)) {
    for (const value of Object.values(jobs)) out.jobs += Array.isArray(value) ? value.length : value ? 1 : 0;
  } else if (Array.isArray(jobs)) out.jobs = jobs.length;
  return out;
}

// ---------------------------------------------------------------------------
// The no-loss rule. Milestone M2, slice L2 stage two.
//
// What it is. A pull request may not take away an instruction-class part that
// the base commit already had. Nothing else. It is never red on debt that was
// there before, and it is red on the pull request that made things worse.
//
// Why a no-loss rule and not a level. Turning `fail-on` up to `required` goes red on
// the day it is switched on, for parts a later slice builds. The first repo it
// ran on had seven required parts not filled, four of them a later slice's
// work. A level
// asks the repository to be finished. A no-loss rule asks it not to go backwards.
//
// Why per part and never a count. A count is defeated two ways. Empty one part,
// fill another, and the total does not move. Or change one line: `atlas.yaml`
// lists the parts, and `atlas.yaml` is inside the diff being scored, so a
// head that drops `rules` from `parts:` turns a scored part into "not listed"
// and the count falls. Scoring per part, with the base tree's `spec` and
// lists, closes both (findings P2, P20; roadmap R62).
//
// Which copy scores. The base's, from check version 6 (roadmap R7). The gate
// job runs on pull_request_target, so it runs this file as the base holds it,
// over two trees written from git objects. Before that, the head's copy judged
// its own diff, and a pull request could edit the check to print GREEN. The
// two report-only cases for the check file and its workflow covered that hole
// with a warning that a person merges the file. Under merge on green, no
// person reads that warning. Now a change to either gives "owner" and the rule
// still gates.
//
// A run by hand, or an old workflow, still runs the head's copy. Its answer
// is a report. The gate's answer is the one a merge waits on.
//
// Where it lives. Here. The repository still carries two files and only two.
// ---------------------------------------------------------------------------

// The cases that give "owner". Only the owner may approve such a change, and
// the rule still gates: it still finds any part that went backwards. Before
// check version 6 five cases switched the rule off and printed a warning that
// a person merges the file. Nothing switches it off now. The base copy scores,
// and the base spec and lists score both trees, so no case needs to.
export const OWNER_CASES = Object.freeze(['check-file', 'workflow', 'parts', 'spec', 'moved', 'first-run']);

// A head whose atlas.yaml names a spec that this copy of the check cannot
// read. A head with no spec, or with an atlas.yaml that does not read, is not
// one: those stay errors.
export function headSpecUnread(facts) {
  const spec = facts?.spec;
  return spec !== undefined && spec !== null && spec !== '' && !Object.hasOwn(SPECS, String(spec));
}

// The head of a move to a newer spec: no part is scored, but every file the
// newer spec can read for facts is swept for secrets. That is atlas.yaml, each
// file under atlas/, and each facts file that atlas.yaml points to by a plain
// path. The trust checks of the pattern list and the owner_only checks run as
// in scan, so a newer spec cannot turn either of them from red into owner.
export function sweepHead({ root, repoId = null, secretPatterns: patterns = secretPatterns() }) {
  const { facts } = readFacts(root);
  const errors = [...ownerOnlyErrors(facts)];
  const usable = Array.isArray(patterns) && patterns.every((pattern) => pattern instanceof RegExp) ? patterns : [];
  if (!usable.length) errors.push('the secret pattern list is empty or is not a list of patterns, so a credential value could not be caught; this check cannot be trusted');
  const missed = canaryMisses();
  if (missed.length) errors.push(`${missed.length} secret pattern(s) no longer catch their own canary: ${missed.join(', ')}; this check cannot be trusted`);
  const context = { root, secretPatterns: usable, errors, secretsAt: new Set() };
  const files = facts?.files && typeof facts.files === 'object' && !Array.isArray(facts.files) ? facts.files : {};
  const pointed = Object.values(files).filter((path) => plainPath(path) && isFile(root, path));
  for (const path of new Set(['atlas.yaml', ...walk(root, 'atlas'), ...pointed])) secretIn(context, path, readText(root, path));
  return { ok: false, check_version: CHECK_VERSION, repo: repoId, kind: null, spec: facts?.spec ?? null, swept_only: true, files: [], by_reference: [], counts: counts([]), errors };
}

const fileHash = (root, path) => { const text = readText(root, path); return text === null ? null : sha256(text); };
const isEmptyDir = (root) => { try { return !readdirSync(root).length; } catch { return true; } };

// The commit a checkout sits on, read from `.git/HEAD` as text. No git binary,
// no network. `actions/checkout` leaves a detached HEAD, so the first line is
// usually the SHA itself; a `ref:` line is followed once.
export function checkoutHead(root) {
  const head = readText(root, '.git/HEAD');
  if (head === null) return null;
  const line = head.trim();
  if (/^[0-9a-f]{40}$/.test(line)) return line;
  const named = /^ref:\s*(\S+)$/.exec(line);
  if (!named) return null;
  const loose = readText(root, posix.join('.git', named[1]));
  if (loose && /^[0-9a-f]{40}$/.test(loose.trim())) return loose.trim();
  // A clone may pack its refs instead of writing one file each.
  for (const row of (readText(root, '.git/packed-refs') ?? '').split('\n')) {
    const [sha, ref] = row.trim().split(/\s+/);
    if (ref === named[1] && /^[0-9a-f]{40}$/.test(sha ?? '')) return sha;
  }
  return null;
}

const partIndex = (report) => {
  const map = new Map();
  for (const file of report.files) for (const part of file.parts) map.set(`${file.id}/${part.id}`, { file, part });
  return map;
};

// `baseCommit` is the commit the caller wrote the base tree from, when it
// wrote the tree itself from git objects, as the gate does. Such a tree has
// no `.git`, and the caller is the base code, so its word is the tree's name.
export function noLoss({ headRoot, baseRoot, baseSha = null, baseCommit = null, repoId = null, secretPatterns: patterns = secretPatterns() }) {
  const out = {
    ran: true,
    green: true,
    broken: null,
    base_dir: baseRoot,
    base_sha: baseSha,
    base_head: null,
    base_facts: null,
    head_facts: null,
    parts_compared: 0,
    owner: [],
    regressions: [],
  };
  const owner = (name, why, extra = {}) => out.owner.push({ case: name, why, ...extra });
  // A missing or wrong base tree is red, never green: there is nothing to
  // compare, and a rule that cannot compare cannot say nothing was lost
  // (roadmap R7 line 4).
  const broken = (why) => { out.broken = why; out.green = false; return out; };

  // 1. Is there a base tree at all, and is it the pull request's base?
  if (!existsSync(baseRoot) || isEmptyDir(baseRoot)) return broken(`no base tree at ${baseRoot}: the base commit did not land, so there is nothing to compare`);
  out.base_head = baseCommit && PINNED.test(baseCommit) ? baseCommit : checkoutHead(baseRoot);
  // The pull request promised a base commit. If the tree cannot say which
  // commit it is, the promise is unchecked, and an unchecked promise is not a
  // base tree. Reporting a sha this check was handed but never read would be a
  // claim it cannot support.
  if (baseSha && !out.base_head) return broken(`the base tree at ${baseRoot} does not say which commit it is, so this check cannot confirm it is ${baseSha.slice(0, 12)}, the base this pull request names`);
  if (baseSha && out.base_head !== baseSha) return broken(`the base tree at ${baseRoot} is at ${out.base_head.slice(0, 12)}, and this pull request's base is ${baseSha.slice(0, 12)}; the comparison would be against the wrong commit`);
  // A base with no atlas.yaml is the first run in a repo: the pull request that
  // adds Atlas. There is nothing to lose, and the owner reads the first shape.
  const baseRead = readFacts(baseRoot);
  if (!baseRead.facts && !baseRead.error) {
    owner('first-run', 'the base has no atlas.yaml, so there is nothing to lose; the owner reads the first shape');
    return out;
  }
  // A base atlas.yaml that does not read cannot name a spec or its parts, so
  // there is no yardstick. That is red. The owner merges the fix by hand.
  if (baseRead.error) return broken(`the base atlas.yaml does not read, so its spec and parts are unknown: ${baseRead.error}`);

  // 2. The base tree's spec and lists score both trees. A head that drops a
  // part from a list still has the part scored, and the change gives "owner"
  // (design parts-and-areas, security 2).
  const baseFacts = baseRead.facts;
  const headRead = readFacts(headRoot);
  const headFacts = headRead.facts ?? {};
  const baseLists = listsOf(baseFacts);
  const headLists = listsOf(headFacts);
  out.base_facts = { spec: baseFacts.spec ?? null, parts: baseLists.parts, procedures: baseLists.procedures, files: baseLists.files, areas: baseLists.areas };
  out.head_facts = { spec: headFacts.spec ?? null, parts: headLists.parts, procedures: headLists.procedures, files: headLists.files, areas: headLists.areas };

  const dropped = [
    ...baseLists.parts.filter((id) => !headLists.parts.includes(id)).map((id) => `parts ${id}`),
    ...baseLists.procedures.filter((name) => !headLists.procedures.includes(name)).map((name) => `procedures ${name}`),
    ...baseLists.files.filter((section) => !headLists.files.includes(section)).map((section) => `files ${section}`),
    ...(baseLists.areas && !headLists.areas ? ['areas'] : []),
  ];
  if (dropped.length) {
    owner('parts', `atlas.yaml drops ${dropped.join(', ')} at the head; the base lists still score both trees, and only the owner approves a smaller list`);
  }
  const unread = Object.hasOwn(SPECS, String(out.base_facts.spec)) && headSpecUnread(headRead.facts);
  if (String(out.head_facts.spec) !== String(out.base_facts.spec)) {
    owner('spec', `atlas.yaml names spec "${out.base_facts.spec}" at the base and "${out.head_facts.spec}" at the head; this pull request changes what the spec version means${unread ? `; this copy of the check, check version ${CHECK_VERSION}, cannot read spec "${out.head_facts.spec}", so it did not score the head and only swept it for secrets` : ''}`);
  }

  // The base lists, with the head's own pointers where the head still has the
  // key, and the base's where it dropped it.
  const pick = (key) => {
    const at = baseFacts[key];
    if (!at || typeof at !== 'object' || Array.isArray(at)) return at;
    const now = headFacts[key] && typeof headFacts[key] === 'object' && !Array.isArray(headFacts[key]) ? headFacts[key] : {};
    return Object.fromEntries(Object.keys(at).map((name) => [name, Object.hasOwn(now, name) ? now[name] : at[name]]));
  };
  const areasAt = (facts) => (baseLists.areas ? (facts.areas !== undefined ? facts.areas : baseFacts.areas) : undefined);
  const scoreAs = { spec: baseFacts.spec ?? null };
  const atHead = { ...scoreAs, facts: { parts: baseFacts.parts, procedures: pick('procedures'), files: pick('files'), areas: areasAt(headFacts) } };
  const atBase = { ...scoreAs, facts: { parts: baseFacts.parts, procedures: baseFacts.procedures, files: baseFacts.files, areas: baseFacts.areas } };

  // 3. Does the diff change the gate itself? The base copy judges, so the
  // change cannot score itself, but only the owner may approve it.
  for (const [name, path] of [['check-file', CHECK_PATH], ['workflow', WORKFLOW_PATH], ['workflow', OLD_WORKFLOW_PATH]]) {
    if (fileHash(baseRoot, path) !== fileHash(headRoot, path)) {
      owner(name, `this pull request changes ${path}, which is the gate itself; it is instruction class, so only the owner approves it`, { path });
    }
  }

  // A head on a spec this copy cannot read is a move to a newer spec. This
  // copy has no yardstick for the head, so it compares nothing. The spec row
  // above sends it to the owner, and the gate still sweeps the head for
  // secrets (roadmap R62: the base copy judged the move to spec 3 red).
  if (unread) return out;

  // 4. Score both trees, by the same yardstick, and compare part by part. The
  // head is scored twice: at its own pointers, and at the base's.
  const base = scan({ root: baseRoot, repoId, secretPatterns: patterns, scoreAs });
  const head = scan({ root: headRoot, repoId, secretPatterns: patterns, scoreAs: atHead });
  const headAtBase = scan({ root: headRoot, repoId, secretPatterns: patterns, scoreAs: atBase });
  if (!base.files.length) return broken(`the base tree at ${baseRoot} could not be scored: ${base.errors.join('; ') || 'no parts came back'}`);

  const headParts = partIndex(head);
  const atBaseParts = partIndex(headAtBase);
  for (const [key, { file, part }] of partIndex(base)) {
    if (file.class !== 'instruction' || part.state !== 'filled') continue;
    out.parts_compared += 1;
    const now = headParts.get(key);
    if (!now) {
      out.regressions.push({ part: key, label: label(part), was: 'filled', now: 'gone', why: `the spec part ${key} was filled at the base and this copy of the check no longer scores it` });
      continue;
    }
    if (now.part.state !== 'filled') {
      out.regressions.push({ part: key, label: label(now.part), was: 'filled', now: now.part.state, findings: now.part.findings, why: `${label(now.part)} was filled at the base and is ${now.part.state} at the head` });
      continue;
    }
    // A moved part: the head points it somewhere else. The head is filled
    // at its new pointer, or the part would be a regression above. The owner
    // reads every move, and the answer says whether the base path still holds
    // the part in the head (roadmap R7 line 3).
    const from = part.path;
    const to = now.part.path;
    if (!from || !to || from === to) continue;
    const kept = atBaseParts.get(key)?.part.state === 'filled' ? `; ${from} still holds it` : `; ${from} no longer holds it`;
    owner('moved', `${label(part)} moved from ${from} to ${to}${kept}`, { path: to });
  }
  out.green = !out.regressions.length;
  return out;
}

// The answer of the shape rule for the gate: success, owner or red, with one
// row for each finding. Red wins over owner. The gate job and `atlas gate
// check` both take it from here, so the two cannot disagree.
export const GATE_RESULTS = Object.freeze(['success', 'owner', 'red']);
export function gateAnswer(report, state) {
  const rows = [];
  for (const error of report.errors) rows.push({ kind: 'red', class: 'shape', cause: `the check hit an error at the head: ${error}` });
  if (state?.broken) rows.push({ kind: 'red', class: 'shape', cause: state.broken });
  for (const row of state?.regressions ?? []) rows.push({ kind: 'red', class: 'shape', cause: row.why });
  for (const row of state?.owner ?? []) rows.push({ kind: 'owner', class: 'shape', cause: `${row.case}: ${row.why}`, ...(row.path ? { path: row.path } : {}) });
  if (!state) rows.push({ kind: 'red', class: 'shape', cause: 'the no-loss rule did not run: no base tree was named' });
  const result = rows.some((row) => row.kind === 'red') ? 'red' : rows.some((row) => row.kind === 'owner') ? 'owner' : 'success';
  return { result, class: result === 'success' ? null : 'shape', rows };
}

// One line for each row, with a fixed prefix, and no control character, so a
// path cannot start a workflow command.
const oneLine = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
export function gateLines(answer, state) {
  const base = state?.base_head ? state.base_head.slice(0, 12) : 'none';
  const yard = state?.base_facts ? `spec ${oneLine(state.base_facts.spec)}, ${state.base_facts.parts.length + state.base_facts.procedures.length + state.base_facts.files.length} listed part(s)` : 'no yardstick';
  const out = [`shape: base ${base}, ${yard}, ${state?.parts_compared ?? 0} instruction-class part(s) filled at the base`];
  for (const row of answer.rows) out.push(`  ${row.kind.padEnd(6)} ${row.class.padEnd(6)} ${oneLine(row.cause)}`);
  if (answer.result === 'red') out.push(`RED: ${oneLine(answer.rows.find((row) => row.kind === 'red').cause)}. Fix it; red wins over owner.`);
  else if (answer.result === 'owner') out.push("OWNER: shape. Clears with the owner's signed act: atlas approve <pr> (roadmap R72).");
  else out.push('SUCCESS: no instruction-class part went backwards.');
  return out;
}

// ---------------------------------------------------------------------------
// The report. Two shapes: plain text for the CI log, and GitHub markdown for
// the job summary. Both list every part, its state and its findings.
// ---------------------------------------------------------------------------

const MARK = { filled: '+', empty: '-', stale: '~', 'not listed': '.' };
const label = (part) => part.procedure ? `procedure ${part.procedure}` : part.id === 'areas' ? 'areas in atlas.yaml' : part.path ?? part.id;

// The one number the owner sees is the count of LISTED parts not filled. A
// part the repo does not list is not a gap (review finding S2-1); its row
// still shows, so nothing is hidden.
export function headline(report) {
  if (!report.spec || !report.files?.length) return 'Atlas repo shape: the check could not run.';
  const { counts: seen } = report;
  return `Atlas repo shape: ${seen.listed_not_filled} of ${seen.listed} listed part(s) not filled. `
    + `Spec: ${report.spec}. Check version: ${report.check_version}.`;
}

export function toText(report) {
  const lines = [headline(report), ''];
  for (const error of report.errors) lines.push(`ERROR  ${error}`);
  if (report.errors.length) lines.push('');
  for (const file of report.files) {
    lines.push(`${file.number}. ${file.title} (${file.class})`);
    for (const part of file.parts) {
      lines.push(`   ${MARK[part.state]} ${part.state.padEnd(14)} ${part.required.padEnd(8)} ${label(part)}`);
      for (const finding of part.findings) lines.push(`       - ${finding}`);
    }
    lines.push('');
  }
  const instruction = report.by_reference.filter((row) => !row.exempt);
  lines.push(`By reference: ${instruction.length} file(s) under docs/ are named by an instruction file, so they are instruction class too.`);
  for (const row of report.by_reference) {
    lines.push(`   ${row.exists ? '+' : '-'} ${row.path}  <- ${row.pointed_at_by.join(', ') || 'the entry map only'}${row.exempt ? '  [exempt]' : ''}`);
    if (row.exempt_note) lines.push(`       - ${row.exempt_note}`);
  }
  if (report.noLoss) lines.push('', ...noLossLines(report.noLoss));
  return `${lines.join('\n')}\n`;
}

// The no-loss rule, in the CI log. It says which tree it compared against, what it
// compared, and either the parts that went backwards or the case that made it
// report instead of gate.
export function noLossLines(state) {
  const out = ['No-loss rule: instruction-class parts, base to head.'];
  // The sha this check READ from the base tree, never the one it was handed.
  // Printing the promise would assert a commit nothing verified.
  const read = state.base_head ? state.base_head.slice(0, 12) : 'a commit the tree does not name';
  const promised = state.base_sha ? `, named ${state.base_sha.slice(0, 12)} by the pull request` : '';
  out.push(`   base ${read} in ${state.base_dir}${promised}`);
  if (state.base_facts) out.push(`   scored both trees as spec ${state.base_facts.spec}, with the parts the base lists`);
  if (state.parts_compared) out.push(`   ${state.parts_compared} instruction-class part(s) were filled at the base`);
  if (state.broken) out.push(`   NO BASE TREE: ${state.broken}`);
  for (const row of state.owner ?? []) out.push(`   OWNER (${row.case}): ${row.why}`);
  for (const row of state.regressions) {
    out.push(`   BACKWARDS  ${row.label}: ${row.was} at the base, ${row.now} at the head`);
    for (const finding of row.findings ?? []) out.push(`       - ${finding}`);
  }
  if (!state.regressions.length && state.base_facts) out.push('   no instruction-class part went backwards');
  return out;
}

export function toMarkdown(report) {
  const out = ['## Atlas repo shape', '', headline(report), ''];
  if (report.errors.length) {
    out.push('### Errors', '');
    for (const error of report.errors) out.push(`- ${error}`);
    out.push('');
  }
  for (const file of report.files) {
    out.push(`### ${file.number}. ${file.title}`, '', '| Part | Listed | State | Findings |', '|---|---|---|---|');
    for (const part of file.parts) out.push(`| \`${label(part)}\` | ${part.listed ? 'yes' : 'no'} | ${part.state} | ${part.findings.map((finding) => finding.replaceAll('|', '\\|')).join('; ') || '—'} |`);
    out.push('');
  }
  const instruction = report.by_reference.filter((row) => !row.exempt);
  out.push('### By reference', '', `${instruction.length} file(s) under \`docs/\` are named by an instruction file. They are instruction class too.`, '');
  if (report.by_reference.length) {
    out.push('| Path | On disk | Named by | Instruction class |', '|---|---|---|---|');
    for (const row of report.by_reference) {
      out.push(`| \`${row.path}\` | ${row.exists ? 'yes' : 'no'} | ${row.pointed_at_by.map((path) => `\`${path}\``).join(', ') || '—'} | ${row.exempt ? `no — ${row.exempt_note}` : 'yes'} |`);
    }
    out.push('');
  }
  if (report.noLoss) {
    out.push('### The no-loss rule', '');
    for (const line of noLossLines(report.noLoss).slice(1)) out.push(`- ${line.trim()}`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

// Two things can turn the job red, and they answer different questions.
//
// `fail-on` answers "is this repository finished?" over the whole-repository
// count. It keeps its three levels and it stays a report line at the shipped
// level.
//
// The no-loss rule answers "did this pull request take something away?" It is the
// one that can be true on a repository with debt, so it is checked first.
export function verdict(report, failOn) {
  if (report.errors.length) return { green: false, why: `the check hit ${report.errors.length} error(s)` };
  const state = report.noLoss;
  if (state?.broken) return { green: false, why: `the no-loss rule has no base tree to compare: ${state.broken}` };
  if (state?.regressions.length) {
    return { green: false, why: `${state.regressions.length} instruction-class part(s) went backwards against the base: ${state.regressions.map((row) => row.label).join(', ')}` };
  }
  // Every listed part is required, so "required" and "any" ask the same thing
  // from check version 10. Both stay, so no workflow breaks.
  if (failOn !== 'error' && report.counts.listed_not_filled) return { green: false, why: `${report.counts.listed_not_filled} listed part(s) are not filled` };
  const owned = state?.owner?.length ? `; only the owner approves this change (${[...new Set(state.owner.map((row) => row.case))].join(', ')}), so the gate says "owner"` : '';
  const noLossWhy = state ? `; no instruction-class part went backwards${owned}` : '';
  return { green: true, why: `${report.counts.listed_not_filled} listed part(s) are not filled; fail-on is "${failOn}"${noLossWhy}` };
}

// ---------------------------------------------------------------------------
// The command line.
// ---------------------------------------------------------------------------

export const FAIL_ON = Object.freeze(['error', 'required', 'any']);

export function parseArguments(argv) {
  const out = { root: process.cwd(), failOn: 'error', json: null, summary: null, quiet: false, base: null, baseSha: null, baseCommit: null, headCommit: null, git: process.cwd(), gate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => { const value = argv[index + 1]; if (value === undefined) throw new Error(`${flag} needs a value`); index += 1; return value; };
    if (flag === '--root') out.root = resolve(next());
    else if (flag === '--fail-on') out.failOn = next();
    else if (flag === '--json') out.json = resolve(next());
    else if (flag === '--summary') out.summary = resolve(next());
    else if (flag === '--quiet') out.quiet = true;
    // The no-loss rule's two inputs. `--base` is the directory the workflow checked
    // the base commit out into. `--base-sha` is the pull request's base.sha, so
    // the check can say the tree it reads is the tree it was promised.
    else if (flag === '--base') out.base = resolve(next());
    else if (flag === '--base-sha') out.baseSha = next().trim() || null;
    // Gate mode (roadmap R7). The gate job wrote the base tree from git
    // objects, so it names the commit; the answer is success, owner or red.
    else if (flag === '--base-commit') out.baseCommit = next().trim() || null;
    else if (flag === '--head-commit') out.headCommit = next().trim() || null;
    else if (flag === '--git') out.git = resolve(next());
    else if (flag === '--gate') out.gate = true;
    else if (flag === '--repo') out.repo = next();
    else if (flag === '--version') out.version = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!FAIL_ON.includes(out.failOn)) throw new Error(`--fail-on must be one of ${FAIL_ON.join(', ')}`);
  for (const [flag, value] of [['--base-commit', out.baseCommit], ['--head-commit', out.headCommit]]) {
    if (value && !PINNED.test(value)) throw new Error(`${flag} must be a full 40-character commit SHA`);
  }
  if (out.gate && (!out.baseCommit || !out.headCommit)) throw new Error('--gate needs --base-commit and --head-commit');
  return out;
}

export function run(argv, env = process.env) {
  const options = parseArguments(argv);
  if (options.gate) return runGate({ options, env });
  const repoId = options.repo ?? env.GITHUB_REPOSITORY ?? null;
  const patterns = secretPatterns();
  const report = scan({ root: options.root, repoId, secretPatterns: patterns });
  // No `--base` means no pull request to measure: a push build, or a run by
  // hand. The no-loss rule then does not run at all, and the report says nothing
  // about it rather than claiming a pass.
  report.noLoss = options.base
    ? noLoss({ headRoot: options.root, baseRoot: options.base, baseSha: options.baseSha, baseCommit: options.baseCommit, repoId, secretPatterns: patterns })
    : null;
  const decision = verdict(report, options.failOn);
  const text = toText(report);
  if (options.json) writeFileSync(options.json, `${JSON.stringify({ ...report, fail_on: options.failOn, green: decision.green }, null, 2)}\n`);
  if (options.summary) writeFileSync(options.summary, toMarkdown(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, toMarkdown(report));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `not-filled=${report.counts.not_filled}\nrequired-not-filled=${report.counts.required_not_filled}\nlisted=${report.counts.listed}\nprocedures=${report.counts.procedures}\njobs=${report.counts.jobs}\ngreen=${decision.green}\n`);
  return { report, decision, text, options };
}

// ---------------------------------------------------------------------------
// The two trees of the gate (roadmap R7). Each one is written from git objects:
// `git ls-tree` lists the entries and `git cat-file` gives each blob, so no
// attribute of the tree applies. `git archive` would apply the head's own
// .gitattributes (export-subst, export-ignore, a filter), and the check would
// score bytes that do not merge (security review of R7, finding S1).
//
// Each blob is checked against its id. A path must be plain: no empty, "." or
// ".." part, no ".git" part, no leading slash and no control character. A link
// or a submodule is listed and never written, so the check never follows one.
// ---------------------------------------------------------------------------

export class TreeError extends Error {}

export const TREE_LIMITS = Object.freeze({ files: 200_000, bytes: 1024 * 1024 * 1024 });

function gitRun(git, args, input = null) {
  const r = spawnSync('git', ['-C', git, ...args], { input, maxBuffer: TREE_LIMITS.bytes + 64 * 1024 * 1024 });
  if (r.error) throw new TreeError(`git cannot run: ${r.error.message}`);
  if (r.status !== 0) throw new TreeError(`git ${args[0]} failed: ${String(r.stderr ?? '').trim().split('\n')[0]}`);
  return r.stdout;
}

const PLAIN_PART = /^(?!\.\.?$)(?!\.git$)[^\u0000-\u001f\u007f/\\]+$/;
export const plainPath = (path) => typeof path === 'string' && path.length > 0 && path.split('/').every((part) => PLAIN_PART.test(part));

// The entries of one commit's tree: blobs, links and submodules.
export function treeEntries(git, commit) {
  const out = { blobs: [], links: [], modules: [] };
  const seen = new Set();
  for (const row of gitRun(git, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0')) {
    if (!row) continue;
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(row);
    if (!match) throw new TreeError('git ls-tree printed a row this check cannot read');
    const [, mode, type, id, path] = match;
    if (!plainPath(path)) throw new TreeError(`the tree of ${commit.slice(0, 12)} holds a path that is not plain`);
    if (seen.has(path)) throw new TreeError(`the tree of ${commit.slice(0, 12)} holds one path twice`);
    seen.add(path);
    if (mode === '120000') out.links.push({ path, id });
    else if (type === 'commit') out.modules.push({ path, id });
    else if (type === 'blob') out.blobs.push({ path, id });
    else throw new TreeError(`the tree of ${commit.slice(0, 12)} holds an entry of type ${type}`);
  }
  return out;
}

const blobId = (bytes, length) => createHash(length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// Write the blobs of one commit under `dest`. Returns the entries.
export function writeTree({ git, commit, dest }) {
  const entries = treeEntries(git, commit);
  if (entries.blobs.length > TREE_LIMITS.files) throw new TreeError(`the tree of ${commit.slice(0, 12)} holds more than ${TREE_LIMITS.files} files`);
  const output = entries.blobs.length ? gitRun(git, ['cat-file', '--batch'], `${entries.blobs.map((blob) => blob.id).join('\n')}\n`) : Buffer.alloc(0);
  let at = 0;
  let total = 0;
  for (const blob of entries.blobs) {
    const end = output.indexOf(0x0a, at);
    const header = output.subarray(at, end).toString('utf8');
    const match = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== blob.id) throw new TreeError(`git cat-file did not give the blob of ${blob.path}`);
    const size = Number(match[2]);
    total += size;
    if (total > TREE_LIMITS.bytes) throw new TreeError(`the tree of ${commit.slice(0, 12)} is over ${TREE_LIMITS.bytes} bytes`);
    const bytes = output.subarray(end + 1, end + 1 + size);
    if (blobId(bytes, blob.id.length) !== blob.id) throw new TreeError(`the bytes of ${blob.path} are not its blob`);
    const full = join(dest, ...blob.path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes, { flag: 'wx' });
    at = end + 1 + size + 1;
  }
  return entries;
}

const commitOf = (git, ref) => {
  const r = spawnSync('git', ['-C', git, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

// The shape rule over git data: the base commit is the tip of the base branch,
// the head commit is the pull request's head. Both trees come from the merge
// base and the head. Any step that fails is red.
export function gateFromGit({ git, baseCommit, headCommit, repoId = null, trees = null, secretPatterns: patterns = secretPatterns() }) {
  const red = (why) => ({ report: { errors: [], files: [], counts: counts([]) }, state: { broken: why, owner: [], regressions: [], parts_compared: 0, base_head: null, base_facts: null } });
  const base = commitOf(git, baseCommit);
  const head = commitOf(git, headCommit);
  if (!base) return red(`the base commit ${String(baseCommit).slice(0, 12)} is not in this clone`);
  if (!head) return red(`the head commit ${String(headCommit).slice(0, 12)} is not in this clone`);
  let mergeBase;
  try { mergeBase = gitRun(git, ['merge-base', '--end-of-options', base, head]).toString('utf8').trim(); } catch { return red('the base and the head share no commit in this clone'); }
  const top = trees ?? mkdtempSync(join(tmpdir(), 'atlas-gate-'));
  const baseRoot = join(top, GATE_TREES.base);
  const headRoot = join(top, GATE_TREES.head);
  try {
    let baseEntries;
    let headEntries;
    try {
      baseEntries = writeTree({ git, commit: mergeBase, dest: baseRoot });
      headEntries = writeTree({ git, commit: head, dest: headRoot });
    } catch (error) {
      if (error instanceof TreeError) return red(`a tree could not be written: ${error.message}`);
      throw error;
    }
    mkdirSync(baseRoot, { recursive: true });
    mkdirSync(headRoot, { recursive: true });
    const baseFacts = readFacts(baseRoot).facts;
    const swept = baseFacts && Object.hasOwn(SPECS, String(baseFacts.spec)) && headSpecUnread(readFacts(headRoot).facts);
    const report = swept ? sweepHead({ root: headRoot, repoId, secretPatterns: patterns }) : scan({ root: headRoot, repoId, secretPatterns: patterns });
    const state = noLoss({ headRoot, baseRoot, baseCommit: mergeBase, repoId, secretPatterns: patterns });
    // A link or a submodule that the head adds or changes is never read, so the
    // check cannot judge it. The owner reads it.
    const had = new Map([...baseEntries.links, ...baseEntries.modules].map((entry) => [entry.path, entry.id]));
    for (const entry of [...headEntries.links, ...headEntries.modules]) {
      if (had.get(entry.path) !== entry.id) state.owner.push({ case: 'link', why: `${entry.path} is a link or a submodule that this pull request adds or changes; the check never follows one`, path: entry.path });
    }
    return { report, state, merge_base: mergeBase, head };
  } finally {
    if (!trees) rmSync(top, { recursive: true, force: true });
  }
}

// Gate mode. The job summary holds the full report and the answer. The output
// file gets two keys only, each one word of a fixed set, so no path can add a
// key. Exit 0 on success, 1 on owner or red.
function runGate({ options, env }) {
  const { report, state } = gateFromGit({ git: options.git, baseCommit: options.baseCommit, headCommit: options.headCommit, repoId: options.repo ?? env.GITHUB_REPOSITORY ?? null });
  const answer = gateAnswer(report, state);
  // Only the answer lines leave this process. Each one has a fixed prefix and
  // no control character or backtick, so a head string cannot start a
  // workflow command or close the fence of the summary (security review of
  // R7). The full report stays in the JSON file, for a run by hand.
  const lines = gateLines(answer, state).map((line) => line.replaceAll('`', "'"));
  if (options.json) writeFileSync(options.json, `${JSON.stringify({ ...report, noLoss: state, gate: answer }, null, 2)}\n`);
  const summary = `## Atlas repo shape, from the base\n\n${['```text', ...lines, '```'].join('\n')}\n`;
  if (options.summary) writeFileSync(options.summary, summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `result=${answer.result}\nclass=${answer.class ?? 'none'}\n`);
  const decision = { green: answer.result === 'success', why: lines.at(-1) };
  return { report, decision, text: `${lines.join('\n')}\n`, lines, options, answer, gate: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // --version is parsed like every other flag, so an unknown flag beside it
    // is still refused (acceptance review of batch 14b, finding 11).
    const asked = parseArguments(process.argv.slice(2));
    if (asked.version) {
      process.stdout.write(`atlas repo-shape check, check version ${CHECK_VERSION}; it reads spec ${Object.keys(SPECS).join(', ')}\n`);
    } else {
      const { decision, text, options, gate } = run(process.argv.slice(2));
      if (!options.quiet || gate) process.stdout.write(text);
      // In gate mode the last line of the text already says SUCCESS, OWNER or RED.
      if (!gate) process.stdout.write(`${decision.green ? 'GREEN' : 'RED'}: ${decision.why}\n`);
      process.exitCode = decision.green ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`atlas repo-shape check: ${error.message}\n`);
    process.exitCode = 2;
  }
}
