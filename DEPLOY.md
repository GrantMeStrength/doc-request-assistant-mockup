# Deploying the live chat prototype

This repo has two parts:

- **The static mockup** (`index.html`) — scripted, no backend, works as-is on GitHub Pages.
- **The live chat prototype** (`live-chat.html` + `api/`) — a real conversation backed by
  Azure OpenAI. This needs Azure Static Web Apps; it will **not** work on GitHub Pages,
  because GitHub Pages can't run the `api/` Function or hold a secret key.

## 1. Prerequisites

- An Azure subscription with access to **Azure OpenAI** (a resource + a chat-completion
  deployment, e.g. `gpt-4o-mini` or `gpt-4o`).
- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and the
  [Static Web Apps CLI](https://learn.microsoft.com/azure/static-web-apps/local-development) (`npm i -g @azure/static-web-apps-cli`) if you want to test locally first.

## 2. Create the Static Web App (one-time)

```bash
az login
az group create -n doc-request-assistant-rg -l eastus2

az staticwebapp create \
  --name doc-request-assistant \
  --resource-group doc-request-assistant-rg \
  --source https://github.com/GrantMeStrength/doc-request-assistant-mockup \
  --location eastus2 \
  --branch main \
  --app-location "/" \
  --api-location "api" \
  --login-with-github
```

This walks you through authorizing GitHub and adds a deploy workflow
(`.github/workflows/azure-static-web-apps-*.yml`) to the repo automatically — commit and
push it once it's generated.

## 3. Configure the Azure OpenAI secrets

**Never commit these.** Set them as Static Web App application settings instead:

```bash
az staticwebapp appsettings set \
  --name doc-request-assistant \
  --setting-names \
    AZURE_OPENAI_ENDPOINT="https://<your-resource>.openai.azure.com" \
    AZURE_OPENAI_API_KEY="<your-key>" \
    AZURE_OPENAI_DEPLOYMENT="<your-deployment-name>" \
    AZURE_OPENAI_API_VERSION="2024-06-01"
```

## 4. Test locally first (optional but recommended)

```bash
cd mockup/api
cp local.settings.json.example local.settings.json
# edit local.settings.json with your real endpoint/key/deployment
npm install
func start
```

In another terminal, from the `mockup/` folder:

```bash
swa start . --api-location api
```

Open the URL it prints, go to `live-chat.html`, and have a conversation.

## 5. Try it live

Once deployed, open `https://<your-static-web-app>.azurestaticapps.net/live-chat.html`.

## Notes

- This prototype **only previews the card** — it does not call Azure DevOps. Wiring the
  real `wit_work_item_write` create call (with the dedupe check first) is the next step,
  and should reuse the field mapping and format in `intake-agent-ado-system-prompt.md`
  (including the fenced-YAML description-block format — not an HTML comment; ADO strips those).
- The system prompt the API uses lives in `api/chat/index.js`. Keep it in sync with
  `intake-agent-ado-system-prompt.md` as that spec evolves.
