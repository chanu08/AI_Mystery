# AI Mystery Room

Create fictional mysteries from a story seed, inspect evidence, and solve the case. The React/Vite client and Express API are deployed together as one Node web service. MongoDB Atlas stores cases and Gemini generates them.

## Run locally

1. Install Node.js 20 or newer.
2. From the repository root, run `npm ci`.
3. Copy `server/.env.example` to `server/.env` and set `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, and `MONGODB_URI`.
4. Run `npm run dev` and open <http://localhost:5173>.

## Deploy to Render

This repository includes `render.yaml`. It builds the Vite client and serves the built files from Express, so a single Render Web Service hosts both the UI and `/api` endpoints.

### 1. Prepare MongoDB Atlas

1. In Atlas, create or select a cluster and create a database user with a strong password.
2. Add the deployment service's outbound IP ranges to the Atlas IP Access List when you can identify them. Atlas's `0.0.0.0/0` option allows connections from anywhere; use it only if needed, with a strong database password and least-privilege database user.
3. Copy the Node.js driver connection string. Replace its password placeholder and include a database name, for example `...mongodb.net/ai_mystery_room?retryWrites=true&w=majority`. URL-encode reserved characters in the username or password.

### 2. Push the project to GitHub

Commit and push this project, including `render.yaml`, to a GitHub repository. Do not commit `.env` files or paste secrets into source code. The repository's `.gitignore` excludes them.

### 3. Create the Render service

1. In Render, choose **New → Blueprint** and connect the GitHub repository containing `render.yaml`.
2. Review the proposed `ai-mystery-room` web service and deploy it. The build command is `npm ci --include=dev && npm run build`; the start command is `npm start`.
3. When prompted, set `GEMINI_API_KEY` to your Google AI Studio key and `MONGODB_URI` to the Atlas connection string. The model is set to `gemini-3.6-flash` in the Blueprint; you can change it in the Render environment settings.
4. Wait for the service health check at `/api/health` to pass. Render will show the live `https://…onrender.com` URL.

### 4. Verify the deployment

1. Open `https://YOUR-SERVICE.onrender.com/api/health`. Expect JSON with `status: "ok"` and `database: "connected"`.
2. Open the service root URL, create a mystery, and confirm that the case reaches the investigation screen.
3. If the service fails to start, check Render's deploy logs. If the health check reports a database issue, verify `MONGODB_URI`, Atlas's database user credentials, and its IP Access List.

## Deployment configuration

Set these in Render's Environment settings (never commit production secrets):

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`; enables SPA serving, secure cookies, and production checks. |
| `MONGODB_URI` | Yes | Atlas connection string. Production startup stops if MongoDB cannot connect. |
| `GEMINI_API_KEY` | Yes for AI generation | Google AI Studio API key. Without it, the server uses its demo case data. |
| `GEMINI_TEXT_MODEL` | Yes for AI generation | Recommended starting value: `gemini-3.6-flash`. |

Render supplies `PORT`. No `CLIENT_URL` is needed when the client and API are hosted on the same origin. `GEMINI_IMAGE_MODEL` is not currently used by the application; image and CCTV visuals are placeholders.

## Project structure

- `client/` React application and detective-room UI.
- `server/` Express API, Gemini integration, validation, scoring, and MongoDB persistence.
- `SPEC.md` product and technical source of truth.
