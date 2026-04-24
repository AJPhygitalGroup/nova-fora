# Nova Fleet — Rebuild de nova4a.com

> **Para Claude Code que va a implementar este proyecto.**
> Lee este README en orden. Te da contexto en 2 minutos y te dice qué hacer.

---

## 🚨 Deadline crítico: Jun 15, 2026 — Global Test

El objetivo es tener la app en producción y lista para un test global en **52 días** desde hoy (24 Apr).
El sprint calendar completo está en **Sección 10** del plan MD.
No hay tiempo para perfeccionismo — hay tiempo para funcionar.

---

## Qué hay en esta carpeta

| Archivo / Carpeta | Para qué sirve |
|---|---|
| **`nova4a-rebuild-plan.md`** | El plan completo (2000+ líneas). Análisis + propuesta v2 + prompts + deploy + sprint calendar. |
| **`nova-fora-demo/`** | ⭐ **Frontend demo ya construido** — React 19 + Vite 8 + Tailwind 4. El backend se adapta a este frontend. |
| `Ribrell21_Inspections_2026-04-15.xlsx` | Output de ejemplo del scraping de la app actual — referencia de datos que deben ser exportables nativamente en v2. |
| `generate_ribrell_excel.py` | Script Python que generó el XLSX. Útil para entender el shape de datos. |

---

## Cómo usar el plan

### 1. Antes de empezar

Lee de forma obligatoria:

- **Sección 1** del MD — Resumen ejecutivo (los 3 actores: DSP, Vendor, FMC) — **2 min**
- **Sección 2.6** — Vistas por rol (lo que un humano observó haciendo el tour) — **10 min**
- **Sección 2.8.bis** — Schema real inferido por sondeo de API (tipos, endpoints, bugs) — **5 min**
- **Sección 3.2** — Modelo de dominio mejorado (fuente de verdad para Fase 1) — **10 min**
- **Sección 9** — Frontend demo existente + shapes de IDs + API client a crear — **5 min** ⭐ NUEVO
- **Sección 10** — Sprint calendar semana a semana hasta Jun 15 — **5 min** ⭐ NUEVO

Solo después salta a la fase que te toca.

### 2. Las fases están en la Sección 4

