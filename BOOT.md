# Renmolt Node — boot fix (step 1)

This zip only fixes the Railway crash. It does not make x402 or MCP "real business" yet.

## What changed

- Removed `p-queue`. That package is ESM-only and crashed `node dist/server.cjs`
  with `import_p_queue.default is not a constructor`.
- Production start file is now `dist/server.js` (ESM), matching `"type": "module"`.
- Node 22 is pinned (`.nvmrc`, `engines`, `nixpacks.toml`).
- Railway health check is `/health`.
- `GET /` no longer returns JSON, so the UI can load after boot.
- Service JSON moved to `GET /status`.
- `/health` stays up even if `GEMINI_API_KEY` is missing.

## Upload to GitHub

1. Unzip. You should see `package.json` and `server.ts` at the top level
   (not inside an extra nested folder).
2. Replace the files in `UncleJo5149/Renmolt-Node-Validator` (or commit all files).
3. Push to `main` so Railway redeploys.

## Railway settings

Build command:

    npm install && npm run build

Start command:

    npm start

Health check path:

    /health

Environment variables to set (values stay in Railway, not in git):

- `GEMINI_API_KEY` (needed for document analyze)
- `HMAC_SECRET` (any long random string)
- `NODE_ENV=production`
- optional: `BASE_USDC_WALLET_ADDRESS`, `DISCORD_OR_SLACK_WEBHOOK_URL`

## After deploy, check these URLs

- `/health` — must return `"status":"online"`
- `/status` — must return `"status":"ok"`
- `/` — UI login page (Google OAuth may still fail until Firebase
  authorized origins include your Railway domain)

If `/health` is online, step 1 succeeded. We continue from there.
