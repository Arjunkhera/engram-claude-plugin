# Workflow recipes

Each recipe is a tested way to keep one kind of data in Engram. They come from
workflows that run on Engram every day. Start from the recipe that fits, then
write a contract note for it (the template is at the end).

In every recipe:

- `<task type id>` and the other ids come from `types_list`, by `name`.
- Dates are `YYYY-MM-DD` in the user's time zone.
- Ask for a time zone once, and write it in the contract.

## Tasks

**One entry:** a `task` entity.

| Part | Value |
|---|---|
| Title | Short. Starts with a verb. `auto_rename: false` when the user gave it. |
| Body | The description. Small steps as checklist lines at the end: `- [ ] step`. |
| `fields.status` | `todo`, `in_progress`, `waiting`, `done`, `cancelled`. Required. |
| `fields.priority` | `high`, `med`, `low`, or absent. |
| `fields.due_date` | `YYYY-MM-DD`. Optional `due_time` as `HH:MM`. |
| `fields.waiting_for` | Who or what it waits on, with `status: waiting`. |
| `fields.completed_at` | ISO date-time, set when it is done or cancelled. `null` when it opens again. |
| `fields.recurrence` | Optional RRULE, for example `FREQ=WEEKLY;BYDAY=SA`. |
| Tags | One area tag, for example `area-home`, `area-work`. |

**Steps:**

1. Add: `capture` with `type_id: <task type id>`, the title, the body, the
   fields and the area tag.
2. List: `search` with `type: task`, `limit: 50`, a short `q` (use `q: "task"`
   for everything), and `tags: area-<x>` when the user names an area. Then
   `get` each result for its fields. Drop `done` and `cancelled`. Group the
   answer: overdue, today, the next 7 days, later, no date.
3. Change: `get`, then `update` with only the fields that change.
4. Finish: `update` with `status: done` and `completed_at: <now>`. For a
   recurring task, move `due_date` to the next date instead, and keep
   `status: todo`.
5. Subtask: capture it as its own task, then `link` parent to child with
   intent `parent_of`.
6. A goal with many tasks: a `project` entity. Link each task to it with
   intent `belongs_to` (task to project). Then `rundown` gives the status.
7. "A must finish before B": `link` A to B with intent `blocks`.

Engram stores reminders as data, but it sends no alert. If the user needs an
alert, offer a calendar event through a calendar connector.

## Journal and daily log

**One entry:** a `journal` entity, one per day or one per thought.

1. Add: `capture` with `type_id: <journal type id>`, the user's own words in
   the body (do not rewrite them), and `fields.date: YYYY-MM-DD`.
2. Mention a person: `people_upsert` with `link_to: <journal id>`.
3. Read a period: `journeys_issue` with the user's words ("past week").
4. "What did I write about X?": `search` with `type: journal` and `q: X`.

## Reading list

**One entry:** a `bookmark`, made by `capture` with `url`. Engram fetches the
page text in the background.

| Part | Value |
|---|---|
| Tags | `reading` while it is unread, `reading-done` when read. |
| `fields.why` | One line: why the user saved it. |

1. Save: `search` the URL first. If it is new, `capture` with `url`, the
   `reading` tag and `fields.why`.
2. "What is on my list?": `entities_list` with `type: bookmark` and
   `tag: reading`.
3. Mark read: `get`, then `update` the full tag list with `reading-done` in
   place of `reading`.
4. "What did I read about X?": `search` X with `type: bookmark`.

## People and follow-ups

1. Add or update a person: `people_upsert` with `name`, `email` when known,
   and `fields` such as `org`, `role`, `how_we_met`.
2. Log a meeting or a call: `capture` a `note` with tag `meeting`, then
   `people_upsert` each person with `link_to: <note id>`.
3. A follow-up: a task (see [Tasks](#tasks)) linked to the person with intent
   `about_person`.
4. "What do I know about Priya?": find the person, then `traverse` with
   `direction: in` and `intents: about_person`.

## Projects and decisions

1. A project: a `project` entity with a short body: the goal and the done
   line.
2. Each task, note or journal for it: link to the project with intent
   `belongs_to`.
3. A decision: a `note` tagged `decision`, linked to the project. Give the
   decision, the date and the reason in the body.
4. "Where are we?": `rundown` with the project id.

## Any tracker (habits, spend, benefits, health readings)

Use this shape when no recipe above fits.

1. **An anchor entity** for the thing you track: a `project` or a `note`, for
   example "Gym habit 2026" or "Credit card A benefits". It holds the rules and
   the targets in its body.
2. **One entry per event**: a `note` (or `event` for a dated thing) with the
   values in `fields`, the tracker tag, and a `belongs_to` link to the anchor.
3. **Totals**: page through `entities_list` with the tag and a date range. Add
   the numbers yourself. Show the sum with the ids you used.
4. **Private or high-volume data** (bank lines, health readings): add the tag
   `no-model` to each entry. Engram then sends it to no model lane. Tell the
   user that semantic search does not find these entries; a plain-word search
   still does.

## The contract template

Capture the contract as a `note` with tags `workflow-contract` and the
workflow tag, `tier: longterm`, `auto_rename: false`, title
`Workflow: <name>`. Use this body:

```markdown
# Workflow: <name>

Purpose: <one sentence: what this does for the user>
Time zone: <for example Europe/London>
Principal: <user token | agent token>. <Edit directly | Propose every change>.

## One entry
- Type: <core type name>
- Title: <rule>
- Body: <rule>
- Fields: <name: values: meaning>, one per line
- Tags: <the tags this workflow owns>
- Links: <intent: from what to what>
- Anchor: <id of the anchor entity, if there is one>

## Requests and steps
- "<a request the user makes>": <the tool calls, in order>
- "<another request>": <...>

## Rules
- <anything the agent must never do, or must always ask first>
```

When the user changes how a workflow works, `get` the contract, change the
body, and `update` it (or `propose` with a user's OK when you hold an agent
token). Then follow the new body.
