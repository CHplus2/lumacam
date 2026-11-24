# LumaCam: next update plan (24 Nov 2026)

Team Trinovate. Prepared by Anantojo for review. Submission closes **Fri 27 Nov, 11:59 pm**; final **Wed 2 Dec, 11 am, Room G407**.

The full PDF version (flowcharts and the pictured design references from other apps) is shared privately in the team chat. Those screenshots belong to other companies, so they stay out of this public repo; the links below point to them.

## Summary

- **How we're scored.** The prototype is 15 of 100 points. Problem understanding, decisions and testing with real users are 55. Priority: one complete, working flow backed by tester evidence, not more features.
- **Already shipped:**
  - accounts that keep you logged in;
  - owner-only edit, delete and stock;
  - phone notifications with caps and quiet hours;
  - the Malaysia time-zone fix;
  - the "Your announcement is live" screen.

  Two of these came straight from tester complaints, which judges score as "feedback-led changes".
- **Biggest gaps in the current user journeys:**
  - anyone can see a seller's WhatsApp number;
  - follows are saved per browser, not per account;
  - nobody is asked what they're interested in;
  - a new post can't be shared to WhatsApp.
- **Positioning.** Don't ask students to leave WhatsApp. Make LumaCam the place WhatsApp links point to.
- **AI (optional).** Paste-to-post with DeepSeek: the seller pastes their WhatsApp message and the form fills in.
  - One central key on the server, with per-user limits.
  - About US$0.0004 per fill.
  - Speed is the risk. Artificial Analysis lists 39.4 s to the first answer for DeepSeek's own API at maximum reasoning, so reasoning is turned off and we measure it ourselves.

## Checklist

Owners left as `____` are assigned when the build list is approved. Items marked *(if time)* move to the Reflection slide if they aren't done by Thursday.

### Today, Tue 24 Nov: fix and decide
- [ ] **Change the production admin password** (Chris). The old seeded password was published in this public repo (README and `seed_demo.py`). This PR removes it from the code, but anything already created with it must be changed. Done when the old password no longer works.
- [ ] Approve the build list and who builds what (Team).
- [ ] Use pull requests instead of pushing straight to `feat/lumacam-mvp`, which redeploys the live site testers use (Team, including whoever runs Kiro).
- [ ] Decide: AI paste-to-post with DeepSeek, yes or no, and whose key and billing (Chris).
- [ ] Decide: optional email at sign-up, so password reset is possible later (Team).
- [ ] Book 3–5 student testers for Wed or Thu (Team).

### Build, Tue–Thu (one pull request each, tested before merge)
- [ ] WhatsApp as the default contact on the post form (`____`). Done when new posts start with WhatsApp selected.
- [ ] **Share to WhatsApp** on the "live" screen and on each post (`____`). Done when tapping it opens WhatsApp with the post link.
- [ ] Link previews: site-wide `og:title`, `og:description`, `og:image` (`____`). Done when a pasted link shows a card in WhatsApp.
- [ ] **Interest picker** after sign-up → follows → **"For you"** row on Home (`____`).
- [ ] Save follows and notification settings to the account, with a test (`____`).
- [ ] **Hide a seller's WhatsApp number from guests** in selling categories, in the API and not only the UI, with a test (`____`).
- [ ] Privacy page; it must name DeepSeek if the AI feature ships (`____`).
- [ ] Usage counts from the database: posts, accounts, follows, notification sign-ups (`____`).
- [ ] Report a post *(if time)*.
- [ ] Hide undated posts after 14 days; "Ends today" and "Limited stock" badges *(if time)*.
- [ ] View and contact-tap counts in My posts *(if time)*.
- [ ] Loading placeholders and instant button states *(if time)*.

### Optional: AI paste-to-post (only if the items above are merged by Wed night)
- [ ] Backend: central key, `thinking: disabled`, per-user limit, 3,000-character cap, fallback to manual; tests for a good reply, a blank reply, a timeout and an unknown category.
- [ ] Frontend: paste box, "Filled by AI, please check" label, 20-second limit.
- [ ] Measure speed and accuracy on 10 real seller messages.

### Evidence, Wed–Thu
- [ ] Tester sessions: time to post an item, time to find today's food, exact quotes.
- [ ] Feedback → change table with screenshots (at least 3 pairs).

### Submit by Fri 27 Nov, 11:59 pm
- [ ] Code freeze at noon; README set-up steps checked on a clean machine.
- [ ] 2-page write-up: problem, research, options, choice, testing, results.
- [ ] 3-minute narrated screen recording.
- [ ] Submit at galavate.com/challenge/submit.

