# ScopeGuard

ScopeGuard is a lightweight single-page app (Express backend + static frontend) that helps freelancers detect scope creep. Given an original project scope, a client's new request, and an hourly rate, the app uses Google Generative AI to:

[Live demo](https://scopeguard.onrender.com) · [Source on GitHub](https://github.com/hiidcbye/ScopeGuard)

ScopeGuard is a lightweight single-page app (Express backend + static frontend) that helps freelancers detect scope creep. Given an original project scope, a client's new request, and an hourly rate, the app uses Google Generative AI to:

- Classify whether the new request is In Scope / Out of Scope / Partially Out of Scope
- Estimate extra hours required (if any)
- Calculate revenue at risk (estimatedHours × hourlyRate)
- Provide short evidence bullets and a concise email you can send the client

This repository is intended as a small demo and starting point for building a scope‑management assistant.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Configure environment

Copy `.env.example` to `.env` and set your API key:

```
GEMINI_API_KEY=your_gemini_api_key_here
```

3. Run the app

```bash
npm start
# then open http://localhost:3000
```

## Files of interest

- `server.js` — Express backend that calls Google Generative AI
- `public/script.js` — client-side UI logic and API calls
- `public/style.css`, `public/index.html` — frontend
- `.env.example` — template for required environment variables
- `firebase.json`, `.firebaserc` — Firebase Hosting configuration

## Project structure

```text
ScopeGuard/
  firebase.json
  .firebaserc
  public/
    index.html
    style.css
    script.js
    assets/
  server.js
  package.json
  package-lock.json
  .env
```

## Configuration

- Backend default origin: `http://localhost:3000`. Override in-browser with `window.SCOPEGUARD_API_BASE_URL` before the app loads.

## Corrections & Recent Fixes

This project recently received several hardening fixes; important points to note:

- Model compatibility and resilience
  - Replaced a deprecated model string and preferring `gemini-2.5-flash`. The backend will try fallback candidates (`gemini-2.5-flash-lite`, `gemini-2.0-flash`) and uses retry/backoff on rate limits.

- Robust model output handling
  - Server now extracts the first `{...}` block from model text, applies simple repair heuristics, parses JSON, and validates the schema before returning to the frontend. This reduces errors from malformed or wrapped LLM output.

- Two-step analyzer → writer flow
  - The server first asks the model for a compact analysis JSON (no email), validates it, then asks the model to generate the email using those exact numbers. This reduces hallucinated calculations.

- Client fixes
  - `script.js` now safely handles empty or non-JSON error responses and shows clearer banner text for verdicts and revenue risk (no misleading “Clear!” when verdict is Out of Scope).
  - Frontend now posts to the explicit backend origin to avoid 405 errors from static dev servers.

## Security & Git guidance

- `.env` is ignored by default via `.gitignore`. Do NOT commit secrets.
- If you accidentally committed a secret to git, remove it from history and rotate the key. For a quick fix:

```bash
git rm --cached .env
git commit -m "remove .env"
# rotate the API key immediately
```

## Troubleshooting

- `405` on POST: ensure the frontend is configured to call the running backend origin (see `SCOPEGUARD_API_BASE_URL`) and that `npm start` is running.
- Model 404s: ensure your API key and region have access to the requested Gemini model; server will try fallbacks automatically.
- JSON parse errors: server implements extraction and repair heuristics; if you see parsing failures, check logs in `server.js` to inspect raw model responses.

## Contributing

This is a demo project—contributions welcome. For major changes, open an issue describing the improvement and include sample inputs/outputs where helpful.

## License

MIT
