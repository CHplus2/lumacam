# LumaCam

LumaCam is a campus announcement platform. Anyone can browse, post, edit and delete announcements (food, marketplace, events, surveys, opportunities, general notices) and create new categories, **without an account**. Posts appear as soon as they are submitted.

This open setup is meant for hackathon demos and shared test links. A production version would add university login so people can only change their own posts (see Limitations).

- **Backend:** Python, Django 5, Django REST Framework, SQLite locally (Postgres via `DATABASE_URL`)
- **Frontend:** React (Vite), React Router, Axios, Lucide icons, plain CSS
- **Abuse limits:** posting, editing and category creation are rate limited per IP. Delete hides posts and categories instead of erasing them, so they can be restored. A category can only be deleted once it has no posts.

```
lumacam/
├── backend/    Django project (config/), apps: accounts/ (user model for /django-admin/), announcements/
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
python manage.py seed_demo         # optional: sample announcements + emergency admin account
python manage.py runserver         # API at http://127.0.0.1:8000
```

### Environment configuration

All settings have development defaults. For deployments set these environment variables (see `backend/.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Signing key. **Must** be set in production. | insecure dev key |
| `DJANGO_DEBUG` | `true` / `false`. When `false`, cookies are marked `Secure`. | `true` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames of the backend | `localhost,127.0.0.1` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Comma-separated `https://` origins (used by `/django-admin/`) | local Vite URLs |
| `DATABASE_URL` | e.g. `postgres://user:pass@host:5432/db` | local SQLite file |
| `ANNOUNCE_THROTTLE_RATE` | New posts per IP | `10/hour` |
| `MODIFY_THROTTLE_RATE` | Edits and deletes per IP | `60/hour` |
| `CATEGORY_THROTTLE_RATE` | New categories per IP | `10/hour` |
| `AUTO_MIGRATE` | Set `0` to stop production instances applying migrations on start | on when `DEBUG=false` |

### Restoring deleted posts and categories

Deleting a post in the app sets its status to "Removed" and hides it. To bring it back, open `/django-admin/` on the backend, sign in, go to **Announcements**, filter by status "Removed", select the posts and run **Restore selected posts**.

Deleted categories work the same way: **Categories**, filter by "is removed", **Restore selected categories**. Creating a category with the same name in the app also brings it back.

`seed_demo` creates the admin account `admin` / `Admin12345!` for this page (change it with `python manage.py changepassword admin`). Nothing on the public site needs a login.

### PostgreSQL

Set `DATABASE_URL`. With `DEBUG=false` the server applies pending migrations itself on start (see `config/automigrate.py`); you can also run `python manage.py migrate` manually. The models use only portable field types.

### Images

Uploaded images are stored in the database (`announcements/storage.py`) and served from `/media/...`, so they work on hosts without a persistent disk such as Vercel. The frontend downsizes large photos before upload because Vercel rejects request bodies over 4.5MB; the backend accepts JPEG, PNG or WebP up to 4MB. Use `python manage.py seed_demo --no-images` to skip the placeholder images.

## Frontend setup

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` and `/media` to Django on `127.0.0.1:8000`. If your backend runs elsewhere, set `VITE_BACKEND_URL`.

Production build: `npm run build` (output in `frontend/dist`).

## Deploying frontend and backend separately (Vercel)

1. **Backend project:** set `DJANGO_ALLOWED_HOSTS` (your backend host, e.g. `my-backend.vercel.app`, or `.vercel.app`), `DJANGO_CSRF_TRUSTED_ORIGINS` (`https://<backend host>` for `/django-admin/`), `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY` and `DATABASE_URL`. Migrations run automatically on deploy; run `seed_demo --no-images` once if you want sample data.
2. **Frontend project:** `frontend/vercel.json` rewrites `/api` and `/media` to the backend, so the browser only talks to the frontend domain (no CORS needed). Edit the backend host in that file if yours differs.
3. **Persistence:** Vercel's filesystem is read-only and temporary, so SQLite does not work there. Use a hosted Postgres (e.g. Neon) for `DATABASE_URL`. Images are stored in that database too.

## Running tests

```bash
cd backend && source .venv/bin/activate
python manage.py test
```

Covers posting without login and validation (optional contact, URLs, images), editing (including replacing, removing and keeping images, and clearing optional fields), event dates (validation, auto-expiry, date-range overlap, upcoming order), delete-as-hide, image storage and serving, user-created categories and delete rules, rate limits, category filter, search, ordering, and a live-HTTP post/edit/delete flow.

## API overview (`/api`)

All endpoints are public and need no login or CSRF token.

| Method & path | Notes |
|---|---|
| `GET /categories/` | with live announcement counts |
| `POST /categories/` | `name`, `description`, `icon`, `color`; live immediately, rate limited |
| `DELETE /categories/:id/` | only when the category has no posts (else 400); hides it, restorable |
| `GET /announcements/?category=&search=&date_from=&date_to=&ordering=newest\|upcoming\|oldest\|expiring&page=` | live and unexpired only. `date_from`/`date_to` (YYYY-MM-DD) keep posts whose event dates overlap the range (undated posts drop out) and default the order to `upcoming` |
| `POST /announcements/` | multipart, needs `publisher_name`; contact is optional (`contact_method=none`); optional `event_start`/`event_end`; live immediately, rate limited |
| `GET /announcements/:id/` | |
| `PATCH /announcements/:id/` | multipart or JSON; `remove_image=true` drops the image; rate limited |
| `DELETE /announcements/:id/` | hides the post (restorable in `/django-admin/`); rate limited |
| `GET /media/<path>` | uploaded images |

## Manual test walkthrough

1. Open http://localhost:5173. The dashboard shows six category cards and recent announcements (after `seed_demo`).
2. Click **Create Announcement** (no login), fill in your name and details, add a photo, and submit. Click **View announcement**: it is already on the dashboard.
3. On the announcement, click **Edit**, change the title or replace the photo, and save.
4. Click a category card to verify filtering, use the search bar to verify search, and try the sort dropdown.
5. Give a post a **When** date, then on Explore pick **Today**, **Next 7 days**, **Next 30 days** or **Pick dates**. Only posts whose dates overlap the range show, soonest first. A post with a date but no "Hide after" date disappears the day after its event ends.
6. Use the contact button (WhatsApp, email or link). External links open in a new tab with `rel="noopener noreferrer"`.
7. Open **Categories** and click **New category**, pick a name, icon and colour, and save. The card appears on the home and Categories pages. Click its bin icon to delete it; a category that still has posts refuses with a message.
8. Click **Delete** on a post. It disappears; restore it from `/django-admin/` if you like.
9. Resize the browser below 720px. The top nav becomes a bottom bar with a prominent (+) Create button.

## Limitations

- Anyone with the link can edit or delete any post. This is intentional for demos; production should add university login and per-user ownership, plus moderation.
- Rate limits are the only spam control. On serverless hosting the counters are per instance and therefore weak.
- Notifications are a placeholder (bell icon only).
- Images are stored in the database. That is fine for a demo, but a large site should move them to object storage.
- Seeded demo images are generated gradients. Real photographs come from uploads.
- Search is case-insensitive substring matching (no ranking).
