# Engram for Claude

This skill teaches your Claude agent to use [Engram](https://engram.arjunkhera.io),
your personal knowledge graph, well. The agent learns to:

- keep your data clean: search before saving, keep your titles, cite ids
- run your own workflows on Engram: tasks, a journal, a reading list, people,
  projects, or any tracker
- keep each workflow's rules as a note in Engram, so every agent on every
  device follows the same rules

## 1. Connect Engram first

1. Make an account at https://engram.arjunkhera.io/account/signup. Wait for
   approval.
2. Connect your agent:
   - **claude.ai:** Settings → Connectors → Add custom connector. URL:
     `https://engram.arjunkhera.io/mcp`. Then select Connect and sign in.
   - **Claude Code:**
     `claude mcp add --transport http --scope user engram https://engram.arjunkhera.io/mcp`,
     then run `/mcp` and sign in.

Full steps, with the token option: [setup.md](skills/engram/references/setup.md).

## 2. Add the skill

**claude.ai (web, desktop, phone):**

1. Download [engram-skill.zip](https://github.com/Arjunkhera/engram-claude-plugin/releases/latest/download/engram-skill.zip).
2. Open Settings → Capabilities → Skills. Upload the zip. Code execution must
   be on.

No skill upload? Paste the text in [project-instructions.md](project-instructions.md)
into a claude.ai Project's instructions.

**Claude Code:**

```text
/plugin marketplace add Arjunkhera/engram-claude-plugin
/plugin install engram@engram
```

## 3. Try it

- "What do I have in Engram about my trip?"
- "Add a task: renew the passport, due next Friday."
- "I want to track my reading. Set it up."

## Source

The source of this skill lives in the Engram repo. This repo is a published
copy. Each merge to `master` with a new version in `.claude-plugin/plugin.json`
publishes a release with `engram-skill.zip`.
