# LumaCam

LumaCam is a campus announcement platform. Anyone can browse and post announcements (food, marketplace, events, surveys, opportunities, general notices) and create new categories, **without an account**. Posts appear as soon as they are submitted, and **only the person who uploaded a post can edit or delete it**.

### Editing your own posts without an account

When you post, the server returns a random secret *edit key* once; your browser keeps it (`localStorage`). Requests to edit, delete, change stock or restore that post send it in the `X-Edit-Token` header, and the server checks it against a stored SHA-256 hash. Everyone else sees the post read-only. To manage a post from another device, use **Copy my private edit link** (the key is in the `#` part of the link, which is never sent to servers). Posts created before this feature have no key and can only be changed in `/django-admin/`. A production version would replace keys with university login.

- **Backend:** Python, Django 5, Django REST Framework, SQLite locally (Postgres via `DATABASE_URL`)
- **Frontend:** React (Vite), React Router, Axios, Lucide icons, plain CSS
- **Abuse limits:** posting, editing and category creation are rate limited per IP. Deleted posts and categories go to a **Trash** for 30 days, where anyone can restore them. A category can only be deleted once it has no posts.

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
| `TRASH_DAYS` | Days deleted posts and categories stay in the Trash | `30` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional Web Push key pair (else generated and stored in the database) | generated |
| `PUSH_CONTACT` | Contact sent to push services | `mailto:lumacam-notifications@example.com` |
| `PUSH_MAX_PER_POST` | Max devices notified per new post | `500` |
| `PUSH_THROTTLE_RATE` | Subscribe/test requests per IP | `60/hour` |
| `AUTO_MIGRATE` | Set `0` to stop production instances applying migrations (and the Trash clean-up) on start | on when `DEBUG=false` |

### Trash

Deleting a post or category moves it to the **Trash** (bin icon in the header, `/trash`), which has separate tabs for announcements and categories. Anyone can restore items there, and right after a delete an **Undo** banner appears. Restoring a post whose category is also in the Trash restores the category too.

Items are erased for good `TRASH_DAYS` (default 30) after deletion. A category in the Trash waits until its newest deleted post is erased. Vercel has no always-on scheduler, so the clean-up runs when a server instance starts and whenever someone opens the Trash; `python manage.py purge_trash` runs it by hand or from cron. The app deliberately has no "delete forever" button, so a visitor to a shared link cannot erase recoverable items.

`/django-admin/` can also restore items (Announcements filtered by "In trash", or Categories filtered by "is removed").

`seed_demo` creates the admin account `admin` / `Admin12345!` for this page (change it with `python manage.py changepassword admin`). Nothing on the public site needs a login.

### PostgreSQL

Set `DATABASE_URL`. With `DEBUG=false` the server applies pending migrations itself on start (see `config/automigrate.py`); you can also run `python manage.py migrate` manually. The models use only portable field types.

### Phone notifications (Web Push)

Visitors pick categories and turn on phone notifications at **Notifications** (bell, then *Notification settings*, or `/notifications`). No account is needed: the browser's push subscription is stored with the chosen categories. When someone posts in one of those categories, the server sends an encrypted Web Push message (`announcements/push.py`, using `pywebpush`).

Anti-spam limits are enforced on the server for each device:

