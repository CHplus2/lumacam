# LumaCam

LumaCam is a campus announcement platform. Students publish announcements (food, marketplace, events, surveys, opportunities, general notices) and others browse them by category or search. Administrators moderate every submission before it goes public.

- **Backend:** Python, Django 5, Django REST Framework, SQLite (models are PostgreSQL-compatible)
- **Frontend:** React (Vite), React Router, Axios, Lucide icons, plain CSS
- **Auth:** Django session cookie (HttpOnly) with CSRF protection, role-based permissions (`student`, `admin`)

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
python manage.py seed_demo         # optional: demo users + sample announcements
python manage.py runserver         # API at http://127.0.0.1:8000
```

### Environment configuration

All settings have development defaults. For anything beyond local use, set these environment variables (see `backend/.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Signing key. **Must** be set in production. | insecure dev key |
| `DJANGO_DEBUG` | `true` / `false`. When `false`, cookies are marked `Secure`. | `true` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames | `localhost,127.0.0.1` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Comma-separated frontend origins | `http://localhost:5173,http://127.0.0.1:5173` |
| `AUTH_THROTTLE_RATE` | Rate limit for login/register | `30/min` |

### Creating an administrator

The demo seed creates `admin` / `Admin12345!`. For a real admin account:

```bash
python manage.py createsuperuser   # superusers automatically get the admin role
```

Public registration can only create students. Demo student: `student` / `Student12345!`.

### Moving to PostgreSQL later

Models use only portable field types. Install `psycopg`, change `DATABASES` in `config/settings.py` to the `django.db.backends.postgresql` engine, then run `python manage.py migrate`.

## Frontend setup

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` and `/media` to the Django server on `127.0.0.1:8000`, which keeps the session cookie same-origin. If your backend runs elsewhere, set `VITE_BACKEND_URL` (for example `VITE_BACKEND_URL=http://host:8000 npm run dev`).

Production build: `npm run build` (output in `frontend/dist`). Serve it behind a reverse proxy that also forwards `/api` and `/media` to Django.

## Running tests

```bash
cd backend && source .venv/bin/activate
python manage.py test
```

Covers registration, login and logout, role-escalation attempts, submission and validation (contacts, URLs, images), pending to approved visibility, category filter, search, ordering, ownership rules, admin permissions and stats, reports, and a live-HTTP CSRF flow.

## API overview (`/api`)

| Method & path | Access | Notes |
|---|---|---|
| `GET /auth/csrf/` | public | sets the CSRF cookie |
| `POST /auth/register/`, `/auth/login/`, `/auth/logout/` | public / user | login accepts username or email |
| `GET, PATCH /auth/me/` | user | profile |
| `GET /categories/` | public | with live announcement counts |
| `GET /announcements/?category=&search=&ordering=newest\|oldest\|expiring&page=` | public | approved and unexpired only |
| `POST /announcements/` | user | multipart; created as `pending` (admins: auto-approved) |
| `GET /announcements/mine/` | user | all statuses |
| `GET, PATCH, DELETE /announcements/:id/` | public (approved) / owner / admin | student edits return the post to `pending` |
| `POST /announcements/:id/report/` | user | one open report per user per post |
| `GET /admin/stats/` | admin | totals by status, open reports |
| `GET /admin/announcements/?status=&search=&reported=1` | admin | |
| `POST /admin/announcements/:id/approve/`, `.../reject/` | admin | reject accepts `reason` |
| `DELETE /admin/announcements/:id/` | admin | |
| `GET /admin/reports/`, `POST /admin/reports/:id/resolve/`, `.../dismiss/` | admin | |

## Manual test walkthrough

1. Open http://localhost:5173. The dashboard shows six category cards and recent announcements (after `seed_demo`).
2. **Register** a new student (or log in as `student`), then **Create** an announcement. You should see the "pending approval" message and it will not appear on the dashboard yet. Check it under **My Announcements** (status badge).
3. Log out, log in as `admin` and open **Admin** (header or mobile nav). Review the **Pending** tab and **Approve** the post. The stats cards update.
4. Back on the dashboard the approved post appears. Click a category card to verify filtering, use the search bar to verify search, and try the sort dropdown.
5. Open an announcement and use the contact button (WhatsApp, email or link). External links open in a new tab with `rel="noopener noreferrer"`.
6. As the owner, **Edit** and **Delete** a post. As another student, use **Report**, then resolve it in Admin > Reports.
7. Resize the browser below 720px. The top nav becomes a bottom bar with a prominent (+) Create button.

## Limitations

- Notifications are a placeholder (bell icon only).
- No email verification or password reset.
- Student identity is not tied to a university email domain.
- Uploaded images are stored on local disk; use object storage and a CDN in production.
- Seeded demo images are generated gradients. Real photographs come from user uploads.
- Search is case-insensitive substring matching (no ranking).
- Django serves `/media` only when `DEBUG=true`; in production serve it from your web server.
