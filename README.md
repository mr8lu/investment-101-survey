# Investment 101 Pre-Talk Questionnaire & Speaker Dashboard

A lightweight, high-contrast web application built for collecting anonymous pre-talk pulse responses from early 30s professionals and viewing/exporting the data live.

## Features

- **90-Second Audience Questionnaire (`/`)**:
  - Tailored specifically for early-30s professionals (non-401k cash buckets, confidence scale, accounts used, 3-5 year competing goals, biggest investing friction, topic votes, and an anonymous Open Mic question box).
  - Shows an instant anonymized group comparison right after submitting.
- **Speaker Dashboard (`/results`)**:
  - Protected by `ADMIN_KEY` (default: `weekend101` or pass `?key=YOUR_KEY` in the URL).
  - Displays top-level KPIs, 6 horizontal bar charts ready for screen-sharing or slides, and a full table of individual responses + Open Mic questions.
- **One-Click Data Pulling (CSV / JSON / CLI)**:
  - **Browser**: Click **Download CSV (Excel/Sheets)** or **Download Raw JSON** inside `/results`.
  - **CLI (`curl`)**:
    ```bash
    # Pull CSV directly from your deployed app
    curl -sSL "https://YOUR_APP_URL/api/admin/export.csv?key=weekend101" -o responses.csv

    # Pull raw JSON directly from your deployed app
    curl -sSL "https://YOUR_APP_URL/api/admin/export.json?key=weekend101" -o responses.json
    ```
- **Dual Storage Engine**:
  - Automatically uses PostgreSQL when `DATABASE_URL` is present (configured in `.do/app.yaml` so responses survive any container restarts on DigitalOcean App Platform).
  - Automatically falls back to local JSON file storage (`./data/submissions.json`) when running locally without Postgres.

---

## Local Development

### Prerequisites
- Node.js 20+ and `npm`

### Run Locally
```bash
npm install
npm run dev
```
- Questionnaire: [http://localhost:8080](http://localhost:8080)
- Speaker Dashboard: [http://localhost:8080/results?key=weekend101](http://localhost:8080/results?key=weekend101)

---

## Deploying to DigitalOcean App Platform (Weekend Hosting)

### Prerequisites
- A GitHub repository containing this folder
- DigitalOcean account (and optionally `doctl` CLI installed and authenticated)

### Option A: Deploy via `doctl` CLI
1. Push this directory to a GitHub repository and update `repo_clone_url` in `.do/app.yaml`.
2. Validate and create the app:
   ```bash
   doctl apps spec validate .do/app.yaml
   doctl apps create --spec .do/app.yaml
   ```
3. Once the weekend talk is over and you have downloaded your CSV/JSON exports, tear down the app so you only pay prorated weekend pennies (~$0.15-$0.30 total):
   ```bash
   doctl apps list
   doctl apps delete <APP_ID>
   ```

### Option B: Deploy via DigitalOcean Cloud Console
1. Push this project to GitHub.
2. In DigitalOcean Control Panel -> **Apps** -> **Create App** -> connect your GitHub repo.
3. App Platform will automatically detect `.do/app.yaml` (1 `apps-s-1vcpu-0.5gb` web service + 1 Dev PostgreSQL database).
4. Set your custom `ADMIN_KEY` environment variable if desired, then click **Create Resources**.