- **Frequency:** every new post, at most one an hour (default), or at most one a day (by the device's local calendar day).
- **Quiet hours:** 10pm to 7am device time, on by default.
- Notifications for the same category replace each other on the phone instead of stacking.
- Posts held back by a limit are not sent later; they still appear in the in-app bell.
- Only real browser push services (Google, Apple, Mozilla, Microsoft) are accepted as endpoints; dead subscriptions are removed automatically.

Platforms: Chrome/Edge/Firefox on Android and desktop work directly. On iPhone/iPad (iOS 16.4+), the site must first be added to the Home Screen; the settings page shows the steps.

The VAPID key pair is generated on first use and stored in the database (`PushKeys`), so no setup is needed. To use your own, set `VAPID_PUBLIC_KEY` (base64url) and `VAPID_PRIVATE_KEY` (PEM). Changing keys invalidates existing subscriptions.

### Selling categories

Categories with `sells_items` (Food & Drinks and Student Marketplace, or any new category with "People sell food or items here" ticked) add two things to their posts:

- **Stock status:** Available, Limited stock or Out of stock, switchable in one tap on the post page, with "Updated … ago". Out-of-stock cards are greyed out.
- **Pickup places:** up to 5 free-text tags (hostel blocks, campus spots), shared between posts so they work as filters and suggestions, and included in search.

Moving a post to a non-selling category clears both.

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

Covers posting without login and validation (optional contact, URLs, images), editing (including replacing, removing and keeping images, and clearing optional fields), event dates (validation, auto-expiry, date-range overlap, upcoming order), the Trash (restore, category auto-restore, 30-day purge incl. images), delete-as-hide, image storage and serving, user-created categories and delete rules, rate limits, category filter, search, ordering, and a live-HTTP post/edit/delete flow.

## API overview (`/api`)

All endpoints are public and need no login or CSRF token.

| Method & path | Notes |
|---|---|
| `GET /categories/` | with live announcement counts |
| `POST /categories/` | `name`, `description`, `icon`, `color`, `sells_items`; live immediately, rate limited |
| `DELETE /categories/:id/` | only when the category has no posts (else 400); moves it to the Trash |
| `GET /announcements/?category=&search=&date_from=&date_to=&categories=a,b&since=&ordering=newest\|upcoming\|oldest\|ending&page=` | live and unexpired only. `date_from`/`date_to` (YYYY-MM-DD) keep posts whose event dates overlap the range (undated posts drop out) and default the order to `upcoming`. `categories` takes several slugs; `since` (ISO date-time) returns posts created after it. `ending` sorts by "hide after" date, else the event's last day. Selling categories: `stock=in` hides out-of-stock posts, `pickup=<name>` filters by pickup place |
| `POST /announcements/` | multipart, needs `publisher_name`; contact is optional (`contact_method=none`); optional `event_start`/`event_end`; in selling categories `availability` (`available`/`limited`/`out`) and `pickup_locations` (list, or a JSON string in multipart, max 5); live immediately, rate limited |
| `GET /announcements/:id/` | |
| `PATCH /announcements/:id/` | needs the post's key in `X-Edit-Token` (else 403); multipart or JSON; `remove_image=true` drops the image; rate limited |
| `DELETE /announcements/:id/` | needs `X-Edit-Token`; moves the post to the Trash; rate limited |
| `GET /trash/announcements/?ids=1,2&search=`, `GET /trash/categories/` | Trash contents with `removed_at` and `purge_at` (posts: only the ids asked for); also erases expired items |
| `POST /trash/announcements/:id/restore/`, `POST /trash/categories/:id/restore/` | restore (posts need `X-Edit-Token`); a post brings its trashed category back too |
| `GET /pickup-locations/?category=` | pickup places used by live posts, most used first |
| `GET /push/key/` | Web Push public key |
| `POST /push/subscribe/` | `subscription`, `categories`, `frequency` (`every`/`hourly`/`daily`), `quiet_hours`, `utc_offset_minutes`; creates or updates this device |
| `POST /push/status/`, `/push/unsubscribe/`, `/push/test/` | by `endpoint`; the test ignores the limits and doesn't count toward them |
| `GET /media/<path>` | uploaded images |

## Manual test walkthrough

1. Open http://localhost:5173. The dashboard shows six category cards and recent announcements (after `seed_demo`).
2. Click **Create Announcement** (no login), fill in your name and details, add a photo, and submit. Click **View announcement**: it is already on the dashboard.
3. On the announcement, click **Edit**, change the title or replace the photo, and save.
4. Click a category card to verify filtering, use the search bar to verify search, and try the sort dropdown.
5. Give a post a **When** date, then on Explore pick **Today**, **Next 7 days**, **Next 30 days** or **Pick dates**. Only posts whose dates overlap the range show, soonest first. A post with a date but no "Hide after" date disappears the day after its event ends.
6. Use the contact button (WhatsApp, email or link). External links open in a new tab with `rel="noopener noreferrer"`.
7. Open **Categories** and click **New category**, pick a name, icon and colour, and save. The card appears on the home and Categories pages. Click its bin icon to delete it; a category that still has posts refuses with a message.
8. Click **Delete** on a post. It disappears and an **Undo** banner appears. Open the **Trash** (bin icon in the header) to see it with its erase date, and click **Restore**.
9. Resize the browser below 720px. The top nav becomes a bottom bar with a prominent (+) Create button.

10. Open a category and click **Follow** (or tick categories in the bell menu). Post something new in it; within a minute the bell shows a red count. Click **Mark all as seen** to clear it.

11. Open **Food & Drinks**, open a post and tap **Out of stock** under Stock. The card greys out and shows the badge; **In stock only** on the category page hides it. Tap a pickup place chip (e.g. "Block C lobby") to see everything collected there.

12. On an Android phone (Chrome), open the site, tap the bell, **Notification settings**, tick a category, **Turn on phone notifications**, allow, then **Send a test**. Post in that category from another device: the phone shows "New in …" even with the site closed. On iPhone, add the site to the Home Screen first.

## Limitations

- Ownership lives in the poster's browser: clearing browser data without saving the private edit link means losing the ability to edit that post. Production should use university login, plus moderation.
- Rate limits are the only spam control. On serverless hosting the counters are per instance and therefore weak.
- Notification choices are per browser/device (no accounts). The in-app bell checks every minute while the site is open; phone notifications use Web Push. There are no email alerts, and posts held back by quiet hours or the frequency limit are not delivered later.
- Images are stored in the database. That is fine for a demo, but a large site should move them to object storage.
- Seeded demo images are generated gradients. Real photographs come from uploads.
- Search is case-insensitive substring matching (no ranking).
