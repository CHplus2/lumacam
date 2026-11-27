"""Paste-to-post: turn a seller's pasted WhatsApp message into post-form fields with DeepSeek.

The AI only suggests form fields. It never publishes, and the person always checks the form.
Everything it returns is treated like untrusted user input: unknown keys are dropped, the
category must exist, dates must parse, lengths are capped. Any failure returns None, and the
form falls back to manual entry.
"""
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import date

logger = logging.getLogger(__name__)

URL = 'https://api.deepseek.com/chat/completions'
MAX_INPUT = 3000      # characters of pasted text sent to the AI
ATTEMPT = 9           # seconds per try; a normal answer takes about 1 s (measured 24 Nov 2026)
TRIES = 2             # a stuck request is retried once, so the total wait stays under 20 s
_pool = ThreadPoolExecutor(max_workers=4)

# Fixed instructions first (DeepSeek caches a repeated prefix), the pasted text last.
SYSTEM = """You fill in a campus post form from a student's WhatsApp message.
Reply with json only, using exactly these keys and leaving out any the message does not state:
{"title": "short title, max 120 characters",
 "description": "the useful details, rewritten clearly, max 600 characters",
 "category": "one category slug from the list",
 "event_start": "YYYY-MM-DD", "event_end": "YYYY-MM-DD",
 "pickup_locations": ["place on campus"],
 "contact_method": "whatsapp | email | link",
 "contact_info": "phone number with country code, email, or https link",
 "lost_found": "lost | found, only when the message is about a lost or found item",
 "lost_found_place": "where it was lost or found, max 80 characters"}
Rules: never invent prices, dates, places or contact details. Malaysian numbers start with 60.
Write in the same language as the message (English or Malay).
Categories (slug: name): %s"""


def enabled():
    return bool(os.environ.get('DEEPSEEK_API_KEY')) and os.environ.get('AI_AUTOFILL_ENABLED', '1') not in ('0', 'false', 'no')


def _call(system, user_text, timeout):
    """One DeepSeek request; returns the reply text (may be blank) and the usage dict."""
    body = {
        'model': os.environ.get('DEEPSEEK_MODEL', 'deepseek-flash'),
        'response_format': {'type': 'json_object'},
        'thinking': {'type': 'disabled'},  # Flash reasons by default; extraction doesn't need it
        'max_tokens': 600,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user_text}],
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
        'Authorization': f"Bearer {os.environ['DEEPSEEK_API_KEY']}",
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    return data['choices'][0]['message']['content'], data.get('usage', {})


def _clean(data, categories):
    """Keep only valid, known fields. `categories` maps slug -> name."""
    if not isinstance(data, dict):
        return None
    out = {}
    for key, limit in (('title', 120), ('description', 3000)):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()[:limit]
    if data.get('category') in categories:
        out['category'] = data['category']
    for key in ('event_start', 'event_end'):
        try:
            out[key] = date.fromisoformat(str(data.get(key))).isoformat()
        except ValueError:
            pass
    if out.get('event_start') and out.get('event_end', out['event_start']) < out['event_start']:
        out.pop('event_end')
    places = data.get('pickup_locations')
    if isinstance(places, list):
        places = [p.strip()[:40] for p in places if isinstance(p, str) and len(p.strip()) >= 2][:5]
        if places:
            out['pickup_locations'] = places
    method, info = data.get('contact_method'), str(data.get('contact_info') or '').strip()
    if method == 'whatsapp':
        digits = re.sub(r'[\s\-+()]', '', info)
        if digits.isdigit() and 8 <= len(digits) <= 15:
            out['contact_method'], out['contact_info'] = method, digits
    elif method == 'email' and re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', info):
        out['contact_method'], out['contact_info'] = method, info
    elif method == 'link' and re.fullmatch(r'https?://\S+', info):
        out['contact_method'], out['contact_info'] = method, info
    if data.get('lost_found') in ('lost', 'found'):
        out['lost_found'] = data['lost_found']
        place = data.get('lost_found_place')
        if isinstance(place, str) and place.strip():
            out['lost_found_place'] = place.strip()[:80]
    return out or None


def ask_json(system, user, attempt=ATTEMPT):
    """Ask DeepSeek for a JSON object: one try plus one retry, each with a time limit.

    Returns (parsed dict or list, usage) or None on any failure. Callers must still clean the reply.
    Never logs the text sent.
    """
    for n in range(1, TRIES + 1):
        try:
            content, usage = _pool.submit(_call, system, user, attempt).result(timeout=attempt)
            return json.loads(content), usage  # blank reply -> ValueError
        except FutureTimeout:
            logger.warning('ai: no answer within %ss (try %s of %s)', attempt, n, TRIES)
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError, OSError) as exc:
            logger.warning('ai: failed (%s, try %s of %s)', type(exc).__name__, n, TRIES)
    return None


def autofill(text, categories, today=None):
    """Return a dict of form fields, or None when the AI can't help (the form stays manual)."""
    text = (text or '').strip()[:MAX_INPUT]
    if not text or not enabled():
        return None
    system = SYSTEM % ', '.join(f'{slug}: {name}' for slug, name in sorted(categories.items()))
    user = f"Today is {(today or date.today()).isoformat()}.\nMessage:\n{text}"
    started = time.monotonic()
    reply = ask_json(system, user)
    if reply is None:
        return None
    result, usage = _clean(reply[0], categories), reply[1]
    # Numbers only, never the pasted text.
    logger.info('ai_fill: %.1fs, tokens in=%s out=%s cached=%s, fields=%s', time.monotonic() - started,
                usage.get('prompt_tokens'), usage.get('completion_tokens'),
                usage.get('prompt_cache_hit_tokens'), sorted(result) if result else [])
    return result