### Final, Wed 2 Dec
- [ ] Deck: Problem 1 min · Ideas 2 · Validation ½ · Demo 3 · Reflection ½.
- [ ] Recorded backup of the demo.
- [ ] Reflection slide: student verification, fingerprint login, login expiry, AI scam flagging, go-to-market.

## Project scan (24 Nov 2026, branch `feat/lumacam-mvp` at 1e37533)

**Passing:**
- Backend tests: 105/105, and 107/107 with this PR.
- `makemigrations --check`: clean.
- Frontend build: OK.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Link fields only accept http(s).
- Uploaded images are served with `nosniff`.
- Edit, delete and stock are owner-checked on the server.

| # | Finding | Where | Suggested fix | Priority |
|---|---|---|---|---|
| 1 | The seeded admin password was a fixed value in a public repo, and `/django-admin/` is live | `seed_demo.py`, `README.md` | **Fixed in this PR**: password from `SEED_ADMIN_PASSWORD` or random, printed once. Still rotate the production password. | Today |
| 2 | **Rate limits aren't shared between server instances.** No `CACHES` setting, so Django uses per-process memory. On Vercel each instance counts separately and resets on a cold start, so the login limit (30/hour), post limit and a future AI quota are weak. | `config/settings.py` | Django's built-in `DatabaseCache` (no new dependency) plus `createcachetable` at startup | High |
| 3 | Throttles identify a client by the whole `X-Forwarded-For` header (DRF default, `NUM_PROXIES` unset). Whether a client can vary it to dodge limits depends on what Vercel forwards; **not verified**. | `REST_FRAMEWORK` settings | Check Vercel's header, then set `NUM_PROXIES` | Medium |
| 4 | `SECRET_KEY` falls back to a public development key when `DJANGO_SECRET_KEY` is missing, even with `DEBUG=false`. I can't see the Vercel settings to confirm it's set. | `config/settings.py:24` | Refuse to start when `DEBUG` is false and the key is the default | Medium |
| 5 | A seller's WhatsApp number (`contact_info`) is returned to every visitor | `AnnouncementSerializer` | Leave it out for guests in selling categories (checklist item) | High |
| 6 | Login tokens never expire | DRF `TokenAuthentication` | Expiry of 30–90 days | Reflection |
| 7 | Follows and notification choices live in `localStorage` only | `frontend/src/follows.js` | Store them on the account (checklist item) | High |
| 8 | No password reset or account deletion; no email at sign-up | accounts | Optional email field now; reset later | Medium |
| 9 | 6 lint warnings (`set-state-in-effect`): performance and style, not bugs | `hooks.js`, `Trash.jsx`, `Detail.jsx`, `Layout.jsx`, `AnnouncementForm.jsx`, `Listing.jsx` | Tidy when touching those files | Low |
| 10 | `check --deploy`: HSTS and SSL redirect not set. Vercel already forces HTTPS. | settings | Optional | Low |

## Design references (pattern only, never logos, colours or wording)

- Interest picker: [Amazon Alexa](https://mobbin.com/flows/f2bd3064-672b-4818-b4c1-e869ce3b16b3), [Google Arts & Culture](https://mobbin.com/flows/3ca72f4f-ff98-4cd2-82eb-7ba8240a1cc6)
- Notification settings: [Too Good To Go](https://mobbin.com/screens/ffa068cb-bad4-4f19-8edd-4506de4d1db3), [Notion](https://mobbin.com/screens/0728149c-34f1-451e-b694-197bc8d15ac7), [Luma](https://mobbin.com/screens/e1e4f64f-2cce-4667-bd8a-2993e9079227)
- Food row with stock and pickup time: [Too Good To Go](https://mobbin.com/screens/dd73f5fb-1631-46eb-868a-d8d89c68b075)
- Sell flow and success screen: [Vinted](https://mobbin.com/flows/f6d5c7c8-cc36-4fdb-9896-e6e93476f22e), [Depop](https://mobbin.com/flows/9f6278f3-41a4-4e03-9e3f-0db7cc5bcac7), [Vestiaire Collective](https://mobbin.com/flows/af2aced0-b3e0-4894-ad95-079d050b1de2)
- Share and Report sheet: [Shop](https://mobbin.com/screens/b42eade9-d072-413a-ae60-0c02e8301c18)
- Follow button with counts: [Luma](https://mobbin.com/screens/fd7a7128-2c46-4574-9d0f-dbd8213ef7c2)

(Mobbin links need a Mobbin login.)
