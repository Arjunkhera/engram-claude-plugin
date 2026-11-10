# engram-claude-plugin — agent guide

This repo is the public copy of the Engram skill for Claude. It ships the
skill two ways: as a Claude Code plugin with a one-plugin marketplace, and as
`engram-skill.zip` for claude.ai, built by the release job.

| You want | Read |
|---|---|
| What the skill says | [skills/engram/SKILL.md](skills/engram/SKILL.md) |
| How users install it | [README.md](README.md) |
| Every document in this repo | [docs/index.md](docs/index.md) |

## Rules

1. **Do not edit the skill here.** The source is `integrations/claude-kit` in
   Arjunkhera/Engram. The Engram workflow `claude-kit-sync` opens a pull
   request here, on branch `sync/engram`, after each Engram merge that changes
   the kit. Edit the source, then merge that pull request.
2. **A release is a merge.** `.github/workflows/release.yml` publishes release
   `v<version>` with `engram-skill.zip` when the version in
   `.claude-plugin/plugin.json` is new. Never push a tag by hand.
3. **Every change goes through a pull request.** `validate`
   (`.github/workflows/ci.yml`, `scripts/validate.mjs`) must be green.
   The Atlas merge door reads `required_checks` in `atlas.yaml`.
4. **Nothing private.** This repo is public. Never add a token, an entity id,
   or a private path.

## Atlas

Atlas sets how this repo is worked on. Follow the `atlas:lead` skill in every
session in this repo, from the first reply. Repo facts: [atlas.yaml](atlas.yaml).
Atlas writes `.github/atlas/` and the `atlas-*` workflows; do not edit them by
hand.
