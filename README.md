# YouTube Channel Manager MCP

A personal Streamable HTTP MCP server that connects a Bhakti channel manager to the YouTube Data API and YouTube Analytics API through Google OAuth 2.0.

## Safety defaults

- Starts in `readonly` mode.
- Stores OAuth tokens encrypted with AES-256-GCM.
- Never stores Google passwords or OTPs.
- Exposes no delete tool and no direct public-publish tool.
- Uploads are restricted to `UPLOAD_ROOT` and default to private.
- Every mutation requires both server-side enablement and the exact approval phrase.
- Secrets and tokens are redacted from logs.

## Tools

Read tools:

- `youtube_channel_summary`
- `youtube_recent_videos`
- `youtube_channel_analytics`
- `youtube_top_content`
- `youtube_search_terms`

Controlled write tools:

- `youtube_update_metadata`
- `youtube_upload_private_video`
- `youtube_set_thumbnail`

## Google setup

1. Create or select a Google Cloud project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure the OAuth consent screen and add your own Google account as a test user while the app remains in testing.
4. Create an OAuth client of type **Web application**.
5. Add `<BASE_URL>/auth/google/callback` as an authorized redirect URI.
6. Copy `.env.example` to `.env` and fill the client ID, client secret, encryption key, and setup token.

Generate secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Use the first output for `TOKEN_ENCRYPTION_KEY` and the second for `SETUP_TOKEN`. Never commit `.env`.

## Run locally

```bash
npm install
npm run build
npm start
```

Open this URL in your normal signed-in browser:

```text
http://localhost:8787/auth/google/start?setup_token=<SETUP_TOKEN>
```

After consent, test the MCP endpoint at `http://localhost:8787/mcp` with MCP Inspector or connect it through a Secure MCP Tunnel.

## Enable managed writes later

Verify read tools first. Then change:

```dotenv
YOUTUBE_MODE=manager
MUTATIONS_ENABLED=true
```

Reconnect Google so the additional scopes are granted. Keep uploads private until the release package has been reviewed.

## Public deployment

Use a stable HTTPS endpoint ending in `/mcp`, persistent storage for `/app/data`, secret management for every credential, and authentication in front of `/mcp`. For a personal deployment, a Secure MCP Tunnel avoids exposing the local server publicly.

## Zero-idle Azure deployment

The included `azure/main.bicep` deploys the minimum production resources:

- Azure Container Apps Consumption with `minReplicas: 0` and `maxReplicas: 1`
- 0.25 vCPU and 0.5 GiB memory
- one 1 GiB Standard LRS Azure Files share for encrypted OAuth-token persistence
- HTTPS-only ingress
- secrets stored as Container App secrets
- read-only YouTube mode with mutations disabled
- no Azure Container Registry, Log Analytics workspace, database, VNet, public IP, or custom domain

Publish the image to a public GHCR package using `.github/workflows/publish-container.yml`, then deploy the Bicep file into a dedicated resource group. Do not put secrets in parameter files or source control.
