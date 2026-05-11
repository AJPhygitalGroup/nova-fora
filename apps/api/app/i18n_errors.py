"""Bilingual error-message registry for HTTPException details.

The frontend (`api/client.js`) renders `error.detail` directly as a React
child, so any string we put in `HTTPException(detail=...)` is visible to
the end user. This module centralizes the en/es translations so routes
can stay declarative:

    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        tr_error(E.DEFECT_NOT_FOUND, lang),
    )

`lang` comes from `app.i18n_helpers.get_request_language` — a FastAPI
dependency that resolves `Accept-Language` (or `?lang=`) to a base code
("en" or "es"). Add it to a route's signature once and reuse for every
error raised inside.

Scope: only **user-facing** errors are translated. Internal 500s (e.g.
"dangling vehicle") stay English on purpose — they're for engineers.

To add a new error:
  1. Add a code constant to `E`
  2. Add `{en, es}` entries under that key in `MESSAGES`
  3. Use it: `tr_error(E.MY_CODE, lang, **vars)`

Parameterized messages use `str.format()` placeholders (NOT % or f-string),
so the variables are passed via kwargs:

    "user_status": {"en": "user status is {status}", "es": "el estado del usuario es {status}"}
    tr_error(E.USER_STATUS, lang, status="suspended")
"""
from __future__ import annotations


class E:
    """Error code constants.

    Grouped by domain. The string value is the lookup key into MESSAGES.
    """

    # ─── auth + tokens ───────────────────────────────────────
    MISSING_AUTH_HEADER = "missing_auth_header"
    INVALID_TOKEN = "invalid_token"
    INVALID_TOKEN_SUBJECT = "invalid_token_subject"
    USER_NOT_FOUND = "user_not_found"
    USER_STATUS = "user_status"
    USER_NO_LONGER_ACTIVE = "user_no_longer_active"
    INVALID_CREDENTIALS = "invalid_credentials"
    REQUIRES_ROLE = "requires_role"
    DANGLING_ORG = "dangling_org"

    # ─── generic ownership / not-found ───────────────────────
    NOT_YOUR_DEFECT = "not_your_defect"
    NOT_YOUR_INSPECTION = "not_your_inspection"
    NOT_YOUR_DSP = "not_your_dsp"
    NOT_YOUR_VEHICLE = "not_your_vehicle"
    NOT_YOUR_WORK_ORDER = "not_your_work_order"
    DEFECT_NOT_FOUND = "defect_not_found"
    INSPECTION_NOT_FOUND = "inspection_not_found"
    VEHICLE_NOT_FOUND = "vehicle_not_found"
    WORK_ORDER_NOT_FOUND = "work_order_not_found"
    PHOTO_NOT_FOUND = "photo_not_found"
    INVITATION_NOT_FOUND = "invitation_not_found"
    ORG_NOT_FOUND = "org_not_found"

    # ─── validation / format ─────────────────────────────────
    INVALID_DEFECT_ID = "invalid_defect_id"
    INVALID_INSPECTION_ID = "invalid_inspection_id"
    INVALID_VEHICLE_ID = "invalid_vehicle_id"
    INVALID_WORK_ORDER_ID = "invalid_work_order_id"
    INVALID_PHOTO_ID = "invalid_photo_id"

    # ─── fleet + multi-tenant guards ─────────────────────────
    VEHICLE_NOT_IN_YOUR_FLEET = "vehicle_not_in_your_fleet"
    VEHICLE_BELONGS_TO_ANOTHER_DSP = "vehicle_belongs_to_another_dsp"

    # ─── inspection state machine ────────────────────────────
    INSPECTION_NOT_DRAFT = "inspection_not_draft"
    INSPECTION_VEHICLE_MISMATCH = "inspection_vehicle_mismatch"
    ONLY_INSPECTOR_OR_ORG_ADMIN_CAN_EDIT = "only_inspector_or_org_admin_can_edit"

    # ─── work order state machine ────────────────────────────
    WO_INVALID_TRANSITION = "wo_invalid_transition"

    # ─── defect conflicts ────────────────────────────────────
    DEFECT_DUPLICATE = "defect_duplicate"

    # ─── photos / uploads ────────────────────────────────────
    STORAGE_KEY_BAD_PREFIX = "storage_key_bad_prefix"

    # ─── invitations ─────────────────────────────────────────
    INVITATION_EXPIRED = "invitation_expired"
    INVITATION_ALREADY_USED = "invitation_already_used"
    INVITATION_CANCELED = "invitation_canceled"
    INVITATION_FORBIDDEN = "invitation_forbidden"

    # ─── catalog / template ──────────────────────────────────
    UNKNOWN_VEHICLE_CLASS = "unknown_vehicle_class"
    UNKNOWN_OWNERSHIP = "unknown_ownership"


