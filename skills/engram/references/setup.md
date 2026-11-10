# Connect to Engram

Give these steps to the user when the Engram tools are not connected. The user
does each step. Never ask the user to paste a token into the chat.

## 1. Get an account

1. Open https://engram.arjunkhera.io/account/signup and make an account.
2. A new account waits for approval by the Engram operator. The page at
   `/account/pending` shows this. Wait for the approval.

## 2a. Connect claude.ai (web, desktop and phone)

1. In claude.ai, open **Settings → Connectors → Add custom connector**.
2. Name: `Engram`. URL: `https://engram.arjunkhera.io/mcp`.
3. Select **Add**, then **Connect**. Sign in to Engram and allow the access.
4. In a chat, open the tools menu and turn on Engram.

The connector acts as the user (a user principal). It works on the phone too,
after you add it on the web once.

## 2b. Connect Claude Code

Pick one way.

**Sign in with OAuth:**

```sh
claude mcp add --transport http --scope user engram https://engram.arjunkhera.io/mcp
```

Then run `/mcp` in Claude Code, pick `engram`, and sign in.

**Use a token from the dashboard** (works when the sign-in does not):

1. Open https://engram.arjunkhera.io/account/dashboard and make a token.
   The dashboard shows it once. Copy it.
2. Put it in your shell profile, not in a file in a repo:
   `export ENGRAM_TOKEN=<the token>`
3. Add the server:

   ```sh
   claude mcp add --transport http --scope user engram \
     https://engram.arjunkhera.io/mcp \
     --header "Authorization: Bearer $ENGRAM_TOKEN"
   ```

4. Run `/mcp` and check that `engram` shows as connected.

A dashboard token is a user principal. It expires; make a new one on the
dashboard when calls fail with 401.

## 3. Add this skill

- **claude.ai:** download `engram-skill.zip` from
  https://github.com/Arjunkhera/engram-claude-plugin/releases/latest/download/engram-skill.zip.
  Then open Settings → Capabilities → Skills, and upload it. Code execution
  must be on.
- **Claude Code:** run these two commands in Claude Code:

  ```text
  /plugin marketplace add Arjunkhera/engram-claude-plugin
  /plugin install engram@engram
  ```

## 4. Check

Ask: "What types does my Engram have?" The agent calls `types_list` and lists
`note`, `task`, `journal`, `project`, `person` and others.
