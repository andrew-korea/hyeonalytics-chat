# Hyeonalytics Chat

A small RAG-style chat widget for hyeonalytics.com. Deployed as a Cloudflare
Worker with static assets.

- `public/widget.js` — the floating chat button + panel UI, embedded on the
  WordPress site via `<script src="...">`.
- `src/index.js` — the Worker. On `POST /chat`, it searches hyeonalytics.com's
  own WordPress REST API for the most relevant pages to the user's question,
  pulls their content, and passes it as context to Groq's chat completions
  API to generate an answer grounded in the site's own content.

## Configuration

Requires a `GROQ_API_KEY` secret set on the Worker (Settings → Variables and
Secrets → add as **Secret**, not a plain variable — see the pokewallet
project's history for why that distinction matters).

## Running locally

```
npx wrangler dev
```