# ─────────────────────────────────────────────────────────────
# Translation table — every code MUST have both en and es entries.
# Parameter placeholders use {name} (str.format) so callers pass kwargs.
# ─────────────────────────────────────────────────────────────
MESSAGES: dict[str, dict[str, str]] = {
    # auth
    E.MISSING_AUTH_HEADER: {
        "en": "missing authorization header",
        "es": "falta el encabezado de autorización",
    },
    E.INVALID_TOKEN: {
        "en": "invalid token",
        "es": "token inválido",
    },
    E.INVALID_TOKEN_SUBJECT: {
        "en": "invalid token subject",
        "es": "sujeto del token inválido",
    },
    E.USER_NOT_FOUND: {
        "en": "user not found",
        "es": "usuario no encontrado",
    },
    E.USER_STATUS: {
        "en": "user status is {status}",
        "es": "el estado del usuario es {status}",
    },
    E.USER_NO_LONGER_ACTIVE: {
        "en": "user no longer active",
        "es": "el usuario ya no está activo",
    },
    E.INVALID_CREDENTIALS: {
        "en": "invalid credentials",
        "es": "credenciales inválidas",
    },
    E.REQUIRES_ROLE: {
        "en": "requires role in {roles}",
        "es": "requiere un rol en {roles}",
    },
    E.DANGLING_ORG: {
        "en": "user has dangling organization_id",
        "es": "el usuario tiene una organización inexistente",
    },
    # ownership / not-found
    E.NOT_YOUR_DEFECT: {
        "en": "not your defect",
        "es": "este defecto no es tuyo",
    },
    E.NOT_YOUR_INSPECTION: {
        "en": "not your inspection",
        "es": "esta inspección no es tuya",
    },
    E.NOT_YOUR_DSP: {
        "en": "not your DSP",
        "es": "este DSP no es tuyo",
    },
    E.NOT_YOUR_VEHICLE: {
        "en": "not your vehicle",
        "es": "este vehículo no es tuyo",
    },
    E.NOT_YOUR_WORK_ORDER: {
        "en": "not your work order",
        "es": "esta orden de trabajo no es tuya",
    },
    E.DEFECT_NOT_FOUND: {
        "en": "defect not found",
        "es": "defecto no encontrado",
    },
    E.INSPECTION_NOT_FOUND: {
        "en": "inspection not found",
        "es": "inspección no encontrada",
    },
    E.VEHICLE_NOT_FOUND: {
        "en": "vehicle {id} not found",
        "es": "vehículo {id} no encontrado",
    },
    E.WORK_ORDER_NOT_FOUND: {
        "en": "work order not found",
        "es": "orden de trabajo no encontrada",
    },
    E.PHOTO_NOT_FOUND: {
        "en": "photo not found",
        "es": "foto no encontrada",
    },
    E.INVITATION_NOT_FOUND: {
        "en": "invitation not found",
        "es": "invitación no encontrada",
    },
    E.ORG_NOT_FOUND: {
        "en": "organization not found",
        "es": "organización no encontrada",
    },
    # validation
    E.INVALID_DEFECT_ID: {
        "en": "invalid defect id: {raw}. Use int or 'FD-XXX'.",
        "es": "id de defecto inválido: {raw}. Usa un entero o 'FD-XXX'.",
    },
    E.INVALID_INSPECTION_ID: {
        "en": "invalid inspection id: {raw}. Use int or 'INS-XXXXX'.",
        "es": "id de inspección inválido: {raw}. Usa un entero o 'INS-XXXXX'.",
    },
    E.INVALID_VEHICLE_ID: {
        "en": "invalid vehicle id: {raw}. Use int or 'VAN-XXXX'.",
        "es": "id de vehículo inválido: {raw}. Usa un entero o 'VAN-XXXX'.",
    },
    E.INVALID_WORK_ORDER_ID: {
        "en": "invalid work order id: {raw}. Use int or 'WO-XXXXX'.",
        "es": "id de orden de trabajo inválido: {raw}. Usa un entero o 'WO-XXXXX'.",
    },
    E.INVALID_PHOTO_ID: {
        "en": "invalid photo id",
        "es": "id de foto inválido",
    },
    # fleet guards
    E.VEHICLE_NOT_IN_YOUR_FLEET: {
        "en": "vehicle is not in your fleet",
        "es": "el vehículo no pertenece a tu flota",
    },
    E.VEHICLE_BELONGS_TO_ANOTHER_DSP: {
        "en": "vehicle belongs to another DSP",
        "es": "el vehículo pertenece a otro DSP",
    },
    # inspection state machine
    E.INSPECTION_NOT_DRAFT: {
        "en": "inspection is {status}; only DRAFT can be edited",
        "es": "la inspección está en {status}; solo el borrador (DRAFT) puede editarse",
    },
    E.INSPECTION_VEHICLE_MISMATCH: {
        "en": "inspection.vehicle_id does not match the supplied vehicle_id",
        "es": "el vehículo de la inspección no coincide con el vehículo proporcionado",
    },
    E.ONLY_INSPECTOR_OR_ORG_ADMIN_CAN_EDIT: {
        "en": "only the inspector or org admin can edit this draft",
        "es": "solo el inspector o el admin de la organización pueden editar este borrador",
    },
    # work order state machine
    E.WO_INVALID_TRANSITION: {
        "en": "invalid status transition: {from_status} → {to_status}",
        "es": "transición de estado inválida: {from_status} → {to_status}",
    },
    # defect conflicts
    E.DEFECT_DUPLICATE: {
        "en": (
            "this defect already exists for this vehicle, inspection, "
            "section, part, position and defect type"
        ),
        "es": (
            "este defecto ya existe para este vehículo, inspección, "
            "sección, parte, posición y tipo de defecto"
        ),
    },
    # photos
    E.STORAGE_KEY_BAD_PREFIX: {
        "en": "storage_key must start with {prefix}",
        "es": "storage_key debe empezar con {prefix}",
    },
    # invitations
    E.INVITATION_EXPIRED: {
        "en": "invitation has expired",
        "es": "la invitación ha expirado",
    },
    E.INVITATION_ALREADY_USED: {
        "en": "invitation has already been accepted",
        "es": "la invitación ya fue aceptada",
    },
    E.INVITATION_CANCELED: {
        "en": "invitation has been canceled",
        "es": "la invitación fue cancelada",
    },
    E.INVITATION_FORBIDDEN: {
        "en": "you cannot send this invitation",
        "es": "no puedes enviar esta invitación",
    },
    # catalog / template
    E.UNKNOWN_VEHICLE_CLASS: {
        "en": "unknown vehicle_class: {value}. Valid: {valid}",
        "es": "vehicle_class desconocido: {value}. Válidos: {valid}",
    },
    E.UNKNOWN_OWNERSHIP: {
        "en": "unknown ownership: {value}. Valid: {valid}",
        "es": "ownership desconocido: {value}. Válidos: {valid}",
    },
}


