# Power Automate setup for `request-form.html`

This replaces the Azure Functions / Azure OpenAI backend with a no-code flow you build
in your browser at [make.powerautomate.com](https://make.powerautomate.com). No Azure
subscription, no API keys, no `az login`.

## 1. Create the flow

1. Go to make.powerautomate.com → **My flows** → **New flow** → **Instant cloud flow**.
2. Trigger: **"When an HTTP request is received"**.
3. Set the **Request Body JSON Schema** to:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "task_kind": { "type": "string" },
    "risk": { "type": "string" },
    "target_repo": { "type": "string" },
    "target_file": { "type": ["string", "null"] },
    "go_live": { "type": "string" },
    "source_of_truth": { "type": "string" },
    "requested_by": { "type": "string" },
    "summary": { "type": "string" },
    "dedupe_hash": { "type": "string" },
    "source_system": { "type": "string" }
  }
}
```

## 2. Dedupe check (before creating)

Add a **"Send an HTTP request to Azure DevOps"** action (part of the standard Azure
DevOps connector) to run a WIQL query for an existing item tagged with this
`dedupe_hash`:

- **Organization Name**: `msft-skilling`
- Method: `POST`
- Relative URL: `Content/_apis/wit/wiql?api-version=7.0`
- Body:
```json
{
  "query": "SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS 'dedupe:@{triggerBody()?['dedupe_hash']}' AND [System.TeamProject] = 'Content'"
}
```

> **Note:** the ADO *project* here (`Content`, org `msft-skilling`) is the shared intake
> ledger used by the existing sweeper + GitHub-issue intake pipeline, not tied to any one
> GitHub docs repo. A single request might target `windows-dev-docs-pr`, `win32-pr`,
> `windows-ai-docs-pr`, `msix-pr`, etc. — that's captured in the `target_repo` field and
> the Description body, not by the ADO project. Don't confuse this with `windows-uwp`,
> which is a *different* ADO project (org `cpubwin`) used only for WinRT/Win32 API
> reference content and was the throwaway project used for the earlier one-off live test
> (`windows-uwp#61017`).

Add a **Condition**: `length(body('Send_an_HTTP_request_to_Azure_DevOps')?['workItems'])` is
greater than `0`.

- **If yes** (duplicate found): skip creation, respond with the existing item's URL (see
  step 4 — same Response shape, `duplicate: true`).
- **If no**: continue to step 3.

## 3. Create the work item

Add **"Create a work item"** (Azure DevOps connector), inside the "If no" branch:

| Field | Value |
|---|---|
| Organization | `msft-skilling` |
| Project | `Content` |
| Work item type | `Task` |
| Title | `triggerBody()?['title']` |
| Tags | `concat('kind:', triggerBody()?['task_kind'], '; risk:', triggerBody()?['risk'], '; auto:detected; dedupe:', triggerBody()?['dedupe_hash'])` |
| Description | see below — **use the fenced-code-block format, not an HTML comment** |
| Area Path | your team's area path |

**Description field** — build this as a **Compose** action first (easier to get the
newlines right than typing directly into the connector's field), then reference the
Compose output as the Description value:

```
@{triggerBody()?['summary']}

Source of truth: @{triggerBody()?['source_of_truth']}
Requested by: @{triggerBody()?['requested_by']}
Go live: @{triggerBody()?['go_live']}

```yaml
docs-automation:v1
dedupe: @{triggerBody()?['dedupe_hash']}
task_kind: @{triggerBody()?['task_kind']}
risk: @{triggerBody()?['risk']}
target_repo: @{triggerBody()?['target_repo']}
target_file: @{triggerBody()?['target_file']}
source_system: @{triggerBody()?['source_system']}
```
```

> **Live-tested correction carried over from the ADO prototype**: a prior test against a
> real ADO item (`windows-uwp#61017`) confirmed ADO **silently strips HTML comments**
> (`<!-- ... -->`) from `System.Description` on save — the block just vanishes, no error.
> A fenced ` ```yaml ` code block survived a save/reload round trip and is the format
> used above. **Power Automate's connector may format the Description differently than
> the raw API call we tested** (it might submit as HTML rather than Markdown) — the
> first real flow run is the actual test; if the fenced block gets stripped too, that's
> useful to know and means falling back to plain labeled lines (`dedupe: ...`,
> `task_kind: ...`) without any fencing at all, which can't be "stripped" because
> there's no special syntax to strip.

## 4. Respond to the form

Add a final **"Response"** action (after both branches re-join, or one per branch):

```json
{
  "id": "@{outputs('Create_a_work_item')?['body/id']}",
  "url": "@{outputs('Create_a_work_item')?['body/_links/html/href']}",
  "duplicate": false
}
```

For the duplicate branch, set `"duplicate": true` and pull the `id`/`url` from the
WIQL result instead.

Status code: `200` on both branches (the form checks `data.duplicate`, not the HTTP
status).

## 5. Save, copy the URL, wire up the form

1. Save the flow. Open the trigger step — copy the **HTTP POST URL**.
2. Open `request-form.html`, find the line near the bottom:
   ```js
   const FLOW_URL = "";
   ```
   Paste the URL between the quotes.
3. Commit and push. The form on GitHub Pages now posts straight to your flow.

## Notes / open items

- **`Content` project**: the real target project referenced by the upstream schema
  isn't accessible from this prototyping environment — use whatever project you have
  write access to for testing (e.g. a sandbox project), and point it at the real one
  once you confirm which ADO org/project the docs team's queue actually lives in.
- **No secret in the page**: the flow's trigger URL contains a long signature that acts
  as a shared secret. Anyone with the URL can submit — fine for an internal prototype
  shared with a small group, but don't publish the URL broadly. If you want real access
  control, add an Office 365 user-based trigger (e.g. a Teams/Forms front end) instead
  of a public HTTP trigger, as a later step.
- **No LLM in this version**: the static form asks fixed questions instead of an
  open-ended chat. That's a deliberate simplification to remove the Azure OpenAI
  dependency — the chat-based version (`live-chat.html`) is still there if/when the
  Static Web Apps deployment gets unblocked.
