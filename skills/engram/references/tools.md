# Engram tools: details and traps

The server sends the full description of each tool when you connect. This page
holds only what an agent gets wrong most often.

## Read

| Tool | Use it for | Trap |
|---|---|---|
| `search` | Find entry points by content. Filters: `type`, `tags` (comma list, all must match), `state`, `after`, `before`, `limit`. | No fields in the results. At most 50 results. It is ranked, so it cannot answer "all of X". |
| `get` | Read one entity in full: body, fields, tags, state. | Call it before every change, so you change the current value. |
| `entities_list` | List every entity of a `type`, `tag`, `tier` or date range. | Page with `offset` until you have `total` rows. |
| `traverse` | Walk the edges from an id. Filters: `depth`, `direction` (`in`, `out`), `intents`. | Prefer it to a new search when you already hold an id. |
| `rundown` | A status bundle for one `project`: tasks by status, journals, decisions, people. | It takes the project id only. Notes tagged `decision` show as decisions. |
| `types_list` | Type ids, and the valid edge intents (rows with `kind: edge`). | Call it with no arguments. |
| `proposals_list` | The review queue. | Use it to show the user what waits for review. |
| `journeys_issue` | A link to the user's journal page for a period. | Days are India time (IST). The page needs the user's signed-in browser. |

## Write

| Tool | Use it for | Trap |
|---|---|---|
| `capture` | Every new entity. Fields: `title`, `body`, `url`, `type_id`, `tags`, `tier`, `fields`, `source`, `auto_rename`. | Tags alone are refused (400). A given title is rewritten unless `auto_rename: false`. |
| `people_upsert` | A person. `name`, `email`, `fields`, `link_to`. | Without an email, a near match makes a merge proposal, not a duplicate. |
| `update` | Change an entity that exists (user principal only). | `tags`, `body` and list fields are replaced whole. `null` clears a field. A key cannot be removed. |
| `link`, `unlink` | Add or remove an edge (user principal only). | The intent must be an edge type from `types_list`. |
| `archive` | Retire an entity (user principal only). | There is no MCP restore. Ask first. |
| `propose` | Any change that the user did not ask for, and every change from an agent token. | The op names differ from the direct tools. See below. |
| `teach` | Record that Engram got something wrong. | Its `ops` never run. It changes no data. |

### The ops of `propose`

Each proposal has one `action_class` and a list of ops that belong to it. A
wrong op for the class is refused (422).

| action_class | Ops |
|---|---|
| `link` | `link {src_id, dst_id, intent}`, `unlink {edge_id}` |
| `retag` | `set_tags {entity_id, tags}` (replaces all), `add_tag {entity_id, tag}`, `set_fields {entity_id, fields}` |
| `apply_type` | `apply_type {entity_id, type_id}`, `set_tags` |
| `archive` | `archive {entity_id}`, `unarchive {entity_id}` |
| `promote` | `promote {entity_id, tier}` |
| `supersede` | `link`, `unlink`, only for intent `supersedes` |
| `attach` | `attach_blob {entity_id, blob_id, filename}` |
| `merge` | `link`, `archive`. Engram files these itself. Do not file one. |
| `extract_fields` | `set_fields`. Engram files these itself. |
| `create_type` | No ops. Engram files these itself. |

The direct `link` tool uses `src` and `dst`. The `link` op of `propose` uses
`src_id` and `dst_id`. If the server refuses an op, read its error: it names the
field it wants.

Always send a `rationale` that starts with `[<workflow>]`. Send a `confidence`
from 0 to 1 that is honest. A proposal from an agent token always waits for
review.

## Attach a file

1. Get the size in bytes and the SHA-256 of the file.
2. Call `blob_declare` with `sha256`, `size`, `mime` and `filename`.
   - User principal: also send `entity_id` to attach it to an entity.
   - Agent principal: send no `entity_id`.
3. PUT the bytes to the `upload_url` that comes back. Send exactly the headers
   in `put_headers`. This step needs a shell (Claude Code). In claude.ai, ask
   the user to upload the file in the Engram reader instead.
4. Call `blob_confirm` with the `blob_id`. For audio or video, pass
   `kinds: ["transcript"]` if the user wants a transcript.
5. Agent principal only: `propose` with action class `attach` to attach it.

A PDF that shows `document_encrypted` has a password. Only the user can unlock
it, in the reader. Never ask for the password, and never store one.

## Errors

| Code | Meaning | Do this |
|---|---|---|
| 400 | The input is wrong, for example a tag-only capture. | Read the message and fix the call. |
| 401 | The token is missing or expired. | Ask the user to sign in again (see [setup.md](setup.md)). |
| 403 | An agent token called a direct-change tool. | Use `propose`. |
| 422 | An op does not belong to the action class. | Fix the class or the op. |
| 429 `watermark_exceeded` | The review queue is full. | Stop proposing. Tell the user to clear the queue. |
