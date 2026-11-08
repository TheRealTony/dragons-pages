# dragons-pages

Team page for the Dragons (Ligue de hockey LHAI St-Constant, hockeylhai-stconstant.com), hosted on Netlify.

| Folder | What it holds |
| --- | --- |
| `dragons/` | The site Netlify publishes (Base directory = `dragons`). `index.html` is the whole page (formerly `dragons2026-2027.html`), with the logo embedded. |
| `worker/` | `dragons-relay-worker.js`, the Cloudflare Worker at `dragons-relay.tony-browne2010.workers.dev` that relays league data (Shark `Router.php`) to the page. Deployed by hand in Cloudflare. |
| `tools/` | `maj-dragons.ps1`, refreshes the saved data snapshot inside `dragons/index.html` (used when the league site can't be read). |