Cada fase tiene un bloque ` ``` ` con un prompt listo para ejecutar. Cópialo tal cual.

| Fase | Tema |
|---|---|
| 0 | Scaffolding monorepo (pnpm + docker-compose + CI) |
| 1 | Modelo de datos + Alembic migrations |
| 2.A | Auth core (login, magic link, TOTP, impersonation) |
| 2.B | Sign-up self-service (DSP + Vendor) |
| 2.C | Invitaciones por OrgAdmin |
| 3 | Flotas (orgs + vehículos) |
| 4 | Inspecciones (captura + lectura) |
| 5 | Work Orders (FSM + bulk + realtime) |
| 6 | Dashboards + reportería + export XLSX nativo |
| 7 | Admin + Cmd+K + dark mode + i18n + PWA |
| 8 | Deploy + observabilidad |

**Orden:** estricto. No saltes fases. Cada una asume que la anterior está verde.

**Granularidad:** un PR atómico por fase. NO mega-PRs.

---

## Reglas para ti (el agente que ejecuta)

1. **Lee la sección referenciada antes de cada fase.** El prompt asume que ya entiendes el dominio.
2. **No inventes entidades.** Si el modelo de dominio (Sección 3.2) no la tiene, pregunta al humano antes de crearla.
3. **Si encuentras una contradicción** entre Sección 2.2 (modelo inferido inicial) y Sección 2.6 / 2.8.bis (observación directa), **gana 2.6 / 2.8.bis** — esa data viene de la app real.
4. **No omitas tests.** Cada fase incluye criterios de "Tests" que son parte del Definition of Done.
5. **Si el prompt tiene `??` o `TODO`**, detente y pregunta antes de improvisar.
6. **Migration data legacy:** si construyes algo cuya BD vieja tiene el dato como tipo distinto (ej. `last_mileage` como string en nova4a, como int en v2), añade migración explícita en `apps/api/scripts/migrate_<entity>.py` y documenta el cast.
7. **IDs con prefijo string:** el frontend demo espera `VAN-XXXX`, `WO-54001`, `DSP-4201`, etc. El backend DEBE serializar en ese formato. Ver Sección 9.3. Si lo rompes, el frontend entero se cae.
8. **No refactorices el frontend demo** sin autorización del humano. El demo funciona. El riesgo de tocarlo es perder semanas. Solo agrega `src/api/client.js` y modifica los `useEffect` de carga de datos.

---

## Stack confirmado (ya decidido, no re-discutir)

### Backend
- **Runtime:** Python 3.12 + FastAPI + SQLModel + Alembic + uv (deps)
- **DB:** PostgreSQL 16
- **Cache:** Redis
- **Object storage:** S3 compatible (MinIO en dev, Hostinger Object Storage en prod)
- **Workers:** Arq (jobs async: emails, fotos, exports)
- **Auth:** JWT Bearer token (access + refresh). Magic link para invitaciones.

### Frontend ⭐ DEMO EXISTENTE — no reconstruir
- **App:** `nova-fora-demo/` — React 19 + Vite 8 + JSX (sin TypeScript pre-launch)
- **Estilos:** Tailwind CSS 4 + Framer Motion (ya en el demo)
- **Gráficas:** Recharts (ya en el demo)
- **API client:** crear `src/api/client.js` (fetch + JWT — ver Sección 9.5)
- **NO usar:** Next.js 15, shadcn, TanStack (post-launch upgrade opcional)

### Infra ⭐ ACTUALIZADO
- **VPS:** Hostinger KVM 4+ (Ubuntu 22.04, 4 vCPU / 8 GB RAM)
- **Panel:** EasyPanel (Docker-based, SSL automático, gestiona Postgres + Redis + Apps)
- **CI/CD:** GitHub Actions → SSH deploy al VPS
- **Observabilidad:** Sentry + PostHog + logs JSON a stdout

Detalle de setup en Sección 8 (Phase 8) y Sección 9 del MD.

---

## Sprint Calendar (resumen ejecutivo — detalle en Sección 10 del MD)

| Semana | Fechas | Foco | Checkpoint |
|---|---|---|---|
| 1 | Apr 24–30 | VPS + EasyPanel + Docker + DB live | `curl /health` → 200 en prod |
| 2 | May 1–7 | Auth (JWT) + Users + Organizations | Login real sin localStorage |
| 3 | May 8–14 | Vehicles + Inspections backend | Inspección completa via Postman |
| 4 | May 15–21 | Work Orders FSM + wiring WOs y Defects | Ciclo DSP→Vendor→Tech completo en prod |
| 5 | May 22–28 | Dashboard + XLSX export | DSP descarga Excel inspecciones |
| 6 | May 29–Jun 4 | Admin + Invitaciones + Notificaciones | Invite → onboard → inspección |
| 7 | Jun 5–11 | Hardening + testing + seguridad | p95 API < 500ms, zero 5xx |
| 8 | Jun 12–15 | Onboard piloto + fix bugs + LAUNCH | 🚀 Global Test |

**Si en alguna semana hay retraso de 2+ días → reportar inmediatamente al humano.**

---

## Lo que NO está cubierto en este plan (gaps documentados)

Antes de algunas fases, hay info que el humano debe conseguir. Pídela:

| Antes de Fase... | Pregunta al humano |
|---|---|
| **Fase 4** (inspecciones) | ¿Puedo ver el flujo real de creación de inspección en mobile? ¿OCR existe ya o se captura manual? ¿Geolocation se captura? |
| **Fase 5** (WOs) | ¿Hay routing automático de WOs o asignación manual? ¿Cómo es el flujo de subcontracting? |
| **Fase 7** (admin/RFP) | Acceso al dashboard `/rfp-dashboard` con cuenta RFPSender. Sample de Fleet Data spreadsheet de Amazon. |
| **Fase 8** (deploy) | Quién es el DSP/Vendor piloto? Big bang o coexistencia con nova4a actual? |

Si no tienes la data, **detente y reporta** al humano en vez de inventar.

---

## Bugs heredados que la v2 debe resolver desde día 1

Documentados en Sección 2.8.bis.13:

1. **`/api/metrics` expuesto sin auth** → en v2: detrás de auth + scope `metrics_read`.
2. **Sin CSP, sin HSTS** → en v2: middleware estricto.
3. **`notification.body` con HTML libre** → en v2: solo Markdown sanitizado, render server-side.
4. **`year`, `last_mileage`, `tier` como string** → en v2: ints / decimals.
5. **`scheduled` como boolean** (cuando debería ser datetime) → en v2: `scheduled_for: timestamptz`.
6. **`/api/jumbotron` sin `dsp_id` → 500** → en v2: 400 + mensaje claro.
7. **Sort sin DESC syntax** → en v2: `?sort=-created_at` estándar.
8. **Cache-Control: no-store en todo** → en v2: cachear lo cacheable con ETag.
9. **Marshmallow strict inconsistente** → en v2: Pydantic strict en todos los endpoints (schema-first con OpenAPI).
10. **Inconsistencia summary card vs lista** en `/work_orders` → en v2: ambos respetan el mismo filtro.

---

## Filosofía del rebuild

- **Mobile-first siempre.** Los inspectores y técnicos viven en el celular.
- **Self-service onboarding.** Cero "contáctanos para crear cuenta". Sign-up + invitaciones por magic link.
- **Export nativo en cada listado.** Nunca más scraping HTML para sacar un Excel.
- **Filtro por fecha global.** Default: hoy. Configurable.
- **Realtime en vez de polling.** Pusher / SSE, no F5.
- **Dark mode + i18n** desde el día 1 (no como feature de vanidad — los inspectores trabajan al amanecer y muchos hablan español).
- **Multi-tenancy estricta.** Un vendor nunca debe ver datos de otro vendor. La app actual filtra por API pero leak en summary cards — eso debe ser imposible por construcción.

---

## Si algo no calza con la realidad

El MD está construido por ingeniería inversa de nova4a (no por documentación oficial). Hay 3 niveles de certeza:

| Marca en el MD | Confianza | Acción si encuentras conflicto |
|---|---|---|
| Sección 2.6 (tour observado) | 95% | Probablemente correcto. Si dudas, valida con el humano. |
| Sección 2.8.bis (sondeo API) | 85% | Tipos exactos pueden diferir. Validar contra schema dump real si está disponible. |
| Sección 2.2 (modelo inicial inferido) | 60% | Superseded por 2.6 y 2.8.bis. No usar como fuente de verdad. |

---

## Flujo recomendado para cada sesión de Claude Code

```
1. Lee este README             (2 min)
2. Lee secciones obligatorias  (~30 min)
3. Lee la fase asignada        (5 min)
4. Pregunta al humano si hay gaps marcados  (variable)
5. Ejecuta el prompt de la fase
6. Tests verde + lint verde
7. Commit + PR atómico
8. Reporta resultado al humano antes de pasar a siguiente fase
```

Nunca avances a la siguiente fase sin sign-off del humano.

---

**Última actualización:** 2026-04-24 (deploy Hostinger+EasyPanel, frontend demo, sprint Jun 15 añadidos). Este README acompaña a `nova4a-rebuild-plan.md` v2.
