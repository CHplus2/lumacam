# LumaCam

LumaCam is a campus announcement platform. Anyone can browse and post announcements (food, marketplace, events, surveys, opportunities, general notices) **without creating an account**. Every post waits in a pending queue until a moderator approves it.

- **Backend:** Python, Django 5, Django REST Framework, SQLite locally (Postgres via `DATABASE_URL`)
- **Frontend:** React (Vite), React Router, Axios, Lucide icons, plain CSS
- **Auth:** only moderators log in (Django session cookie, HttpOnly, with CSRF). Public posting is rate limited per IP.

```
lumacam/
├── backend/    Django project (config/), apps: accounts/, announcements/
└── frontend/   React app (src/pages, src/components)
```

## Prerequisites

Python 3.10+ and Node.js 18+ (developed on Python 3.11 and Node 22).

## Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python manage.py migrate           # creates db.sqlite3 and the six categories
python manage.py seed_demo         # optional: demo admin + sample announcements
python manage.py runserver         # API at http://127.0.0.1:8000
```

### Environment configuration

All settings have development defaults. For deployments set these environment variables (see `backend/.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Signing key. **Must** be set in production. | insecure dev key |
| `DJANGO_DEBUG` | `true` / `false`. When `false`, cookies are marked `Secure`. | `true` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames of the backend | `localhost,127.0.0.1` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Comma-separated `https://` origins of the frontend | local Vite URLs |
| `DATABASE_URL` | e.g. `postgres://user:pass@host:5432/db` | local SQLite file |
| `ANNOUNCE_THROTTLE_RATE` | Posts per IP | `10/hour` |
| `REPORT_THROTTLE_RATE` | Reports per IP | `20/hour` |
| `AUTH_THROTTLE_RATE` | Admin login attempts per IP | `30/min` |

### Moderator account

`seed_demo` creates the admin `admin` / `Admin12345!` (change it before any real use). For a real account:

```bash
python manage.py createsuperuser   # superusers automatically get the admin role
```

### PostgreSQL

Set `DATABASE_URL` and run `python manage.py migrate`. The models use only portable field types.

## Frontend setup

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` and `/media` to Django on `127.0.0.1:8000`, which keeps the session cookie same-origin. If your backend runs elsewhere, set `VITE_BACKEND_URL`.

To show the demo admin credentials on the login page (useful for judges), build with `VITE_DEMO_ADMIN_HINT="admin / Admin12345!"`.

Production build: `npm run build` (output in `frontend/dist`).

## Deploying frontend and backend separately (Vercel)

1. **Backend project:** set `DJANGO_ALLOWED_HOSTS` (your backend host, e.g. `my-backend.vercel.app`), `DJANGO_CSRF_TRUSTED_ORIGINS` (`https://<frontend host>`), `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY` and `DATABASE_URL`. Run `python manage.py migrate` and `seed_demo` once against that database.
2. **Frontend project:** `frontend/vercel.json` rewrites `/api` and `/media` to the backend, so the browser only talks to the frontend domain and the session cookie stays same-origin (no CORS needed). Edit the backend host in that file if yours differs.
3. **Persistence:** Vercel's filesystem is read-only and temporary. SQLite and local image uploads do not work there, so use a hosted Postgres for `DATABASE_URL`. Image uploads need object storage (e.g. Cloudinary or S3). Until that is configured, posting with an image will fail on Vercel; posts without an image work.

## Running tests

```bash
cd backend && source .venv/bin/activate
python manage.py test
```

Covers anonymous posting and validation (contacts, URLs, images), the post rate limit, pending to approved visibility, category filter, search, ordering, admin-only moderation and stats, reports, and a live-HTTP CSRF flow.

## API overview (`/api`)

| Method & path | Access | Notes |
|---|---|---|
| `GET /auth/csrf/` | public | sets the CSRF cookie |
| `POST /auth/login/`, `/auth/logout/`, `GET /auth/me/` | admin | moderators only |
| `GET /categories/` | public | with live announcement counts |
| `GET /announcements/?category=&search=&ordering=newest\|oldest\|expiring&page=` | public | approved and unexpired only |
| `POST /announcements/` | public | multipart, needs `publisher_name`; created as `pending`, rate limited |
| `GET /announcements/:id/` | public (approved) / admin | |
| `POST /announcements/:id/report/` | public | rate limited |
| `GET /admin/stats/` | admin | totals by status, open reports |
| `GET /admin/announcements/?status=&search=&reported=1` | admin | |
| `POST /admin/announcements/:id/approve/`, `.../reject/` | admin | reject accepts `reason` |
| `DELETE /admin/announcements/:id/` | admin | |
| `GET /admin/reports/`, `POST /admin/reports/:id/resolve/`, `.../dismiss/` | admin | |

## Manual test walkthrough

1. Open http://localhost:5173. The dashboard shows six category cards and recent announcements (after `seed_demo`).
2. Click **Create** (no login), fill in your name and details, and submit. You see "pending approval" and the post is not on the dashboard yet.
3. Click **Admin login**, sign in as `admin`, open the **Pending** tab and **Approve** the post. The stats cards update.
4. Back on the dashboard the approved post appears. Click a category card to verify filtering, use the search bar to verify search, and try the sort dropdown.
5. Open an announcement and use the contact button (WhatsApp, email or link). External links open in a new tab with `rel="noopener noreferrer"`.
6. On an announcement, use **Report**, then resolve it in Admin > Reports.
7. Resize the browser below 720px. The top nav becomes a bottom bar with a prominent (+) Create button.

## Limitations

- Anyone can post, so moderation and rate limiting are the only spam controls. On serverless hosting the rate-limit counters are per instance and therefore weak.
- Posters cannot edit or delete their own posts after submitting; only moderators can.
- Notifications are a placeholder (bell icon only).
- Uploaded images are stored on local disk; use object storage in production.
- Seeded demo images are generated gradients. Real photographs come from uploads.
- Search is case-insensitive substring matching (no ranking).
- Django serves `/media` only when `DEBUG=true`; in production serve it from your web server or storage.
