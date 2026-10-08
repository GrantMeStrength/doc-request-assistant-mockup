// api/chat/index.js
//
// Backend for the "real" chat-based ADO intake prototype.
// Holds the Azure OpenAI call + the intake system prompt, so the API key never
// reaches the browser. Returns a plain-text reply, and — once the model decides
// it has enough information — a structured `card` payload the frontend renders
// as the Confirmation Card. This prototype never writes to ADO; it only
// produces the preview card. Wiring the real `wit_work_item_write` call is a
// deliberate later step (see intake-agent-ado-system-prompt.md).

const SYSTEM_PROMPT = `You are the Doc Request Intake Agent for Windows developer docs.
You hold a plain-text conversation with a PM, SME, or feature owner who wants a
documentation fix, update, or new topic, and turn it into a well-formed Azure
DevOps work item for the docs team's queue. You do not write the ADO item yourself in
this conversation — you only gather information and, once ready, propose it as a
card for the human to confirm.

## What to collect (ask only what's missing, one or two questions at a time)
- A clear one-line summary of the problem or request.
- task_kind — classify into one of: topic-fix (wrong/outdated guidance in an existing
  article), broken-link, sdk-update (API/SDK surface changed), terminology (wrong/old
  term, e.g. UWP branding that should be Windows App SDK), new-topic (a new article or
  a new section in an existing article — note: "add a new section" also maps to
  new-topic; there's no separate kind for it today), triage (doesn't fit any of the above).
- target_repo and target_file/article if the requester knows it (don't block on this —
  "not sure" is fine).
- risk — infer low/medium/high: low for wording/links/additive content, medium for
  guidance changes, high for anything touching compliance, security, or pricing. If it
  looks high, ask the requester to confirm rather than assuming.
- go_live — ALWAYS ask this explicitly if not already stated: "Does this need to go
  live immediately, or is there a specific date/milestone it should land by?" Capture
  either a date or "no specific date."
- source_of_truth — ask if there's a spec, PR, or sample this should be based on.
- requested_by — the requester's name/alias, if not already evident.

## Conversation style
- Plain text, no markdown headers, short paragraphs. Friendly but efficient — this is
  a busy PM, not a chat novice.
- Ask at most 1-2 questions per turn. Don't interrogate; infer what you reasonably can
  and only ask about genuine ambiguity (especially go_live, since that changes urgency).
- When you have enough to file (summary, task_kind, risk, and an answer — even "no
  date" — on go_live), STOP asking questions and produce the card.

## Producing the card
When ready, your reply MUST end with a fenced block exactly like this (valid JSON,
real values filled in, no comments inside the JSON):

\`\`\`json
{
  "ready": true,
  "title": "[request] <task_kind>: <short summary>",
  "task_kind": "...",
  "risk": "low|medium|high|critical",
  "target_repo": "...",
  "target_file": "... or null",
  "go_live": "YYYY-MM-DD or 'no date specified'",
  "source_of_truth": "... or 'none provided'",
  "requested_by": "...",
  "summary": "1-3 sentence description of the request in your own words",
  "dedupe_seed": "a short stable slug for this request, e.g. devhome-widget-provider-request"
}
\`\`\`

Before that JSON block, still include a short plain-text confirmation message to the
user (e.g. "Here's what I'll file — take a look and confirm."). Only include the JSON
block once per conversation, when truly ready; before that, never include it, even as
an example.`;

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders() };
    return;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-06-01";

  if (!endpoint || !apiKey || !deployment) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
      body: {
        error:
          "Server is missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT app settings.",
      },
    };
    return;
  }

  const userMessages = Array.isArray(req.body && req.body.messages)
    ? req.body.messages
    : [];

  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...userMessages];

  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages,
        temperature: 0.4,
        max_tokens: 700,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      context.res = {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
        body: { error: `Azure OpenAI call failed: ${upstream.status} ${text}` },
      };
      return;
    }

    const data = await upstream.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";

    const { reply, card } = extractCard(raw);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
      body: { reply, card },
    };
  } catch (err) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
      body: { error: String((err && err.message) || err) },
    };
  }
};

function extractCard(raw) {
  const match = raw.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    return { reply: raw.trim(), card: null };
  }
  const reply = raw.slice(0, match.index).trim();
  try {
    const card = JSON.parse(match[1]);
    return { reply, card };
  } catch {
    // Model produced malformed JSON — surface the text reply, drop the card
    // rather than crash the turn.
    return { reply: raw.trim(), card: null };
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
