# Slim build (step 1b)

Removed unused Coinbase AgentKit packages. Those pulled WalletConnect and
crashed Railway `npm ci` with "Exit handler never called!".

## GitHub
Upload these files over the existing repo root. Replace package.json.
Delete package-lock.json on GitHub if the old one remains
(open the file → trash icon).

## Railway (browser only)
Settings → Build:
  npm install --legacy-peer-deps && npm run build
Settings → Start:
  node dist/server.js
Then Deploy.
