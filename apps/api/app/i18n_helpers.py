"""i18n helpers for catalog labels.

Reads Accept-Language header (or ?lang= query param) and returns a base
language code we support. Provides `localize_label_dict` which merges a
Spanish translation dict on top of the canonical English label dict so
icons (and any field not translated) survive untouched.

If we ever expand beyond es/en, add the new code to SUPPORTED_LANGUAGES
and a new translations module.
"""
from __future__ import annotations

from fastapi import Request

SUPPORTED_LANGUAGES = {"en", "es"}
DEFAULT_LANGUAGE = "en"


def parse_accept_language(header: str | None) -> str:
    """Extract the first acceptable base language code we support.

    Handles things like:
      - "es-MX,es;q=0.9,en;q=0.8" → "es"
      - "en-US,en;q=0.9"          → "en"
      - None / empty / "*"        → "en"
    """
    if not header:
        return DEFAULT_LANGUAGE
    # Take the first language that we support, base form (before "-")
    for piece in header.split(","):
        code = piece.strip().split(";")[0].strip().lower()
        if not code or code == "*":
            continue
        base = code.split("-", 1)[0]
        if base in SUPPORTED_LANGUAGES:
            return base
    return DEFAULT_LANGUAGE


def get_request_language(request: Request) -> str:
    """FastAPI dependency: pick the request's language.

    Priority:
      1. ?lang=es query param (override for testing / explicit links)
      2. Accept-Language header
      3. Default ("en")
    """
    qlang = request.query_params.get("lang")
    if qlang:
        base = qlang.lower().split("-", 1)[0]
        if base in SUPPORTED_LANGUAGES:
            return base
    return parse_accept_language(request.headers.get("accept-language"))


def localize_label_dict(en: dict, es: dict | None, lang: str) -> dict:
    """Merge a translated label dict on top of the canonical English one.

    We always keep the icon (and any other non-translated field) from
    the English dict; only `label` and `description` are overridden when
    the translation provides them.
    """
    if lang == "en" or not es:
        return en
    out = dict(en)
    for key in ("label", "description"):
        if key in es and es[key]:
            out[key] = es[key]
    return out


def localize_string(en: str | None, translations: dict[str, str], lang: str) -> str | None:
    """Look up a verbatim string in a translation dict; fall back to English."""
    if lang == "en" or not en:
        return en
    return translations.get(en, en)