def tr_error(code: str, lang: str, **vars: object) -> str:
    """Look up a translated error message.

    Falls back to English if the language is unsupported or the code is
    missing in the target language. As a last resort returns the raw
    code — that surfaces the gap during dev without crashing.
    """
    bundle = MESSAGES.get(code)
    if not bundle:
        return code  # unregistered code — return it raw so it's visible
    template = bundle.get(lang) or bundle.get("en") or code
    if vars:
        try:
            return template.format(**vars)
        except (KeyError, IndexError):
            # Malformed call (missing var) — return the unformatted template
            # rather than crashing the request.
            return template
    return template


# ─────────────────────────────────────────────────────────────
# Reverse lookup — translate a raw English `detail` string at the
# response-handler stage. Used by `app.main` so routes that still raise
# `HTTPException(detail="english text")` automatically come out in the
# user's preferred language without per-route refactoring.
#
# Only NON-PARAMETERIZED messages are eligible: any template containing
# `{` is skipped to avoid false positives. Parameterized errors must be
# refactored to call `tr_error` at the raise site so the variables can
# be supplied.
# ─────────────────────────────────────────────────────────────
def _build_reverse_index() -> dict[str, dict[str, str]]:
    """Build {english_text → {lang: translated_text, ...}} index."""
    index: dict[str, dict[str, str]] = {}
    for code, bundle in MESSAGES.items():
        en = bundle.get("en")
        if not en or "{" in en:  # skip parameterized
            continue
        # Last-write-wins is fine; duplicates would mean conflicting codes
        # which is a registry bug we'd want to catch in code review.
        index[en] = dict(bundle)
    return index


_REVERSE_INDEX: dict[str, dict[str, str]] = _build_reverse_index()


def translate_known_detail(detail: str | None, lang: str) -> str | None:
    """Reverse-translate a raw English error detail to `lang`.

    Returns the original string unchanged if:
      - `detail` is not a known English message in our registry,
      - the requested `lang` has no entry for that message,
      - `lang` is "en" (no translation needed).

    Used by the FastAPI exception handler as a best-effort fallback for
    routes that haven't been migrated to call `tr_error` directly.
    """
    if not detail or lang == "en":
        return detail
    bundle = _REVERSE_INDEX.get(detail)
    if not bundle:
        return detail
    return bundle.get(lang, detail)
