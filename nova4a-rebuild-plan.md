# Nova4a — Análisis y Plan de Reconstrucción

> Documento de trabajo para reconstruir **app.nova4a.com** con mejor UX y arquitectura moderna.
> Basado en ingeniería inversa de la app en producción (sesión del 2026-04-15).
> Audiencia: otra instancia de Claude Code que construirá la v2.

---

## 1. Resumen ejecutivo

**Nova4a** es una plataforma SaaS B2B que coordina **inspecciones diarias de flotas (DVIC / DVIR)** entre tres actores:

1. **DSPs** (Delivery Service Providers — ej. Ribrell 21, Ceiba Routes, TOTL): empresas de última milla tipo Amazon DSP que operan flotas de vans.
2. **FMCs** (Fleet Management Companies — ej. Wheels, Element): dueños financieros/arrendadores de los vehículos.
3. **Vendors** (Talleres mecánicos — ej. Dulles Midas): proveedores que ejecutan reparaciones.

**Flujo core:** conductor del DSP hace inspección pre-viaje → la app registra defectos + fotos + odómetro → se generan *work orders* → el vendor las acepta/rechaza → se completa el trabajo → el FMC/DSP aprueba → cierre.

**Problema principal observado:** la app funciona pero es técnicamente arcaica (HTMX + jQuery + Jinja + Selectize), con UX rígida, sin filtros por fecha, datos duplicados entre entidades, y terminología confusa. Hay fricción real en bulk operations y reportería.

---

## 2. Análisis del app actual

### 2.1 Stack detectado

**Backend (inferido):**
- Python (Flask o similar) con Jinja2 para server-side rendering.
- ORM relacional (probablemente SQLAlchemy + PostgreSQL) — ver formato UUIDs `xxxx-xxxx-11f1-xxxx-xxxx` = UUIDv1.
- CSRF token embebido en cada página (`_csrf_token`).
- Auth por cookie de sesión.
- Endpoints REST-ish (no REST puro — mezcla `GET /api/work_order?id=X` con `GET /api/inspection?id=X`).
- 404 devuelve `<!doctype html><title>404 Not Found>` — estilo Werkzeug/Flask por defecto.
- Storage de fotos en `/api/file-upload/{uuid}_sep_{filename}` — probablemente S3 con proxy.

**Frontend:**
- **HTMX 2.0.4** para navegación parcial (16 bindings típicos por página).
- **jQuery 3.5.1** + **jQuery UI**.
- **Bootstrap 5.2.3** con tema custom (`nova-theme-bs5.css`).
- **Selectize.js 0.13.3** para dropdowns buscables.
- **Moment.js 2.29.4** (deprecated, inflated bundle).
- **Nunjucks** client-side para templates (además de Jinja server-side — redundante).
- **Font Awesome Kit** vía CDN.
- **jQuery File Upload** para cargar fotos.

**Señales de deuda técnica:**
- Mezcla de render server (Jinja) y client (Nunjucks) para el mismo tipo de contenido.
- Moment.js (400kb) cuando `Intl.DateTimeFormat` o `date-fns` serviría.
- Selectize.js sin mantenimiento activo.
- Sin build step visible — assets servidos directamente desde `/static/`.

### 2.2 Modelo de dominio

Extraído de las respuestas de la API:

```
Organization
├── id, name, phone, address
├── is_vendor: bool        # true = taller, false = DSP/FMC/otro
├── default_pm_vendor: Organization?  # vendor preferido para preventivo
├── default_lot_location
├── score, overall, timeliness, quality  # métricas agregadas
├── alert_nonmandatory_jobs: bool
├── could_not_inspect_sms_opted_in: bool
└── sms_phone

User
├── id, full_name, email, language
├── organization_id → Organization
├── accepted_terms, require_password_reset
└── roles (booleanos múltiples, un usuario puede tener varios):
    ├── is_site_admin      # superadmin
    ├── is_org_admin       # admin dentro de su org
    ├── is_fleet_owner     # dueño de flota (DSP/FMC)
    ├── is_fleet_manager   # vendor que gestiona múltiples flotas
    ├── is_vendor          # taller
    ├── is_technician      # mecánico individual
    ├── is_subcontract_assigner
    └── is_ghoster         # puede "suplantar" otros usuarios

Vehicle
├── id, vin, make, model, year, color
├── license_plate, fleet_id (str — identificador interno del DSP, ej. "PR006")
├── hash (3 chars — quick-ref pin?)
├── vehicle_class_id → VehicleClass
├── vehicle_class: {id, name}      # "Branded Cargo", "Rental", etc.
├── fmc: {id, name}                # "Wheels", "Element", "Rented/Owned"
└── is_fmc_managed: bool

VehicleInspection
├── id, created_at
├── vehicle_id → Vehicle
├── photos: Photo[]         # fotos de odómetro / daños / etc.
├── reported_defects: ReportedDefect[]
└── inspection_incomplete_reason: str?

ReportedDefect
├── id, created_at
├── inspection_defect_id → InspectionDefect (catálogo)
├── description, tier ("1" | "2" | "3")
├── inspection_section: {name, rank}   # "1. Front Side", "3. Back Side", etc.
├── ground_vehicle: bool     # ¿sacar de ruta?
├── acknowledged, work_approved, work_completed, work_accepted
├── work_orders_canceled
├── vehicle_inspection_id → VehicleInspection
├── work_order_vendor_id → Organization?
├── rejected_reason (enum string)
├── notes
├── photos: Photo[]
└── work_orders: WorkOrder[]

WorkOrder
├── id, created_at, completed_at
├── ro_number                # número interno del vendor
├── vehicle → Vehicle
├── reported_defect → ReportedDefect
├── vendor_id → Organization (vendor)
├── dsp → Organization (DSP)      # ⚠ relación derivada del vehículo
├── nova_user → User (quien creó)
├── status: "Pending FMC" | "Declined" | "Completed" | "In-progress" | ...
├── completed_notes
├── photos: Photo[]
├── original_work_order, subcontracted_work_order   # árbol de sub-contratación
├── is_rush_order: bool
├── last_mileage: int         # ⚠ capturado acá, NO en la inspección (bug de diseño)
├── scheduled: datetime?
├── assigned_technician → User?
├── is_stale: bool
└── canceled_reason: str?

InspectionDefect (catálogo)
├── id, description
└── inspection_section

Photo
├── id, filename, unique_filename
└── src (/api/file-upload/...)

VehicleClass (catálogo: Branded Cargo, Rental, etc.)
FMC (Fleet Management Company: Wheels, Element, Rented/Owned, etc.)
```

**⚠ Red flags de modelado:**
1. **`last_mileage` en `WorkOrder` y no en `VehicleInspection`** — el odómetro se fotografía durante la inspección pero solo se digitaliza cuando se crea un WO, lo que produce:
   - Inspecciones sin mileage (si el defecto nunca se acciona).
   - Duplicación: N WOs de una misma inspección llevan el mismo `last_mileage` replicado.
2. **Roles como booleanos múltiples** en la tabla `User` — debería ser `role_assignments` con una tabla de unión.
3. **`work_orders` anidado dentro de `reported_defect`** que a su vez vive en `vehicle_inspection` — profundidad de 4 niveles en una sola respuesta, payloads de 20KB+.
4. **`dsp` se deriva** del vehículo pero aparece explícito en WO — fuente de drift si un vehículo cambia de DSP.
5. **Filter-by usa strings mágicos** (`pending`, `declined`, `completed`) y rechaza cualquier otro con 400 — no hay enum documentado.

### 2.3 Estructura de navegación (páginas detectadas)

| Ruta | Propósito | Rol típico |
|---|---|---|
| `/login` | Sign in | Todos |
| `/` | Landing según rol | Todos |
| `/real_dvic` | Dashboard de inspecciones del día (cards) | Vendor, Fleet Manager |
| `/my-vehicles` | Vehículos del DSP (vista dueño) | Fleet Owner |
| `/vendor-fleet` | DSPs + vehículos servidos (tabla) | Vendor |
| `/dsp-dashboard` | Fleet Snapshot (estado agregado por vehículo) | Fleet Owner, Fleet Manager |
| `/work_orders` | Tablero de work orders con filtros | Vendor, Technician |
| `/rfp-dashboard` | Propuestas enviadas (bidding?) | Vendor |
| `/admin/user` | Gestión de usuarios de la org | Org Admin |
| `/admin/security` | Credenciales / 2FA | Org Admin |
| `/admin/org` | Datos de la organización | Org Admin |
| `/admin/ghost` | Suplantar usuarios | Site Admin / Ghoster |
| `/admin/real-dvic` | Admin de inspecciones (global) | Site Admin |
| `/logout` | Sign out | Todos |

### 2.4 Endpoints API identificados

Todos bajo `/api/`, auth por cookie, responses JSON (a menos que se indique):

```
GET  /api/jumbotron?dsp_id={n}&include_custom_defects={bool}&include_body_defects={bool}
     → [{ id, fleet_id, reported_defect_count, inspection_completed }]
     (Vehículos de un DSP con su latest inspection status — no incluye fecha)

GET  /api/get-vehicles-for-organization?org_id={n}&page={n}&per_page={n}
     → { vehicles: [Vehicle] }
     (Paginado, 10 por defecto)

GET  /api/get-organizations-for-fleet-manager
     → { organizations: [Organization] }
     (DSPs que este fleet manager puede ver)

GET  /api/inspection?id={n}
     → { inspection: { id, created_at, vehicle, reported_defects[], photos[], inspection_incomplete_reason } }

GET  /api/work_order?id={n}
     → { work_order: WorkOrder }
     # o sin id — lista paginada:
GET  /api/work_order?page={n}&filter_by={status|""}
     → { work_orders: [...], pages: n, more: bool }

GET  /api/key-count?organization_id={n}
     → { key_count: n }   (inventario de llaves del vendor)

GET  /api/user/notif_pages?unread=true
     → { notifications: [...] }

GET  /api/file-upload/{uuid}_sep_{filename}
     → bytes de imagen (probablemente proxied desde S3)

POST /api/file-upload                  (inferido de jQuery.FileUpload)
POST /api/work_order                   (crear WO)
POST /api/work_order/{id}/confirm      (con last_mileage, rejection_reason, imagen)
```

**Faltantes obvios (huecos):**
- Sin `GET /api/inspections?date={}&dsp_id={}` — no hay forma de listar inspecciones filtrando por fecha.
- Sin bulk export (CSV/Excel).
- Sin WebSockets / SSE — todo es polling HTMX.
- Sin search general.

### 2.5 Problemas observados (UX + DX)

**UX (usuario final):**
1. **Navegación por DSP rota en combobox vacío** — Selectize carga perezosamente; el usuario ve un input vacío y tiene que adivinar que hay que hacer click.
2. **Cards de inspección con carruseles de 20-30 fotos** sin distinguir cuál es odómetro, cuál daño, cuál plate. No hay thumbnails ni labels.
3. **"Filter Inspections: All"** sin opciones reales; el filtro no filtra por fecha, que es el eje más obvio.
4. **"Last reported mileage" a veces está vacío** porque solo se popula al crear WO — el dueño del vehículo no ve el mileage de hoy hasta que un tech procese los defectos.
5. **Terminología inconsistente:** DVIC vs DVIR vs "Real DVIC" vs "inspection" vs "reported defect" vs "work order" — nadie sabe qué es qué hasta que lleva semanas.
6. **Sin responsive real:** la tabla de vehículos se sale en móvil; el dashboard tampoco se apila.
7. **Sin dark mode.**
8. **Notificaciones:** contador "6048" de notifs no leídas (sesión de prueba) — no hay bulk-dismiss.
9. **No hay export nativo** — para sacar datos hay que scrapear la UI (literalmente lo que estamos haciendo).
10. **Login simple con password** — sin SSO, 2FA opcional no obvio.

**DX (mantenibilidad):**
1. Dos motores de template (Jinja + Nunjucks) renderizando lo mismo en diferentes capas.
2. HTMX + jQuery + Bootstrap JS + Nunjucks = 4 formas distintas de hacer lo mismo.
3. Sin tipos (TypeScript) en front; sin schemas explícitos (Pydantic/marshmallow) visible en API.
4. Rutas con convenciones mezcladas: `/real_dvic` (snake) vs `/work-orders` (kebab, no existe) vs `/dsp-dashboard` (kebab) vs `/vendor-fleet` (kebab) vs `/my-vehicles` (kebab).
5. API endpoints no siguen REST: `/api/inspection?id=X` en vez de `/api/inspections/:id`.
6. Errors 500 en endpoints legítimos (`/api/jumbotron/details`) — sugiere handlers incompletos.

### 2.6 Vistas por rol — observación directa

Tour en vivo con tres cuentas. Esto corrige y amplía el modelo de dominio.

#### 2.6.1 Rol: **DSP / Fleet Owner** (cuenta Tamika Gambrell — Ribrell 21, roles: `org_admin + fleet_owner`)

**Contexto de negocio nuevo:** los DSPs son **Amazon Last-Mile DSPs** (Delivery Service Partners de Amazon). Esto explica:
- El bulk upload de vehículos se sincroniza con el **portal de Amazon Logistics** (el DSP descarga su "Fleet Data spreadsheet" de Amazon y lo sube a Nova). Warning: "Any fleet vehicles not listed in your sheet will be deactivated!" — sync destructivo.
- El servicio **"Flex Fleet"** (alquiler de vans temporales) se activa para picos como Prime Day / holidays.

**Sidebar DSP:** solo 3 ítems — Real DVIC, My Vehicles, Administration. NO ve Work Orders, Vendor Fleet, ni Submitted Proposals.

**Home (`/`) para DSP = Fleet Snapshot embebido.** Diferente al de vendor:
- Header: "N keys recorded on {date}, {hour}" + link "N vehicles"
- Toggles: "Include Custom Defects", "Include Body Defects"
- Botón "Flex Fleet" → modal Order Flex Fleet (Start Date / End Date / Number of Vans)
- **Heatmap grid** de tiles coloreados por severidad: rojo oscuro (muchos defectos) → rosado → gris (limpio). Uno por vehículo. Muy impactante visualmente.
- Click en tile abre panel lateral **"Vehicle Report Card"**:
  - Vehicle Fleet ID + Most Recent Inspection date + badge "N Current Defects"
  - Carrusel de fotos
  - Tabla de defectos **acumulados** (no solo la última inspección — se cierran cuando el WO se completa), agrupada por sección
  - Cada fila tiene 2-3 botones de acción:
    - ✓ tooltip: **"Acknowledge defect"** (ver pero no accionar)
    - → tooltip: **"Send job to preferred vendor"** (crea el WO)
    - 🔧 tooltip: "Ground Vehicle" (sacar de ruta por seguridad — acción de primera clase)

**`/my-vehicles`:**
- Tabla simple: Fleet ID + Year/Make/Model + Edit (✏️/🗑)
- "Bulk Upload Vehicles" (Amazon sync)
- "Add New Vehicle" (modal con Fleet ID, Year, Make, Model, Color, VIN, License Plate, Vehicle Class, FMC)
- **"Edit Vehicle" con UX paupérrima:** cada campo está disabled con un lápiz propio. Hay que clicar el lápiz de CADA campo para habilitarlo. Anti-patrón mayor.

**`/admin/user`:** email + language toggle (English/Spanish).
**`/admin/security`:** solo "New Password". SIN 2FA, SIN complexity rules.
**`/admin/org`:** expandido respecto a lo que creía:
- Business: Phone, SMS phone, Business address, Default lot location
- Checkbox **"Inspection Impossible SMS"** — notif cuando inspector no puede completar (vehículo no encontrado / en ruta / etc.). Esto implica un **estado adicional** en inspection.
- **Preventive Maintenance automation (no estaba en mi modelo):**
  - Alert on Non-mandatory PM Work / Alert on Schedule Now jobs
  - **Default PM Vendor** (dropdown, ej. Dulles Midas)
  - **Secondary PM Vendor** (backup)
  - **PM Mileage Trigger** (500 Miles / 100 Miles) — auto-dispara RFP cuando vehículo cruza umbral
  - **PM Report Frequency** (Once weekly Monday / Twice weekly Mondays+Thursdays)
- Users table muestra roles — descubierto un rol nuevo: **`RFPSender`** (puede disparar Request For Proposals pero no administrar)

**`/admin/real-dvic`:** builder de **defectos custom** — el DSP extiende el catálogo estándar. Secciones del catálogo:
- **Cargo vehicles**: 1. Front Side, 2. Back Side, 3. Driver Side, 4. Passenger Side, 5. In Cab
- **Step vehicles**: (catálogo separado — step vans tienen secciones distintas)

**Toolbox flotante (ícono morado):** para DSP **1 tab** — "Create Work Order" manual (vehicle / section / part / defect / Submit). Útil cuando un driver reporta algo por teléfono sin pasar por inspección formal.

**Campana (notifications):** "No Notifications" para el DSP típico — recibe pocas.

#### 2.6.2 Rol: **Vendor / Fleet Manager / Técnico** (cuenta Olger Joya — Dulles Midas, roles: `org_admin + vendor + fleet_manager + technician`, `language: es-ES`)

**Confirmación de i18n:** la UI se tradujo a español porque el user tiene `language: es-ES`. Todas las labels del sidebar, tabs, badges se traducen (algunas cadenas sueltas como `"Choose a DSP..."` se quedaron en inglés — i18n incompleto).

**Sidebar vendor (traducido al español):** Real DVIC, **Resumen de flota** (= Fleet Snapshot), **Vehículos DSP** (= DSP Vehicles), **Órdenes de trabajo** (= Work Orders), **Administración**.

**`/work_orders`** es el hub central del vendor/técnico. Estructura completa:

- **Card superior "Resumen de órdenes de trabajo Wednesday, Apr 15th":**
  - Total de órdenes de trabajo: 26 (week-to-date)
  - Tasa de finalización diaria / semanal (1.0%)
  - Grid: Pendiente 8 / En progreso 0 / Rechazada 18 / Completada 0

- **Dos tabs de búsqueda:**
  - **"Buscar y Filtrar"** con selectize multi-select `filter_by`. Opciones reveladas vía DOM:
    ```
    all            → Todas
    pending        → Pendiente
    pending_fmc    → Pendiente FMC     ← estado nuevo no identificado antes
    in_progress    → En progreso
    completed      → Completada
    canceled       → Cancelada          ← estado nuevo
    declined       → Rechazada
    dsp_37         → Total Package Delivery
    dsp_13         → DESTIN LOGISTICS LLC
    dsp_9          → Robertson Logistics LLC
    dsp_11         → TJIII Logistics
    dsp_15         → PLADcloud, LLC
    dsp_24         → REJ Enterprises
    dsp_52         → Ribrell 21
    dsp_50         → AGILE LOGISTICS MANAGEMENT
    dsp_38         → Silkway Express
    dsp_2          → Ceiba Routes
    dsp_46         → People Now-DBA5    ← DSPs nuevos
    dsp_44         → People Now         ← DSPs nuevos
    ```
    Campo extra: "Ingresa el ID de flota para filtrar por vehículo" (text).
  - **"Seleccionar"** tab con un DSP dropdown — probablemente para bulk-select WOs por DSP.

- **Cards de WO** (uno por cada defecto que generó trabajo):
  - Header: `{DSP.name} - {fleet_id} | {license_plate}` + fecha + kebab (⋮)
  - Body: sección del defecto (ej. "6. In-Cab"), descripción del defecto ("heater not wokring"[sic])
  - Status badges: combinación de `Declined` | `Pending` | `Completed` | `Stale` | `Rush Order` | `Canceled`. **Los badges son componibles** (ej. "Declined + Stale + Rush Order" simultáneamente).
  - RO Number (N/A si no se ha asignado), DSP, Fleet Management Company, VIN, **Last reported mileage**, Description, Year/Make/Model, Reported by, Assigned Technician.
  - Kebab menu (⋮): opción "Work Order Notes" (agregar notas libres al WO).

**Flujo de máquina de estados (inferido del modelo + observación):**
```
[Defecto reportado]
        │
        ▼
    Pending ────► In_progress ────► Completed ────► (DSP approve) ────► cerrado
        │              │                 │
        ▼              ▼                 ▼
    Declined      Canceled          Declined
                                    (by FMC)
        │
        ▼
  [Si no se acciona en X días]
        │
        ▼
     Stale (flag, no estado)
```

Además **`Pending FMC`** es un sub-estado: el WO está esperando aprobación del Fleet Management Company (Wheels/Element) antes de proceder — son los que financian la reparación.

**Acciones observadas por el técnico** (validado en sesión de David Torres, ver 2.6.3):
- El **dispatcher (org_admin)** acepta el WO con reason_code y lo asigna → status pasa directo a `In_progress`.
- El **técnico** sobre WOs `In_progress` ve 2 botones:
  - **Release** → diálogo simple "Are you sure...?", devuelve al tech manager (sin reason).
  - **Complete** → diálogo "Complete Work" con: Comments + Last mileage + Capture Image + Confirm. Acá se captura el odómetro definitivo.
- Para **declinar formalmente** (con reason_code 1-4) hace falta `org_admin` (dialog "Confirm Action" con dropdown de reason).
- Para **subcontratar** a otro vendor (campo `subcontracted_work_order`) probablemente requiere `subcontract_assigner`.
- Reason codes (catálogo del backend):
  1. Lacking required parts or tools
  2. Work is outside the scope of contract
  3. Work was already completed or defect is not present
  4. Work is declined by the customer

**`/admin/org` para vendor** (difiere del DSP):
- Mismos campos de business (phone, address...)
- **Nueva sección "Servicios ofrecidos"** (checkboxes): Electrical, Upholstery, Mechanical, Parts, Cleaning/Detailing, Windshield, Body, PM. Esto es el **catálogo de capabilities** del taller — los DSPs eligen vendor según servicios ofrecidos.
- Form "Agregar un usuario a mi organización" (email + nombre) para invitar mecánicos.

**Notificaciones vendor:** 6360 no leídas — alto volumen. Cada cambio de estado de cada WO genera una notif. Sin bulk-dismiss.

**Toolbox flotante para vendor:** **2 tabs** — "Report a Defect" (si el tech encuentra algo que no estaba en la inspección) y "Log a Job" (registrar trabajo no vinculado a un WO).

#### 2.6.3 Rol: **Técnico (sin org_admin)** — observado directamente

Cuenta David Torres (`calerofredy.20@gmail.com`, user_id 68, org Dulles Midas) con roles: `vendor + fleet_manager + technician`, **sin** `org_admin`. NO es técnico puro pero sí es el caso "técnico de planta" que importa para el modelo.

**Sidebar (3 ítems vs 5 de Olger):**
- Real DVIC
- Work Orders
- Administration → submenu solo: **User**, **Security** (sin Organization, sin Real DVIC admin)

**Matriz de acceso real (probada vía fetch directa):**
| Ruta | Status | Notas |
|---|---|---|
| `/` (= /real_dvic) | 200 | Mismas inspection cards que Olger ve |
| `/real_dvic` | 200 | ídem |
| `/work_orders` | 200 | Cards filtradas (ver abajo) |
| `/admin/user` | 200 | OK |
| `/admin/security` | 200 | OK |
| `/dsp-dashboard` | **200** | ⚠ Accesible pero NO está en sidebar — **inconsistencia** |
| `/vendor-fleet` | 403 | Bloqueado |
| `/my-vehicles` | 403 | Bloqueado (es ruta de DSP) |
| `/admin/org` | 403 | Requiere org_admin |
| `/admin/real-dvic` | 403 | ídem |
| `/admin/ghost` | 403 | Solo site_admin |
| `/rfp-dashboard` | **404** | No existe para vendors (solo namespace DSP) |

**`/api/work_order` SÍ está filtrada por técnico** (validado):
- Para David: 27 pages × 10 = ~270 WOs históricas, todas con `assigned_technician.full_name = "David Torres"`.
- Por estado:
  - `pending`: 0 pages — el técnico nunca recibe Pending; el dispatcher acepta primero y luego asigna
  - `pending_fmc`: 0
  - `in_progress`: 2 pages (~20)
  - `completed`: 25 pages (~250) ← bulk del histórico
  - `declined`: 0 — el técnico no declina formalmente (ver abajo)
  - `canceled`: 0

**⚠ Inconsistencia visible:** el card "Work Order Summary Wednesday, Apr 15th" del top de `/work_orders` muestra "Total 26, Pendiente 8, Rechazada 18" — esos son **org-level week-to-date**, pero la lista de cards debajo es **personal**. El usuario no tiene forma de entender la discrepancia. Bug de UX.

**Acciones del técnico en una WO `In progress`** (capturadas en pantalla):
Cards en estado "In progress" muestran 2 botones en el footer:

1. **🔴 Release** — abre diálogo "Release Work":
   > "Are you sure you want to release this work order back to the tech manager?"
   - Solo Cancel / Confirm. **Sin reason code**, sin notes.
   - El técnico devuelve el WO al dispatcher (org_admin) que decide si reasignar o declinar formalmente con código.

2. **⚪ Complete** — abre diálogo "Complete Work":
   - Campo **Comments** (textarea, label "Work completed comments")
   - Campo **Last mileage** (input numérico, requerido)
   - Botón **Capture Image** (cámara) — para foto de odómetro
   - Cancel / Confirm
   - **Acá es donde se captura el `last_mileage` que termina en BD.** Cada WO completado tiene su propio mileage capturado en el momento del Complete; por eso WOs distintos del mismo vehículo tienen valores distintos según cuándo se completaron.

**Toolbox para técnico (sin org_admin): 1 sola tab — "Log a Job":**
- "Use this form to record miscellanious jobs completed throughout the day"
- Select a DSP / Select a vehicle / Notes / Submit
- **NO tiene "Report a Defect"** (Olger sí — requiere org_admin o un permiso superior).

**Notificaciones:** 4251 — alto volumen, similar a otros vendors. Sin agrupación ni bulk-dismiss.

**Idioma:** `language: null` → fallback a inglés. Confirma que la traducción es por usuario, no por org.

#### 2.6.3.1 Conclusión sobre permisos por rol

La app **sí filtra por rol pero de forma inconsistente**:
- ✅ `/api/work_order` filtra por `assigned_technician_id` cuando el user no es org_admin → bien.
- ❌ Sidebar oculta rutas que el usuario PUEDE acceder vía URL directa (`/dsp-dashboard`) → **information disclosure menor**.
- ❌ Summary card top muestra contadores org-level que el técnico no debería ver si el resto está filtrado → **leak en métricas**.
- ❌ Sin auditoría visible de quién accedió a qué (importante para vendor multi-DSP).

Estos puntos van directo al backlog de la v2 como **fixes de seguridad/coherencia que la nueva implementación debe resolver desde el día 1.**

#### 2.6.3.2 Pendiente: técnico **puro** (solo `is_technician=true`)

David tiene 3 roles. Un técnico "purísimo" (solo `is_technician`, sin `vendor` ni `fleet_manager`) probablemente:
- No vea `/dsp-dashboard` (requiere `fleet_manager` o `vendor`).
- Solo vea `/work_orders` con sus WOs asignadas, sin sidebar adicional.
- No tenga toolbox (o solo "Log a Job" como David).

**Acción para confirmar:** crear cuenta de prueba con un solo rol y reproducir matriz. La arquitectura v2 debe **derivar la sidebar de los roles, no hardcodearla por user "tipo"**.

#### 2.6.4 Resumen de la matriz de permisos observada

| Ruta | Site Admin | Org Admin (DSP) | Fleet Owner (DSP) | RFPSender (DSP) | Org Admin (Vendor) | Fleet Manager (Vendor) | Technician puro (Vendor) |
|---|---|---|---|---|---|---|---|
| `/` (home) | ? | Fleet Snapshot | Fleet Snapshot | ? | Real DVIC (vendor) | Real DVIC | Real DVIC (solo assigned) |
| `/my-vehicles` | ✅ | ✅ | ✅ | ? | ❌ | ❌ | ❌ |
| `/vendor-fleet` | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❓ |
| `/dsp-dashboard` (Fleet Snapshot) | ✅ | ✅* | ✅* | ❓ | ✅ | ✅ | ❓ |
| `/real_dvic` | ✅ | ❌ (redirect) | ❌ | ❌ | ✅ | ✅ | ✅ (solo assigned) |
| `/work_orders` | ✅ | ❌ | ❌ | ❓ | ✅ (todas) | ✅ (todas) | ✅ (filtrado por assigned_technician_id) |
| `/rfp-dashboard` | ✅ | ❌ | ❌ | ✅ | ✅ | ? | ❌ |
| `/admin/user` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/admin/security` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/admin/org` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/admin/ghost` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/admin/real-dvic` | ✅ | ✅ | ❓ | ❌ | ❓ | ❓ | ❌ |

`*` = para DSP, el Fleet Snapshot está embebido en `/` (home), no en ruta separada. Para vendor sí es `/dsp-dashboard`.

❓ = no verificado en esta sesión; documentar al obtener acceso.

### 2.7 Hallazgos de negocio descubiertos en el tour (refinan la propuesta)

1. **Amazon DSP como contexto:** el producto vive en el ecosistema Amazon Last-Mile. Bulk upload de flota depende del spreadsheet que Amazon da. La v2 debe:
   - Soportar import desde spreadsheet de Amazon con mapping configurable.
   - Detectar delta antes de desactivar (no borrado destructivo silencioso).
   - Considerar OAuth/API directa con Amazon Logistics en fase 2.
2. **Preventive Maintenance (PM) automation** es un módulo de primera clase, no una feature colateral:
   - Tabla `MaintenancePolicy` con trigger_type (mileage_delta / time_delta / calendar_date).
   - `PMJob` generado automáticamente cuando se cumple trigger → crea RFP → vendor responde → se convierte en WO.
3. **RFP (Request For Proposal) = módulo separado:** cotización competitiva entre vendors. La v2 lo puede dejar para fase 2 pero el modelo debe reservar su espacio:
   ```
   RFP
   ├── id, created_at, expires_at
   ├── dsp_org_id, vehicle_id, reported_defect_id?, work_scope (jsonb)
   ├── status (open / awarded / expired / canceled)
   ├── awarded_work_order_id?
   └── proposals: RFPProposal[]

   RFPProposal
   ├── id, rfp_id, vendor_org_id, submitted_by_user_id (RFPSender)
   ├── amount, eta, notes, status (submitted / withdrawn / awarded / rejected)
   └── created_at, updated_at
   ```
4. **Flex Fleet** es otro módulo que la v2 puede incorporar después:
   ```
   FlexFleetRequest
   ├── dsp_org_id, start_date, end_date, van_count
   ├── status (requested / confirmed / delivered / returned)
   └── fulfillment_vendor_id?
   ```
5. **Services Offered (vendor capability):** checkboxes Electrical / Upholstery / Mechanical / Parts / Cleaning-Detailing / Windshield / Body / PM. La v2 debe:
   - Modelar como `Service` catalog + `VendorService` (many-to-many).
   - Usar en el matching DSP ↔ vendor automático ("Send job to preferred vendor" debe validar que el vendor ofrece el servicio requerido).
6. **Defectos custom por DSP:** extensibilidad del catálogo. La v2:
   - `InspectionDefectCatalog` tiene campo `organization_id` nullable. Null = global, no-null = custom del DSP.
   - UI muestra globales + custom del DSP.
7. **Templates por vehicle class (Cargo vs Step):** la v2 debe modelar:
   ```
   InspectionTemplate
   ├── id, name, vehicle_class_id
   └── sections: InspectionSection[]

   InspectionSection
   ├── template_id, name, rank
   └── parts: InspectionPart[]

   InspectionPart
   ├── section_id, name
   └── defects: InspectionDefectCatalog[]
   ```
8. **"Ground Vehicle"** es una acción de primera clase con semántica de seguridad. Modelo:
   ```
   Vehicle.grounded_at: datetime?
   Vehicle.grounded_by_user_id: int?
   Vehicle.grounded_reason: text
   Vehicle.ungrounded_at: datetime?
   ```
   Cuando está grounded, la flota del DSP lo muestra con banner rojo y Amazon debería excluirlo del ruteo del día (sync inversa).
9. **"Inspection Impossible"** es un resultado legítimo de la inspección (no un error):
   ```
   InspectionIncompleteReason enum:
     VEHICLE_NOT_FOUND, VEHICLE_IN_ROUTE,
     KEYS_MISSING, ACCESS_DENIED,
     OTHER
   ```
   Dispara un SMS al DSP si tiene el opt-in activo.
10. **Estados de WO más ricos** que lo que tenía:
    ```
    WorkOrderStatus enum:
      PENDING                 # esperando al vendor
      PENDING_FMC             # vendor aceptó, esperando aprobación de FMC (Wheels/Element)
      ACCEPTED                # FMC aprobó
      IN_PROGRESS             # trabajo activo
      COMPLETED               # vendor marca completo
      APPROVED                # DSP aprueba / cierra
      DECLINED                # vendor rechaza (con reason_code 1-4)
      DECLINED_BY_FLEET       # DSP rechaza el completado
      CANCELED                # cancelado antes de empezar
      STALE                   # flag paralelo: sin actividad en N días
    ```
    El badge `STALE` es **flag** no estado (puede combinarse con Declined/Pending/etc.).
11. **"Key Count" inventory** — endpoint `/api/key-count?organization_id=X` y menciones en UI ("8 keys recorded on Apr 15th, 3:10am"). El vendor lleva inventario de las llaves físicas que tiene de las flotas. Modelar:
    ```
    KeyCount
    ├── vendor_org_id, dsp_org_id
    ├── count, recorded_at, recorded_by_user_id
    └── notes
    ```
12. **Roles adicionales:**
    - `RFPSender` — empleado del DSP que dispara cotizaciones (subset de OrgAdmin sin el resto de permisos).
    - Normalizar como enum `UserRole` con 10 valores (lo tenía con 8).

### 2.8 Gap crítico observado: **Sign-up / Onboarding ausente o muy pobre**

En `/login` existe un link "**Don't have an account? Sign up!**" pero el flujo real **no fue explorado a profundidad** y por lo que se ve en la app actual:

- No hay un onboarding diferenciado por **tipo de organización** (DSP vs Vendor vs FMC). Cada tipo tiene flujos de negocio, datos requeridos y permisos distintos — un signup genérico no funciona.
- No hay invitación trazable de un OrgAdmin existente a nuevos miembros (en `/admin/org` vimos un form "Add a User" simple sin email magic link visible).
- No hay verificación de email visible.
- No hay términos de uso firmados durante signup (vi un dialog "Terms of Use" en el HTML pero parece dispararse después del primer login, no al crear cuenta).
- No hay paso de **discovery / matching** entre DSPs y Vendors — un DSP nuevo no sabe qué vendors operan en su área, y un vendor nuevo no se anuncia a DSPs.
- No hay onboarding guiado para que un DSP suba su flota inicial (el upload es destructivo, peligroso para un usuario nuevo que no entiende el warning).

**La v2 debe tratar el signup como producto, no como formulario.** Cubrir 2 flujos distintos:

#### Flujo A — Sign-up de DSP (Amazon DSP / FMC)
1. Captura: nombre legal, DBA, organización_external_ref (Amazon DSP code si lo tienen), email del owner, phone, address.
2. Verificación de email (link mágico).
3. Verificación de DSP code contra Amazon (fase 2; al inicio campo libre).
4. Acepta Terms of Use + Privacy Policy explícitamente.
5. Setup wizard:
   - Sube primer Fleet Data spreadsheet (con preview no-destructivo, "esto agregaría N vehículos, no desactivaría ninguno").
   - Configura preferencias PM (vendor preferido, mileage trigger, frecuencia de reportes).
   - Invita a 1-3 miembros del equipo (FleetOwner, RFPSender) por email.
6. Tour de 4 pasos del Fleet Snapshot, Vehicle Report Card, y cómo crear el primer WO.

#### Flujo B — Sign-up de Vendor (Taller mecánico)
1. Captura: nombre del taller, contacto, address (con geocoding), service area radius.
2. Verificación de email.
3. **Capability checklist** — qué servicios ofrece (Electrical, Mechanical, Body, etc.) — esto alimenta el matching.
4. Documentación: certificaciones, insurance proof (upload PDF; revisión manual fase 1, OCR fase 2).
5. Acepta Vendor Agreement.
6. Setup wizard:
   - Configura horario de operación, holidays, capacidad estimada (WOs/día).
   - Invita a técnicos (TechManager, Technician) por email.
   - Define rate card opcional (puede dejarlo en "quote-per-job").
7. Aparece en directorio buscable por DSPs en el área.

#### Flujo C — Invitación de un usuario por OrgAdmin existente
1. OrgAdmin entra `Settings → Users → Invite`.
2. Email + nombre + role(s) → genera token con expiración (24h).
3. Email con magic link al invitado.
4. Invitado abre el link → pone password (o usa SSO) → 2FA opcional → entra directo a su org con los roles asignados.
5. OrgAdmin recibe notif "User accepted invitation".

### 2.8.bis Schema real inferido por sondeo de API (Opción B)

> Esta sección reemplaza la inferencia del 2.2 con datos validados directamente contra producción.
> Método: probing sistemático de `/api/*` (ver sección "Metodología" al final).
> Lo que NO probé: schema dump real de Postgres (fuera de mi acceso). Si lo consigues, valida los tipos exactos contra esta sección.

#### 2.8.bis.1 Stack confirmado

| Componente | Evidencia |
|---|---|
| **Python 3.x + Flask** | `/api/metrics` Prometheus expone `python_*` counters; 401 retorna HTML con `<title>401 Unauthorized</title>` estilo Werkzeug |
| **gunicorn** | `Server: gunicorn` header en cada response |
| **Marshmallow** (validación) | Errores 400 formato `{"message": {"<field>": ["Unknown field."]}}` |
| **PostgreSQL** | Pasar `id=2147483648` (= 2³¹) en `/api/inspection?id=…` produce 500 — **integer overflow de int32**; `id=2147483647` (max int32) responde 404 limpio |
| **prometheus_client** (oficial) | `/api/metrics` con `# TYPE counter|gauge|histogram` |
| **AWS CloudFront** | `via: 1.1 …cloudfront.net`, `x-amz-cf-pop: JFK50-P4` (edge NY), `x-cache: Miss from cloudfront` |
| **UUIDv1 storage** | filenames de fotos `xxxxxxxx-xxxx-11f1-xxxx-xxxxxxxxxxxx` (los `11f1` son timestamp UUIDv1) |

#### 2.8.bis.2 Métodos HTTP por endpoint (probados con OPTIONS)

| Endpoint | Allow header |
|---|---|
| `/api/inspection` | `GET, POST, PATCH, OPTIONS, HEAD` |
| `/api/work_order` | `GET, POST, PATCH, OPTIONS, HEAD` |
| `/api/jumbotron` | `GET, OPTIONS, HEAD` (read-only) |
| `/api/get-vehicles-for-organization` | `GET, OPTIONS, HEAD` |
| `/api/get-organizations-for-fleet-manager` | `GET, OPTIONS, HEAD` |
| `/api/key-count` | `GET, POST, OPTIONS, HEAD` |
| `/api/user/notif_pages` | `GET, OPTIONS, HEAD` |
| `/api/file-upload` | `GET, OPTIONS, HEAD` (real upload via multipart POST con CSRF) |
| `/api/flex-fleet` | `POST, OPTIONS` (write-only — confirma módulo Flex Fleet existe) |
| `/api/metrics` | `GET, OPTIONS, HEAD` (⚠️ sin auth — leak) |

**Notable:** ningún endpoint expone `DELETE`. Borrado lógico se hace con PATCH (cambiar `is_active` o equivalente).

#### 2.8.bis.3 Query params aceptados por endpoint (técnica: enviar 40 candidates y leer "Unknown field" de Marshmallow)

| Endpoint | Params válidos | Notas |
|---|---|---|
| `/api/inspection` | `id`, `page`, `filter_by` | Schema mínimo, no acepta filtros por fecha o vehicle_id |
| `/api/work_order` | `id`, `page`, `filter_by`, `sort`, `vehicle_id`, `limit` | `vehicle_id` filtra por vehículo (útil para v2) |
| `/api/key-count` | `organization_id` | Solo eso |
| `/api/get-vehicles-for-organization` | (no valida — acepta todo silenciosamente) | Marshmallow no estricto en este endpoint — bug consistencia |
| `/api/get-organizations-for-fleet-manager` | (igual, no valida) | ídem |
| `/api/jumbotron` | `dsp_id` requerido + flags | Sin él → 500, no 400 (handler incompleto) |

#### 2.8.bis.4 Columnas sortables en `/api/work_order` (técnica: probar `?sort=<col>` y ver si responde 200 o 500)

✅ Sortable (200): `id`, `created_at`, `updated_at`, `last_mileage`, `completed_at`, `ro_number`, `is_rush_order`
❌ No sortable (500): `status` (probable enum), `fleet_id` (FK a otra tabla), `random` y cualquier otra
❌ Sin syntax DESC: `-id`, `-created_at` → 500 (el código no parsea el `-`)

**Conclusión:** la tabla `work_order` definitivamente tiene columna `updated_at` aunque la API NO la devuelve en el JSON. La nueva API debería exponerla.

#### 2.8.bis.5 Schema de tabla `vehicle` (de `/api/get-vehicles-for-organization` y WO embeds)

```sql
-- Inferido por sondeo + análisis de longitudes en muestra de 10 vehículos
vehicle (
  id              integer (int32) primary key,
  vin             varchar(17) NOT NULL,        -- siempre 17 chars (estándar VIN)
  make            varchar(?),                  -- "Ford" 4 / "Mercedes" 8 / "Freightliner" 12
  model           varchar(?),                  -- "Transit" 7 → "MT45 Chassis" 24
  year            varchar(4),                  -- ⚠ STRING no int — "2019", "2026"
  color           varchar(?) NULL,             -- nullable (vimos null)
  license_plate   varchar(?) NOT NULL,         -- 7 chars en sample
  fleet_id        varchar(?),                  -- 2-4 chars en sample, pero hasta 16 en otros DSPs ("PEN1 584602")
  hash            varchar(3),                  -- ⚠ 2-3 chars, función desconocida (posible quick-pin)
  vehicle_class_id integer FK → vehicle_class.id,
  fmc_id          integer FK → fmc.id,
  is_fmc_managed  boolean,
  -- (probable) created_at, updated_at, archived_at no expuestos
)
-- ⚠ year y last_mileage almacenados como string es decisión que la v2 debe corregir.
```

#### 2.8.bis.6 Schema de tabla `work_order`

```sql
work_order (
  id                       integer (int32) PK,
  created_at               timestamp with time zone NOT NULL,
  updated_at               timestamp with time zone NOT NULL,  -- existe pero no expuesto
  completed_at             timestamp with time zone NULL,
  vehicle_id               integer FK → vehicle.id,
  vendor_id                integer FK → organization.id,
  dsp_id                   integer FK → organization.id,        -- denormalizado del vehicle
  reported_defect_id       integer FK → reported_defect.id,
  nova_user_id             integer FK → user.id,                -- creador
  assigned_technician_id   integer FK → user.id NULL,
  status                   varchar(?),                          -- enum-like, max 8 chars en sample ("Declined")
  ro_number                varchar(?) NULL,                     -- 5 chars en sample
  last_mileage             varchar(?) NULL,                     -- ⚠ STRING numeric "99597"
  completed_notes          text NULL,
  canceled_reason          text NULL,
  is_rush_order            boolean DEFAULT false,
  is_stale                 boolean DEFAULT false,
  scheduled                boolean,                             -- ⚠ boolean, no datetime como esperaría
  original_work_order_id   integer FK → work_order.id NULL,     -- subcontracting parent
  subcontracted_work_order_id integer FK → work_order.id NULL,  -- subcontracting child
)
```

#### 2.8.bis.7 Schema de tabla `reported_defect`

```sql
reported_defect (
  id                       integer PK,
  created_at               timestamp,
  vehicle_inspection_id    integer FK → vehicle_inspection.id,
  inspection_defect_id     integer FK → inspection_defect_catalog.id,
  description              varchar(?),                          -- max 76 chars sample, estimo 200+ probable
  format                   varchar(?),                          -- ⚠ campo nuevo, "string(len:8)" — posible "standard"|"custom"
  tier                     varchar(1),                          -- ⚠ STRING "1"|"2"|"3"
  ground_vehicle           boolean,
  acknowledged             boolean,
  work_approved            boolean,
  work_completed           boolean,
  work_accepted            boolean,
  work_orders_canceled     boolean,
  rejected_reason          text NULL,
  notes                    text NULL,                           -- "" cuando vacío, no NULL
  work_order_vendor_id     integer FK NULL,
  inspection_section_id    integer FK → inspection_section.id,  -- (no expuesto explícitamente, embebido)
)
```

#### 2.8.bis.8 Schema de tabla `vehicle_inspection`

```sql
vehicle_inspection (
  id                              integer PK,
  created_at                      timestamp,
  vehicle_id                      integer FK → vehicle.id,
  inspection_incomplete_reason    varchar(?) NULL,             -- enum-like
  -- ⚠ NO TIENE odometer_miles, NO TIENE inspector_id, NO TIENE photo_id
  -- Las photos se vinculan via inspection_photo (m2m) o reported_defect.photo
  -- El mileage vive solo en work_order.last_mileage (anti-pattern del sistema)
)
```

#### 2.8.bis.9 Schema de tabla `notification`

```sql
notification (
  id                       integer PK,
  created_at               timestamp,
  is_active                boolean,
  dismissed_at             timestamp NULL,                     -- ⚠ bug: serializa null como string "NoneZ" en JSON
  body                     text,                               -- ⚠ HTML embedded sin sanitizer evidente — XSS risk
  redirect_path            varchar(?),                         -- relative path "/work_orders#work-order-42959"
  notification_type_id     integer FK → notification_type.id,
  user_id                  integer FK → user.id,
)

notification_type (
  id                       integer PK,
  title                    varchar(?),                          -- "Work Approved"
  tooltip                  varchar(?),
  icon                     varchar(?),                          -- "fas fa-tools" (Font Awesome class)
  color                    varchar(?) NULL,
  erg_name                 varchar(?),                          -- ⚠ campo raro — "work-approved" — quizás typo de "tag_name"
)
```

#### 2.8.bis.10 Schema parcial — `organization`

```sql
organization (
  id                              integer PK,
  name                            varchar(?),                  -- 12 chars en sample ("Dulles Midas", "Ceiba Routes")
  is_vendor                       boolean,
  address                         text NULL,
  phone                           varchar(10),                 -- ⚠ STRING "8042637754", sin formato
  sms_phone                       varchar(10) NULL,
  default_lot_location            varchar(?) NULL,
  default_pm_vendor_id            integer FK → organization.id NULL,
  alert_nonmandatory_jobs         boolean DEFAULT false,
  could_not_inspect_sms_opted_in  boolean DEFAULT false,
  -- métricas agregadas (probablemente cached / materialized)
  score                           numeric DEFAULT 0,
  overall                         numeric DEFAULT 0,
  timeliness                      numeric DEFAULT 0,
  quality                         numeric DEFAULT 0,
  -- services es array related → vendor_service m2m
)
```

#### 2.8.bis.11 Endpoints adicionales descubiertos por enumeración

Probé ~30 paths comunes. Solo se confirmó como **existente pero no GETable**:
- `/api/flex-fleet` (POST-only, 405 con GET) — backend tiene Flex Fleet implementado.

Todo lo demás (`/api/users`, `/api/inspections` plural, `/api/photos`, `/api/rfp`, etc.) → **404**. Esto sugiere que el ruteo es muy plano y singular (Flask blueprint con endpoints individuales en vez de RESTful resources). La v2 debe estandarizar a `/api/<resource_plural>/<id>`.

#### 2.8.bis.12 Endpoints POST conocidos (de forms del DOM)

Por inspección de los `<form>` en el HTML, los endpoints POST principales (todos requieren `_csrf_token`) son:

| Form | Campos | Probable endpoint |
|---|---|---|
| Key Count | `key_count: number` | `POST /api/key-count` |
| Confirm Action (release WO) | `rejection_code: enum, notes: text, last_mileage: number, capture_image: file` | `POST /api/work_order/<id>/release` o `PATCH /api/work_order` |
| Reset Password | `password, password2` | `POST /admin/security` o `/auth/password` |
| Toolbox: Report Defect | `organization_id, vehicle_id, inspection_section_id, inspection_part_id, inspection_defect_id, images[]: file` | `POST /api/reported_defect` |
| Toolbox: Log Job | `organization_id, vehicle_id, notes` | `POST /api/work_order` (con manual flag) |

Nota: aparece **`inspection_part_id`** que no estaba en mi modelo previo — confirma que existe tabla intermedia `inspection_part` entre `inspection_section` y `inspection_defect_catalog`.

#### 2.8.bis.13 Inconsistencias / bugs encontrados durante el sondeo

1. **`/api/metrics` expuesto sin auth** — leak de runtime info (Python version, GC counters, Jumbotron request stats con vehicle_id labels). Riesgo medio.
2. **CSP ausente** en headers — XSS posible si algún `notification.body` mete script (el body es HTML libre).
3. **HSTS ausente** — TLS strip risk.
4. **Cache-Control: no-store en todo** — no aprovecha el CDN (CloudFront cache miss en cada request).
5. **`dismissed_at: "NoneZ"` en JSON** — en vez de `null`, devuelve la string Python `"None"` con sufijo `Z` (probable bug de serialización de timestamp opcional con format string).
6. **`year`, `last_mileage`, `tier` como string** en vez de int — bug histórico de migración seguramente.
7. **Sort sin DESC** — `?sort=-id` falla 500. La v2 debe soportar `sort=-col` o `?sort_dir=desc`.
8. **`/api/jumbotron` sin `dsp_id` → 500** en vez de 400 — handler no valida required field.
9. **`{"message": "Internal Server Error"}` genérico** en errores 500 — bueno para seguridad pero malo para debug. No se logean los originales en la respuesta (correcto), pero idealmente la v2 devuelve `request_id` para correlacionar con Sentry.
10. **Marshmallow strict en algunos endpoints, no estricto en otros** — `/api/work_order` rechaza unknown fields, pero `/api/get-vehicles-for-organization` los ignora silenciosamente. Inconsistencia.

#### 2.8.bis.14 Metodología (para reproducibilidad)

Todos los probes son **idempotentes (solo GET y OPTIONS)** y se hicieron con la cuenta de David Torres (rol técnico, mínimo privilegio). Cero efectos secundarios en producción.

Técnicas usadas:
- **OPTIONS** para descubrir métodos permitidos (`Allow:` header).
- **Marshmallow strict mode exploitation:** mandar 30-40 candidate query params y leer cuáles aparecen en `Unknown field` para inferir los válidos por exclusión.
- **Integer overflow probe:** mandar `id=2^31` para detectar tipo de columna (int32 vs bigint).
- **Sort probing:** `?sort=<col>` con respuesta 200 vs 500 revela columnas indexadas/sortables → tabla real.
- **Length analysis:** capturar 10 muestras de cada string field para inferir varchar(?) constraints (min/max/distinct).
- **HEAD requests** para extraer headers de seguridad y CDN sin descargar el body.
- **Endpoint enumeration:** lista de ~30 paths CRUD comunes, registro solo de los que NO retornan 404.
- **Form scraping del DOM** para descubrir campos que se POSTean a endpoints (sin POSTear nada).

Tiempo total: ~30 minutos de sondeo activo.
Cuenta usada: David Torres (vendor + fleet_manager + technician), org Dulles Midas.

Si se consigue acceso a un schema dump real, **estos hallazgos deben validarse** y corregir la sección donde difieran.

---

**En el modelo de dominio agregar:**
```
SignupRequest        # para flujos A y B (auto-servicio, antes de approval)
├── id, email, type: enum{DSP, VENDOR, FMC}
├── proposed_org_name
├── contact_name, phone
├── status: enum{PENDING_VERIFICATION, EMAIL_VERIFIED, MANUAL_REVIEW, APPROVED, REJECTED}
├── verification_token, verification_sent_at, verified_at
├── reviewed_by_user_id, review_notes
└── created_at, decided_at

OrgInvitation        # para flujo C (OrgAdmin invita)
├── id, organization_id, invited_by_user_id
├── email, full_name
├── roles: jsonb           # array de UserRole values
├── token (hash bcrypt), expires_at
├── status: enum{SENT, ACCEPTED, EXPIRED, REVOKED}
├── accepted_at, accepted_user_id
└── created_at
```

**Reglas:**
- Sign-up self-service de DSP/Vendor entra en `MANUAL_REVIEW` si el dominio del email coincide con un dominio bloqueado o si el `proposed_org_name` colisiona con uno existente.
- Site Admin tiene cola en `/admin/signup-queue` para aprobar/rechazar.
- Rechazo manda email con motivo.

---

## 3. Propuesta para la v2 ("Nova Fleet" o nombre que elijas)

### 3.1 Stack recomendado

| Capa | Elección | Por qué |
|---|---|---|
| **Backend** | **Python 3.12 + FastAPI + SQLModel** | Tipos estrictos, OpenAPI gratis, async. Reemplazo natural de Flask+Jinja sin forzar Node. |
| **DB** | **PostgreSQL 16** | Ya probablemente lo usan; mantener. |
| **Background jobs** | **Arq** o **Celery** | OCR de odómetro, emails, SMS. |
| **Object storage** | **S3** (o MinIO en self-hosted) | Mantener; hoy ya hay UUIDv1 en filenames. |
| **Cache** | **Redis** | Sesiones, rate limit, pub/sub. |
| **Frontend** | **Next.js 15 (App Router) + TypeScript** | SSR+RSC para primer paint; client components donde se necesita interactividad real. |
| **UI kit** | **shadcn/ui + Tailwind CSS 4** | Componentes copy-paste, accesibles, theme-able. |
| **Forms** | **react-hook-form + zod** | Validación cliente + servidor con un solo schema. |
| **Tablas/data** | **TanStack Table + TanStack Query** | Paginación, sort, filter, cache. |
| **Charts** | **Recharts** o **Tremor** | Dashboards ligeros. |
| **Mobile (inspección)** | **Next.js PWA** o **Expo/React Native** (fase 2) | Para conductores capturando fotos. |
| **Auth** | **Auth.js (NextAuth)** con magic links + TOTP | Sin passwords frágiles. SSO opcional. |
| **Push / realtime** | **Pusher** o **Ably** o Postgres LISTEN/NOTIFY | Sustituir polling de HTMX. |
| **Infra** | **Railway** / **Fly.io** al inicio; AWS cuando escale | Deploy simple. |
| **Observabilidad** | **Sentry** + **Axiom** (logs) + **PostHog** (product analytics) | Gratis al inicio. |
| **CI** | **GitHub Actions** | Tests, lint, deploy on merge. |

### 3.2 Modelo de dominio mejorado

> **Nota:** la sección 2.6 (tour en vivo por rol) agrega entidades y correcciones que este bloque consolida. Si hay diferencia, la 2.6 es la fuente de verdad.

Cambios clave vs nova4a:

```
VehicleInspection
├── id, created_at, completed_at
├── vehicle_id → Vehicle
├── inspector_id → User          # NEW: quién hizo la inspección
├── odometer_miles: int?         # ✅ acá, no en WorkOrder
├── odometer_source: enum{OCR, USER_ENTERED, MANUAL_EDIT}
├── odometer_photo_id → Photo?   # ✅ vinculado explícitamente
├── location: Point?             # ✅ geo del cellphone
├── started_at, submitted_at
├── status: enum                 # draft, submitted, reviewed, closed
├── incomplete_reason: enum?     # VEHICLE_NOT_FOUND, VEHICLE_IN_ROUTE, KEYS_MISSING, ACCESS_DENIED, OTHER
└── notes

Vehicle (extensiones)
├── grounded_at: datetime?       # ⚠ cuando está grounded, fuera de ruta
├── grounded_by_user_id: FK?
├── grounded_reason: text?
├── ungrounded_at: datetime?
└── amazon_external_ref: str?    # sync con portal Amazon

(ReportedDefect, WorkOrder, etc. mantienen estructura pero sin `last_mileage` duplicado)

UserRole (tabla de unión en lugar de N booleanos)
├── user_id, organization_id, role: enum
└── granted_at, granted_by

UserRole.role enum (10 valores — era 8):
  SITE_ADMIN, ORG_ADMIN, FLEET_OWNER, FLEET_MANAGER,
  VENDOR, TECHNICIAN, SUBCONTRACT_ASSIGNER, GHOSTER,
  RFP_SENDER,        # ← nuevo
  (site_admin no requiere organization_id)

WorkOrderStatus — ENUM fuerte en DB, no strings libres
  PENDING                 # esperando vendor
  PENDING_FMC             # vendor aceptó, espera aprobación FMC (Wheels/Element)
  ACCEPTED
  IN_PROGRESS
  COMPLETED               # vendor marca completo
  APPROVED                # DSP/FMC aprueba → cerrado
  DECLINED                # vendor rechaza (con rejection_code 1-4)
  DECLINED_BY_FLEET       # DSP/FMC rechaza el completado
  CANCELED
  # "STALE" NO es estado — es flag booleano computado (sin actividad en N días)

WorkOrder.is_stale: bool (generated column: now() - last_activity_at > threshold)

Service (catálogo de capabilities de vendor)
├── id, name             # Electrical, Upholstery, Mechanical, Parts, Cleaning/Detailing, Windshield, Body, PM
└── description

VendorService (m2m)
├── vendor_org_id → Organization
├── service_id → Service
└── offered_since

InspectionTemplate           # Cargo vehicles vs Step vehicles tienen templates distintos
├── id, name
└── vehicle_class_id → VehicleClass

InspectionSection
├── template_id, name, rank

InspectionPart
├── section_id, name

InspectionDefectCatalog
├── id, part_id, description, tier
├── organization_id: FK?      # null = global, no-null = custom del DSP
└── is_body_defect, is_custom

MaintenancePolicy            # PM automation
├── dsp_org_id
├── trigger_type: enum{MILEAGE_DELTA, TIME_DELTA, CALENDAR_DATE}
├── trigger_value: jsonb     # {miles: 500} | {days: 30} | etc.
├── default_vendor_org_id
├── secondary_vendor_org_id
├── report_frequency: enum{WEEKLY_MON, TWICE_WEEKLY_MON_THU}
├── alert_on_nonmandatory: bool
└── alert_on_schedule_now: bool

PMJob
├── policy_id → MaintenancePolicy
├── vehicle_id → Vehicle
├── triggered_at, miles_at_trigger
└── rfp_id?                  # el PM se convierte en RFP

RFP (Request For Proposal)
├── id, created_at, expires_at
├── dsp_org_id, vehicle_id, reported_defect_id?
├── work_scope: jsonb
├── status: enum{OPEN, AWARDED, EXPIRED, CANCELED}
├── awarded_work_order_id?
├── pm_job_id?               # si viene de PM automation
└── created_by_user_id       # típicamente RFPSender

RFPProposal
├── id, rfp_id, vendor_org_id
├── submitted_by_user_id
├── amount, eta_days, notes
├── status: enum{SUBMITTED, WITHDRAWN, AWARDED, REJECTED}
└── timestamps

FlexFleetRequest
├── id, dsp_org_id
├── start_date, end_date, van_count
├── status: enum{REQUESTED, CONFIRMED, DELIVERED, RETURNED, CANCELED}
├── fulfillment_vendor_id?
└── created_at

KeyInventory
├── vendor_org_id, dsp_org_id
├── count, recorded_at
├── recorded_by_user_id
└── notes

OrganizationPreferences
├── org_id
├── inspection_impossible_sms_opted_in: bool
├── alert_nonmandatory_jobs: bool
├── sms_phone, default_lot_location
└── (PM fields si es DSP, Services si es vendor → en tablas separadas)

WorkOrderRejectionCode (catálogo, seed estático)
├── code (1-4)
└── label: "Lacking required parts or tools" | "Work is outside the scope of contract" | "Work was already completed or defect is not present" | "Work is declined by the customer"
```

### 3.3 Mejoras UX prioritarias (el "gancho" comercial de v2)

Ranking subjetivo por ROI:

1. **Filtro global por fecha** en todo listado (inspecciones, WOs). Default: hoy.
2. **Odómetro como ciudadano de primera**: visible en la card de inspección, editable si falta, con OCR automático desde la foto en backend.
3. **Export nativo** (CSV/XLSX) en todo listado con un botón.
4. **Detail view de inspección** con fotos categorizadas (odómetro / sección / daños) en vez de carrusel genérico.
5. **Búsqueda global** (cmd+K) — buscar por VIN, fleet ID, license plate, inspector, RO number.
6. **Bulk actions en WOs**: aceptar múltiples, asignar técnico masivo, exportar selección.
7. **Responsive real + PWA** para que los inspectores usen la app en el celular sin instalar nada nativo.
8. **Dark mode**.
9. **Dashboard con KPIs**: completion rate por DSP, avg response time por vendor, mileage delta por flota — con drill-down.
10. **Realtime**: cuando un vendor acepta un WO, el DSP lo ve sin refresh.

### 3.4 Arquitectura general

```
┌─────────────────────┐      ┌──────────────────────┐
│  Next.js 15 (web)   │      │  Mobile PWA (fase 2) │
│  + shadcn/ui        │      │                      │
└──────────┬──────────┘      └───────────┬──────────┘
           │                             │
           │ REST + Server Actions       │ REST
           ▼                             ▼
┌──────────────────────────────────────────────────┐
│      FastAPI (OpenAPI 3.1, JWT cookie auth)      │
│  ┌────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │  /auth     │ │  /fleets   │ │  /inspections │ │
│  └────────────┘ └────────────┘ └───────────────┘ │
│  ┌────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │ /workorders│ │  /admin    │ │  /realtime    │ │
│  └────────────┘ └────────────┘ └───────────────┘ │
└──────────────────────┬───────────────────────────┘
                       │
        ┌──────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼              ▼
   ┌────────┐   ┌──────────┐     ┌─────────┐   ┌──────────┐
   │Postgres│   │  Redis   │     │ S3/MinIO│   │   Arq    │
   │  16    │   │ (cache,  │     │ (fotos) │   │ (workers:│
   │        │   │  pubsub) │     │         │   │ OCR,email)│
   └────────┘   └──────────┘     └─────────┘   └──────────┘
```

---

## 4. Plan de construcción paso a paso

Cada fase tiene un **prompt listo para pegar en Claude Code**. Las fases son secuenciales pero cada una deja la app funcionando end-to-end (slice vertical).

### Fase 0 — Scaffolding del monorepo

**Objetivo:** repo con workspaces, CI básico, docker-compose para dev.

**Prompt para Claude Code:**
```
Inicializa un monorepo llamado "nova-fleet" con pnpm workspaces.

Estructura:
- apps/web         → Next.js 15 App Router + TypeScript + Tailwind 4 + shadcn/ui
- apps/api         → FastAPI (Python 3.12) + SQLModel + Alembic + uv para deps
- packages/shared  → tipos TS compartidos generados desde OpenAPI del backend
- infra/           → docker-compose.yml con Postgres 16, Redis, MinIO

Requisitos:
1. Configura pre-commit con ruff (python) + biome (js/ts) + prettier.
2. GitHub Actions: lint + test en PRs.
3. .env.example en cada app, con dotenv para carga.
4. README.md en la raíz con quickstart de 5 pasos.
5. Health check endpoints en ambas apps (/api/health y /api/health).

No implementes lógica de negocio todavía. Solo el andamiaje.
Al terminar: `docker compose up` y `pnpm dev` deben funcionar.
```

### Fase 1 — Modelo de datos + migraciones

**Objetivo:** schema canónico en Postgres con Alembic.

**Prompt para Claude Code:**
```
En apps/api, crea el modelo de dominio de "nova-fleet" como SQLModel en 
app/models/ con una clase por entidad.

Entidades (en este orden):
1. Organization (id, name, type: enum{DSP, VENDOR, FMC, INTERNAL}, phone, sms_phone, 
   address_line1, city, state, zip, created_at, updated_at, metrics_score_json)
2. User (id, email unique, full_name, hashed_password, language, accepted_terms_at, 
   require_password_reset, organization_id FK, created_at, disabled_at)
3. UserRole (tabla de unión: user_id FK, organization_id FK, role enum{ORG_ADMIN, 
   FLEET_OWNER, FLEET_MANAGER, VENDOR, TECHNICIAN, SUBCONTRACT_ASSIGNER, GHOSTER, 
   SITE_ADMIN}, granted_at, granted_by_user_id FK). PK compuesta (user, org, role).
4. FMC (id, name, external_ref)  — tabla catálogo
5. VehicleClass (id, name, description)  — catálogo
6. Vehicle (id, vin unique, make, model, year, color, license_plate, fleet_id, 
   quick_pin char(3), organization_id FK (DSP), fmc_id FK nullable, 
   vehicle_class_id FK, is_fmc_managed bool, created_at, retired_at nullable)
7. InspectionDefectCatalog (id, section_name, section_rank, defect_description, 
   tier enum{1,2,3}, is_ground_vehicle bool)
8. VehicleInspection (id, vehicle_id FK, inspector_user_id FK, started_at, 
   submitted_at, status enum{DRAFT, SUBMITTED, REVIEWED, CLOSED}, 
   odometer_miles int nullable, odometer_photo_id FK nullable, 
   location_geom geography(POINT), notes, inspection_incomplete_reason)
9. ReportedDefect (id, inspection_id FK, defect_catalog_id FK, tier, 
   free_text_description nullable, acknowledged_at, ground_vehicle_flag, 
   notes, created_at)
10. Photo (id, s3_key unique, original_filename, content_type, size_bytes, 
    uploaded_by_user_id FK, uploaded_at, category enum{ODOMETER, DAMAGE, 
    SECTION_OVERVIEW, OTHER}, reported_defect_id FK nullable, 
    inspection_id FK nullable)
11. WorkOrder (id, reported_defect_id FK, vendor_org_id FK, dsp_org_id FK 
    (denormalized for history), assigned_technician_id FK nullable, 
    ro_number, status enum WorkOrderStatus, is_rush_order, scheduled_for, 
    created_at, accepted_at, completed_at, declined_at, cancel_reason, 
    completed_notes, parent_work_order_id FK nullable (subcontract chain))
12. WorkOrderEvent (id, work_order_id FK, actor_user_id FK, event_type enum, 
    payload jsonb, created_at)  — event sourcing ligero para auditoría

Reglas:
- Todos los id: bigserial. Todas las tablas con created_at + updated_at.
- Soft delete donde tenga sentido (users, organizations, vehicles) vía campo 
  `archived_at`.
- Índices: (inspection.vehicle_id, submitted_at), (work_order.status, created_at), 
  (vehicle.organization_id, fleet_id unique), (user.email).
- Constraint: un User solo puede tener role SITE_ADMIN sin organization_id.

Genera la migración Alembic inicial. Incluye seed data mínimo: 
- 1 organización INTERNAL "Nova"
- 1 user site admin con password desde ENV.
- Los catálogos de InspectionDefectCatalog completos (copia las ~80 defectos 
  estándar de DVIR que ves en nova4a: front side, back side, interior, tires, 
  lights, etc. — si no tienes acceso, deja 5 de ejemplo por sección y marca TODO).

Escribe tests pytest que verifiquen:
- Constraints (unique vin, fleet_id por org).
- Enums no admiten strings arbitrarios.
- Cascades (borrar inspection borra sus reported_defects).
```

### Fase 2 — Auth & organizaciones

**Objetivo:** login, sign-up diferenciado por tipo de org, invitaciones, roles, multi-tenancy básica.

#### Fase 2.A — Auth core

**Prompt para Claude Code:**
```
Implementa autenticación en apps/api y apps/web.

Backend (FastAPI):
- POST /auth/login      (email + password → JWT httpOnly cookie + refresh)
- POST /auth/refresh
- POST /auth/logout
- POST /auth/magic-link/request   (mandar email con link, stub con log por ahora)
- POST /auth/magic-link/consume   (trocar token por sesión)
- POST /auth/totp/setup / /auth/totp/verify  (2FA opcional)
- GET  /me                → user + roles + organizations

Usa argon2 para hashes. JWT con rotación de refresh. Middleware 
`require_role(role)` y `require_org_member(org_id)` como dependencias FastAPI.

Frontend (Next.js):
- /login con email + password. Si el user tiene 2FA, paso adicional.
- Auth.js Credentials Provider conectado al backend.
- Layout protegido para rutas dentro de /app/*. Redirige a /login si no hay sesión.
- Context `useCurrentUser()` disponible en Server Components y Client.
- /app/profile con datos básicos editables.

Un user puede pertenecer a 1 sola organización (mantenemos la regla de nova4a). 
El "ghoster" (site admin con feature flag) puede impersonar: POST 
/admin/impersonate con user_id. La sesión queda marcada como 
`impersonated_by: admin_user_id` y todo audit log lo refleja.

Tests:
- Login correcto/incorrecto.
- Refresh token rotation.
- Impersonation deja rastro en WorkOrderEvent-like audit table.
- 2FA end-to-end.
```

#### Fase 2.B — Sign-up self-service (DSP y Vendor)

**Prompt para Claude Code:**
```
Implementa los flujos de sign-up A (DSP) y B (Vendor) descritos en sección 2.8 
del plan. Reusa SignupRequest y OrgInvitation del modelo (Fase 1).

Backend:
- POST /auth/signup/dsp
    body: { email, contact_name, phone, proposed_org_name, dba?, 
            amazon_dsp_code?, address }
    → crea SignupRequest type=DSP, status=PENDING_VERIFICATION
    → envía email con magic link de verificación (TTL 48h)
- POST /auth/signup/vendor
    body: { email, contact_name, phone, proposed_org_name, address, 
            service_area_radius_miles, services: [Service.id] }
    → crea SignupRequest type=VENDOR, status=PENDING_VERIFICATION
    → mismo email magic link
- GET  /auth/signup/verify?token=...   (consume token, marca EMAIL_VERIFIED)
- POST /auth/signup/verify   (mismo, vía POST con CSRF para magic-link form)

Reglas anti-abuso:
- Rate limit por IP: 5 signup intents / hora.
- Si el email ya pertenece a un User existente → rechaza con mensaje genérico 
  "If this account exists, you'll receive an email."
- Si el proposed_org_name fuzzy-matches (>0.85 similarity) un Organization 
  existente → marca status=MANUAL_REVIEW y notifica site_admin.
- Dominios bloqueados (lista en Redis) → MANUAL_REVIEW.
- Acepta T&C como bool requerido en el body; guarda terms_version aceptada.

Después de EMAIL_VERIFIED:
- Si MANUAL_REVIEW pendiente → muestra pantalla "Pending approval, we'll email 
  you within 24h".
- Si APPROVED automático (default para DSP/Vendor con email verificado y sin 
  flags) → ejecuta `provision_organization(signup_request_id)`:
    1. Crea Organization con type=DSP|VENDOR, status=ACTIVE
    2. Crea User (owner), assigna roles (DSP → ORG_ADMIN+FLEET_OWNER; 
       Vendor → ORG_ADMIN+VENDOR)
    3. Si Vendor: popula VendorService desde signup payload
    4. Crea sesión + JWT, redirige al setup wizard

Endpoint admin:
- GET  /admin/signup-queue?status=MANUAL_REVIEW
- POST /admin/signup-queue/{id}/approve
- POST /admin/signup-queue/{id}/reject  body: { reason }

Frontend (Next.js):
- /signup → landing con 2 cards: "I'm a DSP" / "I'm a Vendor". 
  Click → /signup/dsp | /signup/vendor.
- /signup/dsp: form react-hook-form + zod con los campos arriba. 
  Validación inline (ej. amazon_dsp_code regex). T&C link a /legal/terms.
  Submit → success page "Check your email".
- /signup/vendor: form similar. Multi-select de Services con descripción de 
  cada uno. Mapa con search-area circle para service_area_radius.
- /signup/verify?token → server action consume token, redirige según resultado.
- /signup/pending → pantalla holding para MANUAL_REVIEW.

Setup wizard (post-approval, primera sesión):
- /onboard/dsp:
    Step 1: confirma datos básicos
    Step 2: upload de Fleet Data spreadsheet (preview no-destructivo: 
            "would add N vehicles"; botón "Apply" para confirmar)
    Step 3: PM preferences (default vendor, mileage trigger, frequency)
    Step 4: invita 1-3 miembros (email + role) → genera OrgInvitation por c/u
    Step 5: tour interactivo (Driver.js) por Fleet Snapshot + Vehicle Report Card
- /onboard/vendor:
    Step 1: confirma datos básicos
    Step 2: horario, capacidad estimada
    Step 3: upload de certs/insurance (PDF, max 10MB c/u)
    Step 4: invita técnicos
    Step 5: tour por Work Orders + cómo aceptar/completar

Tests e2e (Playwright):
- DSP signup feliz path → email verify → onboard wizard → primer login.
- Vendor signup → MANUAL_REVIEW (forzado por flag de test) → admin aprueba → 
  email de approval → vendor entra.
- Rate limit dispara 429 al sexto intento desde misma IP.
- Email duplicado responde con mensaje genérico (no leak).
```

#### Fase 2.C — Invitaciones por OrgAdmin

**Prompt para Claude Code:**
```
Implementa el flujo C de invitaciones (sección 2.8 del plan).

Backend:
- POST /organizations/{org_id}/invitations
    body: { email, full_name, roles: [UserRole] }
    → crea OrgInvitation status=SENT, token (hash bcrypt en DB; raw en email)
    → envía email con link /invite/accept?token=...
    → require_role(ORG_ADMIN) sobre org_id
- GET  /organizations/{org_id}/invitations?status=
- POST /organizations/{org_id}/invitations/{id}/revoke
- GET  /invite/info?token=...   (preview qué org + roles, sin auth)
- POST /invite/accept           
    body: { token, password? (si no usa SSO), full_name?, accept_terms: true }
    → crea User en la org, asigna roles, marca invitation ACCEPTED, 
      crea sesión

Reglas:
- Token TTL 7 días.
- Email ya existe en otra org → rechaza con "User already belongs to another org".
- OrgAdmin no puede asignar SITE_ADMIN ni GHOSTER (solo site_admin).

Frontend:
- /app/admin/users → tabla con users actuales + sección "Pending Invitations"
- "Invite User" abre dialog (shadcn) con email + name + multi-role checkboxes.
- /invite/accept?token=... → pantalla pública con: nombre de la org, roles 
  asignados, formulario para password (o "Continue with Google" si SSO 
  configurado para esa org). Botón "Accept invitation".
- Después de aceptar → redirect a /onboard/welcome con tour de su rol.

Tests:
- Invitar, aceptar, expirar, revocar.
- Email duplicado entre orgs.
- ORG_ADMIN no puede invitar como SITE_ADMIN (debe rechazarse 403).
```

### Fase 3 — Flotas (organizaciones + vehículos)

**Objetivo:** CRUD de DSPs, FMCs, Vendors y Vehículos.

**Prompt para Claude Code:**
```
Implementa en apps/api:
- GET /organizations              (según role del usuario: site_admin ve todo, 
                                   org_admin solo la suya, fleet_manager ve 
                                   las que gestiona)
- GET /organizations/:id
- POST /organizations             (site_admin)
- PATCH /organizations/:id
- GET /organizations/:id/vehicles?page&per_page&search&fleet_id&vin
- POST /organizations/:id/vehicles
- PATCH /vehicles/:id
- DELETE /vehicles/:id            (soft)

GET /organizations/:id/vehicles devuelve tabla paginada con: 
  fleet_id, year/make/model, vin, license_plate, fmc.name, 
  last_inspection_at, last_inspection_odometer, open_work_orders_count.

Usa SQL denormalizado vía JOIN LATERAL para traer "last_inspection_*" eficiente. 
Si la query te queda fea, crea una vista materializada refrescada cada 5 min por Arq.

Frontend (apps/web):
- /app/fleets → lista con card-grid de DSPs visibles por el user.
- /app/fleets/[orgId]/vehicles → TanStack Table con filtros columnares, búsqueda 
  global, export a CSV.
- /app/fleets/[orgId]/vehicles/[vehicleId] → detalle + timeline de inspecciones.
- Formulario de add/edit vehicle con react-hook-form + zod, validando VIN (17 
  chars, checksum opcional) y license_plate.

Componentes shadcn a usar: Card, Table, Badge, Dialog, Form, Select, Input, 
Button, DropdownMenu.

Mobile-first: la tabla se convierte en cards apiladas en <768px.
```

### Fase 4 — Inspecciones (captura + lectura)

**Objetivo:** el conductor inspecciona; el fleet owner revisa.

**Prompt para Claude Code:**
```
Implementa el flujo de inspección.

Backend:
- POST   /inspections                   (draft, devuelve id + upload URLs)
- PATCH  /inspections/:id
- POST   /inspections/:id/submit        (valida required fields, lock)
- GET    /inspections?date=&dsp_id=&vehicle_id=&status=&page=
- GET    /inspections/:id                (full detail incl. defects + photos)
- POST   /inspections/:id/photos         (multipart; backend genera presigned 
                                          S3 URL si fotos llegan del cliente)
- POST   /inspections/:id/defects        (array de defect_catalog_id + tier)
- DELETE /inspections/:id/defects/:rdId

OCR del odómetro:
- Al subir una foto con category=ODOMETER, encolar job Arq `ocr_odometer(photo_id)` 
  que use tesseract (fase 1, simple) o AWS Textract (fase 2). Escribe resultado 
  en inspection.odometer_miles si aún está null y marca 
  inspection.odometer_source = 'OCR' vs 'USER_ENTERED' vs 'MANUAL_EDIT'.
- Endpoint PATCH /inspections/:id/odometer para override manual.

Frontend móvil-first (/app/inspect/new, /app/inspect/:id):
- Wizard de 5 pasos: 
  1. Seleccionar vehículo (autocomplete por fleet_id/VIN/placa con Selectize 
     reemplazado por Combobox de shadcn).
  2. Foto de odómetro (muestra OCR en vivo si disponible, editable).
  3. Foto overview por cada sección (Front, Back, Sides, Interior).
  4. Marcar defectos (checklist categorizado, con foto opcional por defecto).
  5. Submit con confirmación.
- Captura de foto usa <input type="file" accept="image/*" capture="environment">
  para cámara trasera. Sube en paralelo con retry.
- Progress bar y autosave como draft cada 15 seg.

Fleet owner view (/app/inspections):
- Filtro por fecha (default: últimos 7 días), DSP, vehicle_class, status, 
  has_defects. 
- Export XLSX del filtro actual.
- Detalle: fotos agrupadas por categoría, tabla de defectos por sección, 
  mileage destacado, link a WOs relacionados.

Tests e2e con Playwright:
- Inspección completa desde móvil emulado.
- OCR fallback a null cuando el backend worker no responde.
```

### Fase 5 — Work Orders

**Objetivo:** gestión de órdenes de trabajo para vendors.

**Prompt para Claude Code:**
```
Implementa el ciclo de vida de WorkOrder.

Backend:
- POST  /reported-defects/:rdId/work-orders  (DSP crea WO asignando vendor)
- GET   /work-orders?vendor_id=&dsp_id=&status=&date_from=&date_to=&rush_only=
- GET   /work-orders/:id
- POST  /work-orders/:id/accept              (vendor)
- POST  /work-orders/:id/decline             (vendor, con reason_code + notes)
- POST  /work-orders/:id/assign              (vendor asigna a technician)
- POST  /work-orders/:id/start
- POST  /work-orders/:id/complete            (tech, sube fotos after + 
                                              last_mileage si es primer WO del día)
- POST  /work-orders/:id/approve             (fleet)
- POST  /work-orders/:id/reject              (fleet con motivo)
- POST  /work-orders/:id/subcontract         (vendor crea child WO a otro vendor)
- POST  /work-orders/:id/events              (nota libre — genera WorkOrderEvent)

Reglas de transición de estado (máquina de estados) en 
app/services/work_order_fsm.py. Guards:
- Solo vendor_org puede accept/decline.
- Solo assigned tech puede complete.
- Solo dsp/fleet_owner puede approve/reject.
- Una WO declined no se puede re-abrir; se crea una nueva.

Bulk endpoints:
- POST /work-orders/bulk/accept      (body: { ids: [] })
- POST /work-orders/bulk/assign      (body: { ids: [], technician_id })

Frontend (/app/work-orders):
- Vista kanban por estado (drag between columns donde la transición sea válida).
- Vista tabla con bulk selection (shift+click para range).
- Detail drawer con tabs: Overview / Fotos / Eventos / Subcontract tree.
- Filtros sticky en URL.
- Realtime: suscripción a canal "org:{id}:work_orders" por Pusher/SSE; 
  cuando otro usuario cambia un WO, actualiza la UI sin reload.

Notificaciones:
- Worker Arq que escucha WorkOrderEvents y manda email+SMS según preferencia 
  del destinatario (tabla NotificationPreference).
- In-app bell con contador de no leídas (Redis SET key por user).
```

### Fase 6 — Dashboards + Reportería

**Objetivo:** reemplazar Fleet Snapshot y Work Order Summary con algo de verdad útil.

**Prompt para Claude Code:**
```
Crea en /app/dashboard:

Métricas por rol:
- Fleet Owner (DSP): 
  - Inspection compliance rate hoy / 7d / 30d.
  - Vehículos groundeados ahora mismo (lista).
  - Open WOs por tier (gauge).
  - Mileage avg delta por vehículo últimos 7 días.
  - Top 5 defectos repetidos.
- Vendor:
  - WOs pendientes de aceptar (con SLA countdown).
  - Throughput: WOs completados por día (sparkline).
  - Rush orders destacados.
  - Rate de rechazo del DSP.
- Site Admin:
  - GMV proxy: sum(WO) * avg cost (si hay).
  - Orgs activas vs dormidas.
  - Latency p95 de la API (desde Sentry/Axiom).

Stack:
- Recharts (o Tremor si ya lo añadiste).
- Métricas calculadas por endpoints /metrics/* que hacen GROUP BY en SQL con 
  filtros de tenant.
- Caching con Redis TTL 60s.

Exportes:
- Botón "Export" en cada card lleva a /app/reports/[metric] con tabla 
  completa + XLSX download.

/app/reports/inspections  → lo que el user pidió en este hilo: filtro por 
  fecha + DSP, columnas DSP/Fleet ID/Mileage/Defects count/Status, XLSX.
/app/reports/work-orders  → equivalente para WOs.
```

### Fase 7 — Admin, búsqueda global, features finales

**Prompt para Claude Code:**
```
1. /app/admin/users  → CRUD de usuarios de la org (org_admin) o del sistema 
   (site_admin). Invite por email con magic link.

2. /app/admin/impersonate  → site_admin busca usuario y entra como él; banner 
   amarillo permanente "Suplantando a X. Salir". Audit log.

3. Búsqueda global con Cmd+K (shadcn Command Palette):
   - Indexa en Meilisearch o Postgres FTS: vehicles (vin, fleet_id, plate), 
     users (email, full_name), organizations (name), work_orders (ro_number).
   - Resultado agrupado con quick actions.

4. Dark mode con Tailwind 4 + next-themes. Toggle en navbar.

5. i18n con next-intl. Español + inglés. Strings del backend también 
   traducidos para emails/sms.

6. PWA manifest en /apps/web/public/manifest.json. Service worker con 
   next-pwa para cache offline de la última inspección en draft.

7. Onboarding: primera vez que un DSP entra, tour de 4 pasos con Intro.js 
   o Shepherd (o componente custom).
```

### Fase 8 — Deploy + observabilidad (Hostinger VPS + EasyPanel)

> **Stack de deploy decidido:** Hostinger VPS (Ubuntu 22.04) + EasyPanel (panel Docker self-hosted).
> Reemplaza Fly.io/Railway. Razones: control total de costos, sin cold starts, PostgreSQL y Redis
> gestionados en el mismo panel, SSL automático vía Traefik + Let's Encrypt.

**Prompt para Claude Code:**
```
Prepara el deploy a producción en Hostinger VPS + EasyPanel.

══════════════════════════════════════════
A. SETUP INICIAL DEL VPS (una sola vez — hacerlo antes de correr este prompt)
══════════════════════════════════════════

VPS mínimo requerido:
  - Ubuntu 22.04 LTS
  - 4 vCPU / 8 GB RAM / 100 GB SSD NVMe
  - Plan recomendado: Hostinger KVM 4 o KVM 8

Instalación de EasyPanel:
  curl -sSL https://easypanel.io/install.sh | sh
  # Acceder en http://<vps-ip>:3000
  # Configurar dominio personalizado + Let's Encrypt desde el panel

Servicios a crear en EasyPanel (en este orden):
  1. PostgreSQL 16  → template built-in
       POSTGRES_DB=nova, POSTGRES_USER=nova, POSTGRES_PASSWORD=<secret>
       Volumen: /data/postgres (persistente)
  2. Redis 7        → template built-in (solo red interna, sin puerto público)
  3. API            → tipo "App / Docker"
       Build desde ./apps/api
       Puerto interno: 8000
       Health check: GET /health
       Dominio: api.tu-dominio.com (EasyPanel genera SSL)
  4. Web            → tipo "App / Docker"
       Build desde ./nova-fora-demo
       Puerto interno: 80
       Dominio: app.tu-dominio.com (EasyPanel genera SSL)

══════════════════════════════════════════
B. DOCKERFILES
══════════════════════════════════════════

1. API — apps/api/Dockerfile (multi-stage, < 300 MB):

  FROM python:3.12-slim AS builder
  WORKDIR /app
  COPY pyproject.toml uv.lock ./
  RUN pip install uv && uv sync --frozen --no-dev

  FROM python:3.12-slim
  WORKDIR /app
  COPY --from=builder /app/.venv /app/.venv
  COPY . .
  ENV PATH="/app/.venv/bin:$PATH"
  EXPOSE 8000
  HEALTHCHECK --interval=30s --timeout=5s \
    CMD curl -f http://localhost:8000/health || exit 1
  ENTRYPOINT ["sh", "entrypoint.sh"]

  # apps/api/entrypoint.sh:
  #!/bin/sh
  set -e
  # Migrations con advisory lock (previene race entre containers)
  python -m alembic upgrade head
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2

2. Frontend (Vite SPA → nginx) — nova-fora-demo/Dockerfile:

  FROM node:22-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  ARG VITE_API_BASE_URL
  ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
  RUN npm run build

  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80

  # nova-fora-demo/nginx.conf:
  server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — React Router no existe aquí pero por si acaso
    location / {
      try_files $uri $uri/ /index.html;
    }

    # Headers de seguridad
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    add_header Content-Security-Policy
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
       img-src 'self' data: blob: https:; connect-src 'self' https://api.tu-dominio.com;
       font-src 'self' data:;";

    # Gzip
    gzip on;
    gzip_types text/html application/javascript application/json text/css;
  }

3. docker-compose.dev.yml (desarrollo LOCAL — no es el de producción):

  services:
    postgres:
      image: postgres:16
      environment:
        POSTGRES_DB: nova
        POSTGRES_USER: nova
        POSTGRES_PASSWORD: dev_pass
      volumes:
        - postgres_data:/var/lib/postgresql/data
      ports: ["5432:5432"]

    redis:
      image: redis:7-alpine
      ports: ["6379:6379"]

    api:
      build: ./apps/api
      environment:
        DATABASE_URL: postgresql+asyncpg://nova:dev_pass@postgres/nova
        REDIS_URL: redis://redis:6379
        JWT_SECRET: dev_secret_change_in_prod
        S3_ENDPOINT: http://minio:9000
        S3_BUCKET: nova-dev
        S3_ACCESS_KEY: minioadmin
        S3_SECRET_KEY: minioadmin
      ports: ["8000:8000"]
      depends_on: [postgres, redis, minio]
      volumes:
        - ./apps/api:/app  # hot reload

    minio:
      image: minio/minio
      command: server /data --console-address ":9001"
      environment:
        MINIO_ROOT_USER: minioadmin
        MINIO_ROOT_PASSWORD: minioadmin
      ports: ["9000:9000", "9001:9001"]
      volumes:
        - minio_data:/data

    web:
      build:
        context: ./nova-fora-demo
        args:
          VITE_API_BASE_URL: http://localhost:8000
      ports: ["5173:80"]

  volumes:
    postgres_data:
    minio_data:

══════════════════════════════════════════
C. HEALTH CHECKS, MONITORING, SEGURIDAD
══════════════════════════════════════════

4. Health endpoints en FastAPI (apps/api/app/routes/health.py):

  GET /health       → 200 {"status": "ok"}             (liveness)
  GET /health/ready → 200 {"db": "ok", "redis": "ok"}  (readiness)
                       503 si DB/Redis no responden

  EasyPanel usa /health por defecto para restart automático.

5. Sentry SDK:
  pip install sentry-sdk[fastapi]
  # En app/main.py:
  import sentry_sdk
  sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.1,
                  environment=settings.ENV)

6. Logs JSON estructurados → stdout (Docker captura, EasyPanel muestra en UI):
  pip install structlog
  # Cada request loguea: request_id, user_id, duration_ms, status_code

7. PostHog en frontend (nova-fora-demo/index.html, antes del </head>):
  <script>!function(t,e){...}(window, document)</script>
  # Eventos clave:
  posthog.capture('inspection_submitted', {dsp_id, vehicle_id})
  posthog.capture('work_order_status_changed', {wo_id, from_status, to_status})
  posthog.capture('export_downloaded', {type: 'xlsx', filter})

══════════════════════════════════════════
D. CI/CD VÍA GITHUB ACTIONS + SSH
══════════════════════════════════════════

8. Archivo .github/workflows/deploy.yml:

  name: Deploy to Hostinger VPS
  on:
    push:
      branches: [main]

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - name: Test API
          run: |
            cd apps/api
            pip install uv && uv sync
            pytest --tb=short -q
        - name: Build frontend (smoke test)
          run: |
            cd nova-fora-demo
            npm ci && npm run build

    deploy:
      needs: test
      runs-on: ubuntu-latest
      steps:
        - name: Deploy via SSH
          uses: appleboy/ssh-action@v1
          with:
            host: ${{ secrets.VPS_HOST }}
            username: ${{ secrets.VPS_USER }}
            key: ${{ secrets.VPS_SSH_KEY }}
            script: |
              cd /opt/nova-fleet
              git pull origin main
              # Rebuild solo los servicios que cambiaron
              docker compose -f docker-compose.prod.yml up -d --build api web
              # Limpieza de imágenes antiguas
              docker system prune -f --filter "until=24h"

  Secrets en GitHub: VPS_HOST, VPS_USER, VPS_SSH_KEY (clave privada ed25519)

══════════════════════════════════════════
E. RATE LIMITING, BACKUPS, RUNBOOK
══════════════════════════════════════════

9. Rate limiting (Redis-backed):
  pip install fastapi-limiter
  # En app/main.py, startup event:
  await FastAPILimiter.init(redis_connection)
  # En rutas anónimas: Depends(RateLimiter(times=60, seconds=60))
  # En rutas auth: Depends(RateLimiter(times=600, seconds=60))

10. HSTS en nginx (solo cuando SSL está activo):
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    # EasyPanel termina SSL en Traefik; el nginx interno solo hace HTTP.
    # Configurar HSTS en Traefik middlewares desde el panel de EasyPanel.

11. Backups PostgreSQL diarios:
    # Agregar al crontab del VPS (crontab -e):
    0 3 * * * docker exec nova-postgres pg_dump -U nova nova \
      | gzip > /backups/nova_$(date +\%Y\%m\%d).sql.gz
    # Retener 30 días:
    0 4 * * * find /backups -name "nova_*.sql.gz" -mtime +30 -delete
    # Sincronizar a Hostinger Object Storage o S3 (opcional):
    0 5 * * * aws s3 sync /backups s3://nova-backups/ --delete

Documenta en /docs/runbook.md:

  ## Conectar al VPS
  ssh user@<vps-ip>
  # O con llave: ssh -i ~/.ssh/nova_vps user@<vps-ip>

  ## Ver logs en vivo
  docker logs nova-api -f --tail 100
  docker logs nova-web -f --tail 50

  ## Rollback de emergencia
  ssh vps
  cd /opt/nova-fleet
  git log --oneline -10          # ver commits recientes
  git checkout <commit-hash>
  docker compose -f docker-compose.prod.yml up -d --build api
  git checkout main              # volver cuando el fix esté en main

  ## Rotar JWT secret (invalida todas las sesiones activas)
  # 1. Cambiar JWT_SECRET en EasyPanel env vars del servicio 'api'
  # 2. Restart del servicio (EasyPanel → servicio → Restart)
  # Advertencia: todos los usuarios deberán volver a hacer login.

  ## Backup manual
  docker exec nova-postgres pg_dump -U nova nova > /tmp/nova_manual.sql
  scp user@<vps-ip>:/tmp/nova_manual.sql ./

  ## Ver DB directamente (psql)
  docker exec -it nova-postgres psql -U nova nova

  ## Resetear contraseña de usuario (emergencia)
  docker exec -it nova-api python -m app.cli reset-password user@email.com
```

---

## 5. Qué NO tocar en la v1 del rebuild

Para no bloquear el launch:
- RFP/bidding (/rfp-dashboard de nova4a): es un producto adyacente; portarlo en v2.
- Subcontract chain profunda (>2 niveles): la estructura soporta el grafo pero la UI la dejamos plana.
- SSO con SAML: solo magic links + TOTP al inicio.
- Mobile nativa (iOS/Android): la PWA es suficiente para fase 1.

---

## 6. Métricas de éxito del rebuild

Después de 90 días en prod, apuntamos a:
- **Time-to-first-inspection** (driver abre app → inspección enviada): < 3 min (nova4a actual ≈ 6-8 min).
- **API p95 latency**: < 300ms (nova4a actual parece > 1s en varios endpoints).
- **Lighthouse mobile score**: > 90 en todas las rutas core.
- **NPS interno del DSP + Vendor**: > 40.
- **Export self-service**: 100% de los datos que hoy requieren scraping son exportables desde la UI.

---

## 7. Plan alternativo: **mejoras incrementales sobre nova4a actual** (sin rebuild)

Si el equipo decide **no reescribir desde cero** y solo iterar sobre la app existente, esta sección es la lista priorizada. Cada item tiene **esfuerzo aproximado** (S=1d, M=2-5d, L=1-3sem, XL=>3sem) y **riesgo** (Low/Med/High de romper algo).

> **Cuándo elegir este camino:** cuando hay clientes pagando hoy, runway corto, o el equipo no tiene capacidad para correr dos sistemas en paralelo durante 3-6 meses.
> **Cuándo NO:** cuando la deuda técnica del frontend (Jinja+HTMX+jQuery+Selectize+Nunjucks) ya bloquea features nuevos, o cuando los DSPs piden cosas que el modelo actual no soporta (filtro por fecha global, multi-tenancy real entre vendors).

### 7.1 Quick wins (semana 1-2) — Esfuerzo S, Riesgo Low

1. **Fix de la inconsistencia summary card vs lista en `/work_orders`** (sección 2.6.3)
   - El card top muestra org-level pero la lista es personal para techs. Cambiar el endpoint del summary para que respete el mismo filtro de la lista.
   - Esfuerzo: S | Riesgo: Low.

2. **Sidebar consistente con permisos** — agregar `/dsp-dashboard` al sidebar para vendors que tengan `fleet_manager` (o quitar el permiso si no debe verlo).
   - S | Low.

3. **Tooltip en cada badge de status** — los usuarios nuevos no entienden "Pending FMC", "Stale", "Rush Order". Agregar `title=""` con explicación.
   - S | Low.

4. **Botón "Export to CSV" en `/work_orders` y `/real_dvic`** — usa los datos ya cargados en la página + BlobURL. No requiere endpoint nuevo.
   - S | Low.

5. **Filter por fecha en `/real_dvic` y `/work_orders`** — extender el `filter_by` selectize con date range picker. El backend ya tiene `created_at` en BD; agregar params `date_from` / `date_to`.
   - M | Low.

6. **Confirmación destructiva en Bulk Upload Vehicles** — antes de aplicar, mostrar dialog "Esto desactivará N vehículos: [lista]. Confirmar?".
   - S | Low.

7. **Edit Vehicle: deshabilitar el "lápiz por campo"** — abrir todos los campos editables al darle Edit (un solo botón global). El UX actual es anti-patrón documentado.
   - S | Low.

### 7.2 Mejoras de impacto medio (mes 1-2) — Esfuerzo M, Riesgo Med

8. **Carrusel de fotos con thumbnails y categorización**
   - Hoy las fotos son una lista anónima. Agregar tag por foto (`category: ODOMETER | DAMAGE | OVERVIEW | OTHER`) — campo nuevo en tabla `photos`.
   - UI: tabs en el carrusel por categoría; el odómetro siempre destacado primero.
   - Migración: backfill con heurística simple (la primera foto de la inspección suele ser odómetro).
   - M | Med.

9. **Mileage en la inspección, no en el WO**
   - Mover `last_mileage` de `work_order` a `vehicle_inspection.odometer_miles`.
   - Worker que migra histórico: para cada inspección, toma el `last_mileage` del primer WO asociado.
   - WOs siguen exponiendo `last_mileage` por compatibilidad pero como propiedad derivada (lookup al inspection).
   - L | Med (afecta a varios endpoints; correr dual-write durante 1 semana).

10. **OCR de odómetro** (worker async)
    - Trigger: cuando se sube una foto categorizada como ODOMETER.
    - Stack: Tesseract en worker Celery + Pillow para preprocessing.
    - Si confidence > 0.8 y digit count entre 4-7, autocompletar el campo `odometer_miles`. Marcar `odometer_source = OCR`.
    - L | Med.

11. **Bulk actions en /work_orders**
    - Tab "Seleccionar" ya existe pero no hace mucho. Implementar: checkbox por card, footer con "Accept selected" / "Decline selected" / "Assign to..." / "Export selected".
    - M | Med.

12. **Búsqueda global Cmd+K**
    - Indexar en Postgres FTS: vehicles (vin, fleet_id, plate), users (email, name), orgs (name), WOs (ro_number).
    - Componente cmdk en JS vanilla (no requiere React). Bind a `Cmd+K` / `Ctrl+K`.
    - M | Med.

13. **Notificaciones agrupadas + bulk-dismiss + filter por tipo**
    - El badge "6048" actual es inutilizable. Agrupar por tipo (ej. "23 Work Orders Approved this week") con expand/collapse.
    - Endpoint nuevo: `POST /api/notifications/dismiss-all?type=work_approved`.
    - M | Med.

14. **2FA (TOTP) opcional**
    - Dado el dominio (talleres mecánicos manejan VINs, mileage, datos de Amazon), el password-only es insuficiente.
    - Agregar `/admin/security` con QR para Google Authenticator. Validar en login si `user.totp_secret IS NOT NULL`.
    - M | Med.

15. **Dark mode**
    - Bootstrap 5 ya soporta `data-bs-theme="dark"` desde 5.3 (actualizar de 5.2.3). Toggle en navbar persistido en cookie.
    - M | Low.

### 7.3 Refactors técnicos (mes 2-4) — Esfuerzo L, Riesgo Med-High

16. **Eliminar Nunjucks client-side, dejar solo Jinja server-side**
    - Hoy hay duplicación. Definir qué se renderiza dónde y borrar el otro.
    - L | High (riesgo de romper componentes que dependen del flujo client).

17. **Reemplazar Moment.js por date-fns o Intl**
    - Bundle savings: ~250kb gzipped.
    - L | Low (refactor mecánico).

18. **Reemplazar Selectize.js por Tom Select** (drop-in compatible y mantenido)
    - L | Low.

19. **Endpoints REST consistentes**
    - Reemplazar `/api/work_order?id=X` por `/api/work_orders/{id}` (REST puro).
    - Mantener los antiguos como deprecated 6 meses con header `Sunset:`.
    - L | Med.

20. **Dual-engine Pydantic + marshmallow → solo Pydantic**
    - Si están usando ambos, consolidar.
    - M | Med.

21. **Schema de DB explícito**: extraer a Alembic (si no está) y revisar índices faltantes (vimos que `/api/work_order?page=617` toma >1s — falta index en `created_at`).
    - M | Med.

22. **Build pipeline**: Vite o esbuild para los assets de `/static/`. Hoy parece que se sirven raw → no hay tree shaking ni minification por feature.
    - M | Med.

### 7.4 Features que el modelo actual permite agregar sin redo (mes 3-6) — L

23. **Sign-up self-service diferenciado** (flujos A y B de sección 2.8)
    - Implementable sobre el stack actual con nuevos endpoints + páginas Jinja. Reusa el modelo existente (User + Organization + UserRole booleanos).
    - **Beneficio crítico:** desbloquea growth orgánico, hoy todo el onboarding parece manual.
    - L | Med.

24. **Filtro por fecha en endpoints API**
    - Agregar `date_from` / `date_to` a `/api/work_order` y nuevo `/api/inspections?date_from=&date_to=`. El usuario de este hilo lo necesitó para sacar el Excel y fue scraping HTML.
    - M | Low.

25. **Export endpoints nativos**: `GET /api/work_order/export?format=xlsx&filter_by=...` que devuelve el archivo armado. Reemplaza el scraping.
    - M | Low.

26. **Sign-up por invitación con magic link real** (flujo C de 2.8)
    - El "Add User" actual del DSP/Vendor crea cuentas con password placeholder (presumiblemente). Cambiar a magic link → mejora seguridad y onboarding.
    - L | Med.

27. **Webhook out** para integraciones de DSP (ej. cuando un WO cierra → POST a su Slack/Teams). Empezar con 3-4 eventos clave.
    - L | Low.

28. **Real DVIC mobile-first redesign** (CSS-only)
    - Sin tocar backend. Solo refactorizar templates Jinja con clases responsive. Inspector usa móvil al hacer la inspección — hoy no es usable.
    - L | Med.

### 7.5 Anti-recommendations (lo que NO conviene parchar)

- ❌ **Microservicios** sobre el monolito Flask actual. Deuda > beneficio.
- ❌ **Migrar el ORM** (si es SQLAlchemy clásico → SQLAlchemy 2.0 async). Riesgo enorme, beneficio marginal en este tipo de app.
- ❌ **Migrar a otra DB** (Postgres → otra). Si funciona, no se toca.
- ❌ **Frontend SPA dentro de Jinja** (meter React parcial dentro de páginas Jinja). Crea Frankenstein. Si vas a SPA, vas full SPA (= rebuild).
- ❌ **Reemplazar HTMX por algo "más moderno"** (htmx funciona y es la pieza menos problemática del stack).

### 7.6 Decision tree práctico

```
¿Hay clientes pagando ahora?
├── Sí → ¿La app crashea / pierde datos / bloquea growth?
│        ├── No → Seguir con secciones 7.1 + 7.2 (quick wins + impacto medio)
│        └── Sí → Evaluar rebuild paralelo (secciones 3-6) + maintenance mode 
│                 en nova4a actual
└── No (early stage / pre-launch) → Rebuild directo (secciones 3-6)
```

### 7.7 Cómo medir si las mejoras incrementales están funcionando

Tras 90 días de iteraciones de 7.1+7.2:
- **Tickets de soporte sobre "no encuentro mis datos / no puedo exportar"** debe bajar 80%.
- **Tiempo del técnico para completar un WO** (medible por `created_at` → `completed_at` del WO en estado `In_progress`) debe bajar 30%.
- **Adopción de filter por fecha** (custom event en frontend) debe llegar a >60% de los usuarios activos.
- Si NO se mueven estos números, el problema es estructural y conviene el rebuild de secciones 3-6.

---

## 8. Apéndice — Datos recolectados durante el reconocimiento

### Organizaciones vistas (sesión 2026-04-15)

| id | nombre | tipo | default_pm_vendor |
|---|---|---|---|
| 37 | Total Package Delivery | DSP | — |
| 14 | TOTL | DSP | — |
| 13 | DESTIN LOGISTICS LLC | DSP | — |
| 9  | Robertson Logistics LLC | DSP | — |
| 11 | TJIII Logistics | DSP | Dulles Midas |
| 15 | PLADcloud, LLC | DSP | KevinautorepairLLC |
| 24 | REJ Enterprises | DSP | — |
| 52 | Ribrell 21 | DSP | — |
| 50 | AGILE LOGISTICS MANAGEMENT | DSP | — |
| 38 | Silkway Express | DSP | — |
| 2  | Ceiba Routes | DSP | — |
| 36 | Dulles Midas | VENDOR | — |

### FMCs vistas
Wheels (id 2), Element (id 3), Rented/Owned (id 3 también? probable bug).

### Vehicle classes vistas
Branded Cargo (id 1), Rental (id 3).

### Ejemplo real de response `/api/inspection?id=47330`
```json
{
  "inspection": {
    "id": 47330,
    "created_at": "2026-04-15 07:41:35.947109Z",
    "vehicle": { "id": 955, "fleet_id": "PR006" },
    "reported_defects": [7 items],
    "photos": [7 items],
    "inspection_incomplete_reason": null
  }
}
```
(Nota: el vehicle solo trae id + fleet_id, forzando N+1 para datos extra. Nueva API debe permitir expand=vehicle.full.)

### Ejemplo real de response `/api/work_order?id=42958`
```json
{
  "work_order": {
    "id": 42958,
    "created_at": "2026-04-15 07:47:41.301416Z",
    "status": "Pending FMC",
    "last_mileage": "99597",
    "dsp": { "name": "Ribrell 21" },
    "vendor": { "name": "Dulles Midas" },
    "vehicle": { "fleet_id": "PR006", ... },
    ...
  }
}
```

---

## 9. Frontend demo existente — Estrategia de integración con el backend

> **Contexto:** existe ya un frontend demo funcional en `nova-fora-demo/` (React 19 + Vite 8 + Tailwind 4,
> JSX sin TypeScript). Todos los datos están mockeados en `src/data/mockData.js`. El backend FastAPI
> debe adaptarse a las shapes de datos que ya espera el frontend — NO al revés.
> Esto reduce el tiempo de integración de semanas a días.

### 9.1 Stack real del frontend (no Next.js 15)

El demo usa:
- **React 19.2.4** + **Vite 8.0.4** (SPA, no SSR)
- **JSX** (sin TypeScript — no migrar antes de Jun 15)
- **Tailwind CSS 4** via `@tailwindcss/vite`
- **Framer Motion 12** (animaciones)
- **Recharts 3** (gráficas de dashboard)
- **Lucide React** (iconos)
- **localStorage** para auth session (reemplazar con JWT)

> **Decisión de arquitectura:** el plan original asumía Next.js 15 (App Router). Para la fecha
> límite Jun 15, 2026, mantenemos el Vite/React demo existente. Next.js queda como upgrade
> en v2.1 post-launch si el equipo lo decide.

### 9.2 Roles y cuentas demo (fuente de verdad)

| Usuario | Org | Rol | OrgType |
|---|---|---|---|
| Tamika Gambrell | Ribrell 21 | dsp_owner | dsp |
| Olger Joya | Dulles Midas | vendor_admin | vendor |
| David Torres | Dulles Midas | technician | vendor |
| Maria Chen | Nova Fora | site_admin | platform |

### 9.3 Formato de IDs — regla de compatibilidad

El frontend demo usa IDs con prefijo string. El backend DEBE respetar este formato
en todas las respuestas JSON (serializar con prefijo):

| Entidad | Formato en frontend | Implementación backend |
|---|---|---|
| Vehicle | `VAN-1042` | `f"VAN-{vehicle.id:04d}"` |
| DSP org | `DSP-4201` | `f"DSP-{org.id:04d}"` |
| Vendor org | `V-001` | `f"V-{org.id:03d}"` |
| Work Order | `WO-54001` | `f"WO-{wo.id:05d}"` |
| Defect | `FD-123` | `f"FD-{defect.id:03d}"` |
| User | string UUID o int | `str(user.id)` |

Implementar en SQLModel con `@property id_str` + custom JSON serializer.

### 9.4 Shapes de respuesta que el frontend ya espera

**Vehicle:**
```json
{
  "id": "VAN-1042",
  "dspId": "DSP-4201",
  "dsp": "Ribrell 21",
  "model": "2021 Mercedes Sprinter",
  "plate": "WA-3K18-AZ",
  "vin": "...",
  "year": 2021,
  "make": "Mercedes",
  "defectCount": 3,
  "severity": "medium",
  "lastInspected": "Today, 6:15 AM",
  "inspector": "Marcus Green",
  "grounded": false,
  "mileage": 86209,
  "photos": 7
}
```

**Work Order:**
```json
{
  "id": "WO-54001",
  "roNumber": "RO-2026-8142",
  "dspId": "DSP-4201",
  "dspName": "Ribrell 21",
  "vehicleId": "VAN-1042",
  "plate": "WA-3K18-AZ",
  "section": "1. Front Side",
  "part": "Windshield",
  "description": "...",
  "severity": "High",
  "status": "pending",
  "flags": ["rush_order"],
  "lastMileage": 86209,
  "reportedBy": "Marcus Green (DA-1001)",
  "assignedTechnician": null,
  "vendorId": "V-001",
  "fmc": "Wheels",
  "createdAt": "2026-04-15T07:15:23Z",
  "scheduledAt": null,
  "notes": [],
  "photos": 3
}
```

**Nota:** los campos en camelCase en el frontend vienen de JSON snake_case del backend.
FastAPI devuelve snake_case → agregar en el cliente JS una función `toCamel(obj)` o
configurar alias en el model Pydantic:
```python
class Config:
    alias_generator = to_camel
    populate_by_name = True
```

### 9.5 Módulo API client a crear en el frontend

Crear `nova-fora-demo/src/api/client.js`:

```javascript
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Token storage
const getToken = () => localStorage.getItem('nova_access_token');
const setToken = (t) => localStorage.setItem('nova_access_token', t);
const clearToken = () => localStorage.removeItem('nova_access_token');

export async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/';    // redirect a login
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.status === 204 ? null : res.json();
}

export const auth = {
  login: (email, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => apiFetch('/auth/me'),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  impersonate: (userId) => apiFetch('/auth/impersonate', { method: 'POST',
    body: JSON.stringify({ user_id: userId }) }),
};

export const vehicles = {
  list: (params) => apiFetch(`/vehicles?${new URLSearchParams(params)}`),
  get: (id) => apiFetch(`/vehicles/${id}`),
};

export const workOrders = {
  list: (params) => apiFetch(`/work-orders?${new URLSearchParams(params)}`),
  get: (id) => apiFetch(`/work-orders/${id}`),
  transition: (id, action, body = {}) =>
    apiFetch(`/work-orders/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) }),
};

export const inspections = {
  list: (params) => apiFetch(`/inspections?${new URLSearchParams(params)}`),
  get: (id) => apiFetch(`/inspections/${id}`),
  create: (body) => apiFetch('/inspections', { method: 'POST', body: JSON.stringify(body) }),
  exportXlsx: (params) => {
    const url = `${BASE_URL}/inspections/export?${new URLSearchParams(params)}`;
    window.open(url, '_blank');
  },
};

export { setToken, clearToken, getToken };
```

### 9.6 Pasos para migrar cada componente de mock → API real

Para cada componente JSX, el patrón es siempre el mismo:

```javascript
// ANTES (mock):
import { mockWorkOrders } from '../data/mockData';
const [workOrders, setWorkOrders] = useState(mockWorkOrders);

// DESPUÉS (API):
import { workOrders as woApi } from '../api/client';
const [workOrders, setWorkOrders] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  woApi.list({ vendor_id: user.orgId, status: activeFilter })
    .then(data => setWorkOrders(data.items))
    .catch(err => setError(err.message))
    .finally(() => setLoading(false));
}, [activeFilter, user.orgId]);
```

Agregar `loading` y `error` states a todos los componentes.
Usar Framer Motion `AnimatePresence` para el skeleton loader (ya está instalado).

Orden recomendado de migración (de menor a mayor dependencia):
1. `Login.jsx` → `/auth/login` + `/auth/me`
2. `MyVehicles.jsx` → `/vehicles`
3. `RealDVIC.jsx` → `/dashboard/dsp` + `/inspections`
4. `WorkOrders.jsx` → `/work-orders`
5. `Defects.jsx` → `/defects`
6. `FleetSnapshot.jsx` → `/dashboard/vendor`
7. `VendorScorecard.jsx` → `/scorecard/{vendorId}`
8. `AdminPanel.jsx` → `/admin/users` + `/admin/settings`
9. `GhostMode.jsx` → `/auth/impersonate`
10. `NotificationsPanel.jsx` → `/notifications`

---

## 10. Plan de sprints — Global Test Jun 15, 2026

> **Fecha actual:** 24 Apr 2026 · **Días disponibles:** 52 · **Target:** 15 Jun 2026
>
> Este plan es honesto. No es optimista. Asume 1 desarrollador senior a tiempo completo
> (~8h/día de trabajo productivo). Si hay 2 desarrolladores, los tiempos se reducen un 40%
> y se puede incluir más features del backlog.

### 10.0 Premisa crítica

El frontend demo ya existe y es funcional. El trabajo de build de UI está HECHO.
Lo que queda:
- ✅ Backend FastAPI desde cero (el trabajo más grande)
- ✅ Wiring frontend → API (reemplazar mockData)
- ✅ Infra en Hostinger VPS + EasyPanel
- ✅ Auth real (JWT reemplaza localStorage)
- ✅ Base de datos real (PostgreSQL 16)

### 10.1 Semana 1 — Apr 24–30: Fundación e Infraestructura

| Día | Tarea | Entregable |
|---|---|---|
| Jue 24 | Comprar/configurar VPS Hostinger KVM 4+. Instalar EasyPanel. Configurar dominio. | Panel EasyPanel accesible en https://panel.tu-dominio.com |
| Vie 25 | PostgreSQL 16 + Redis 7 corriendo en EasyPanel. Crear repo GitHub. CI skeleton. | `curl https://api.tu-dominio.com/health` → 200 |
| Sáb 26 | FastAPI skeleton: estructura de carpetas, pyproject.toml, uv, settings. | `uvicorn` corre localmente |
| Dom 27 | SQLModel base models: Organization, User, Vehicle, Inspection, WorkOrder, Defect, Photo | Alembic `initial_migration` generada |
| Lun 28 | Alembic migrations aplicadas en prod. Docker API imagen. GitHub Actions deploy. | Primera imagen deployada en EasyPanel |
| Mar 29 | Vite frontend: agregar `VITE_API_BASE_URL` + crear `src/api/client.js` | Frontend buildea sin errores |
| Mié 30 | Dockerfile frontend (nginx). Servir build estático en EasyPanel. | `https://app.tu-dominio.com` carga el demo |

**✅ Checkpoint Semana 1:** VPS live. PostgreSQL vacío. Frontend estático en prod. CI/CD corriendo.

---

### 10.2 Semana 2 — May 1–7: Auth + Usuarios + Organizaciones

| Día | Tarea |
|---|---|
| Jue 1 | `POST /auth/login` (email+password, devuelve JWT access + refresh token) |
| Vie 2 | `POST /auth/refresh`, `POST /auth/logout`, middleware JWT, `GET /auth/me` |
| Sáb 3 | Tabla users seed: Tamika, Olger, David, Maria (los 4 del demo). Prueba login real. |
| Dom 4 | `GET /users`, `PATCH /users/{id}`, cambio de password |
| Lun 5 | `GET /organizations`, `POST /organizations`, `PATCH /organizations/{id}` |
| Mar 6 | `GET /organizations/{id}/users`, roles por org (dsp_owner/vendor_admin/tech/site_admin) |
| Mié 7 | **Wiring Login.jsx → API.** Reemplazar localStorage demo con JWT real. `GET /auth/me` al init. |

**✅ Checkpoint Semana 2:** login real funciona con usuario en DB. JWT almacenado. Navegación según rol.

---

### 10.3 Semana 3 — May 8–14: Vehículos + Inspecciones Backend

| Día | Tarea |
|---|---|
| Jue 8 | `GET /vehicles?dsp_id&page&search`, `POST /vehicles`, `PATCH /vehicles/{id}` |
| Vie 9 | `GET /vehicles/{id}` (detalle: last inspection, open WOs count, mileage) |
| Sáb 10 | `POST /inspections` (draft), `PATCH /inspections/{id}`, `POST /inspections/{id}/submit` |
| Dom 11 | `GET /inspections?date=&dsp_id=&vehicle_id=&page`, `GET /inspections/{id}` (full detail) |
| Lun 12 | `POST /inspections/{id}/defects` (array de defectos por sección), `GET /defect-catalog` |
| Mar 13 | `POST /inspections/{id}/photos` (upload → presigned S3/MinIO URL) |
| Mié 14 | **Wiring MyVehicles.jsx → `/vehicles`.** Lista real de vehículos con paginación. |

**✅ Checkpoint Semana 3:** puedo crear inspección completa con defectos y fotos via Postman.

---

### 10.4 Semana 4 — May 15–21: Work Orders FSM + Wiring

| Día | Tarea |
|---|---|
| Jue 15 | `POST /defects/{id}/work-orders` (DSP crea WO). `GET /work-orders?vendor_id=&status=&date_from=&date_to=` |
| Vie 16 | `POST /work-orders/{id}/accept`, `/decline`, `/assign`, `/start` (FSM transitions) |
| Sáb 17 | `POST /work-orders/{id}/complete` (tech, actualiza mileage), `/approve`, `/reject` |
| Dom 18 | Bulk: `POST /work-orders/bulk/accept`, `/bulk/assign` |
| Lun 19 | **Wiring WorkOrders.jsx → `/work-orders`.** Lista + filtros + transitions funcionando. |
| Mar 20 | **Wiring Defects.jsx → `/defects`.** Tabla con status real. |
| Mié 21 | **Wiring RealDVIC.jsx (parte 1) → `/inspections` del día.** |

**✅ Checkpoint Semana 4:** ciclo completo en producción: login DSP → ver vehículo → WO pending → tech completa → DSP aprueba.

---

### 10.5 Semana 5 — May 22–28: Dashboard + Reportería + FleetSnapshot

| Día | Tarea |
|---|---|
| Jue 22 | `GET /dashboard/dsp?date=` (inspection compliance %, grounded count, open WOs por tier, top defects) |
| Vie 23 | `GET /dashboard/vendor` (WOs pendientes + SLA, throughput, rush orders) · `GET /dashboard/admin` |
| Sáb 24 | `GET /reports/inspections?date_from=&date_to=&dsp_id=` con XLSX download (`openpyxl`) |
| Dom 25 | `GET /reports/work-orders?...` con XLSX download |
| Lun 26 | **Wiring FleetSnapshot.jsx → `/dashboard/vendor`.** Heatmap de fleet con datos reales. |
| Mar 27 | **Wiring RealDVIC.jsx (parte 2) → `/dashboard/dsp`.** Métricas, charts, grounded list. |
| Mié 28 | **Wiring VendorScorecard.jsx → `/scorecard/{vendorId}`.** |

**✅ Checkpoint Semana 5:** DSP puede exportar inspecciones de la semana a XLSX desde la UI.

---

### 10.6 Semana 6 — May 29–Jun 4: Admin + Invitaciones + Notificaciones

| Día | Tarea |
|---|---|
| Jue 29 | `GET/PATCH /admin/settings` (PM intervals, defect catalog per org) |
| Vie 30 | `GET /admin/users`, `PATCH /admin/users/{id}` (role, status), `DELETE /admin/users/{id}` (soft) |
| Sáb 31 | Invitation flow: `POST /organizations/{id}/invitations` → magic link por email (SMTP) |
| Dom 1 | `GET /invite/info?token=`, `POST /invite/accept` (crea user + JWT) |
| Lun 2 | Ghost mode: `POST /auth/impersonate/{userId}`, `POST /auth/exit-impersonate` + audit log |
| Mar 3 | **Wiring AdminPanel.jsx → API.** User table real + invite dialog. |
| Mié 4 | `GET/POST /notifications`, `PATCH /notifications/{id}/read`, in-app badge count (Redis) |

**✅ Checkpoint Semana 6:** site admin crea nuevo DSP, invita usuario por email, usuario acepta y hace su primera inspección.

---

### 10.7 Semana 7 — Jun 5–11: Hardening + Testing + Seguridad

| Día | Tarea |
|---|---|
| Vie 5 | Test e2e manual: ciclo completo DSP + Vendor + Technician. Log de bugs. |
| Sáb 6 | Fix bugs críticos del test e2e. |
| Dom 7 | Rate limiting (`fastapi-limiter`). CORS estricto (whitelist dominios). HSTS en Traefik. |
| Lun 8 | CSP headers en nginx. Sentry live en prod (error alerting). |
| Mar 9 | Índices SQL críticos: `created_at` en work_orders + inspections, `org_id` en users. |
| Mié 10 | Backup automático PostgreSQL (cron). MinIO → Hostinger Object Storage. |
| Jue 11 | Load test básico (locust, 50 users simultáneos, 10 min). Target: p95 API < 500ms. |

**✅ Checkpoint Semana 7:** zero 5xx en 50 usuarios. Sentry live. Backups corriendo.

---

### 10.8 Semana 8 — Jun 12–15: Global Test

| Día | Tarea |
|---|---|
| Vie 12 | Onboard piloto: Ribrell 21 (Tamika) + Dulles Midas (Olger). Datos reales importados. |
| Sáb 13 | Fix críticos del día de onboarding (bugs que los usuarios reales siempre encuentran). |
| Dom 14 | Email a beta testers con URL, credenciales, y guía de 1 página de qué probar. |
| Lun 15 | 🚀 **GLOBAL TEST — INICIO** |

---

### 10.9 Qué NO estará listo para Jun 15 (honesto — sin excusas)

Esto queda para v1.1 (Jul-Aug 2026):

| Feature | Por qué no cabe | ETA post-launch |
|---|---|---|
| OCR de odómetro (Tesseract) | Requiere ML setup + tuning; no crítico para test | Jul 15 |
| Realtime (Pusher/SSE) | Polling 30s es suficiente para beta | Jul 30 |
| PWA offline mode | No prioritario para test global | Aug |
| i18n backend (emails ES) | Frontend ya tiene ES; emails en EN suficiente | Aug |
| Rewards backend | Frontend muestra datos estáticos. No bloquea test | Aug |
| Body Repairs workflow completo | Solo CRUD básico | Aug |
| RFP dashboard | Producto separado; no tocar | Q4 2026 |
| TOTP 2FA | Email+password es suficiente para beta | Aug |
| SMS notifications (Twilio) | Solo email | Aug |
| TypeScript migration del frontend | No roto = no tocar | v2.0 |
| Multi-FMC complex workflows | Caso borde; 1 FMC cubre el 90% | Sep |

### 10.10 Riesgos y mitigaciones (sin suavizar)

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Compatibilidad ID format (VAN-XXX vs int) | Alta — el frontend asume strings | Alta — pantallas rotas | Implementar serialización con prefijo desde el día 1 (Sec. 9.3) |
| EasyPanel networking issues (primer setup) | Media | Media — 1-2 días perdidos | Tener docker-compose.prod.yml como fallback manual inmediato |
| 1 desarrollador = cuello de botella | Alta | Alta — timeline se extiende | Si hay retraso en Sem 3, cortar OCR y realtime antes de cortar el core |
| Auth magic link (email deliverability) | Media | Media — invites no llegan | Usar SMTP de Hostinger + SPF/DKIM configurado desde Sem 1 |
| Data migration legacy (si se importan datos de nova4a) | Media | Alta — corruption | Primero el test es con datos frescos (no migración) |
| VPS underperformance (4vCPU/8GB no suficiente) | Baja para <100 users | Alta si escala rápido | Monitor de recursos desde Sem 7; upgrade a KVM 8 cuesta <$30/mes más |

### 10.11 Definición de "listo para global test" (Jun 15)

La app está lista cuando un humano externo (que no conoce el sistema) puede:

1. ✅ Recibir un email de invitación, aceptarlo, y hacer login sin ayuda.
2. ✅ Ver la flota de vehículos de su DSP o Vendor.
3. ✅ Registrar una inspección con defectos (sin OCR, mileage manual).
4. ✅ Crear un Work Order desde un defecto.
5. ✅ El vendor acepta el WO, asigna al técnico.
6. ✅ El técnico completa el WO con fotos.
7. ✅ El DSP aprueba el WO.
8. ✅ Descargar un Excel de inspecciones del día.
9. ✅ El sitio no crashea con 20 usuarios simultáneos.
10. ✅ Hay HTTPS y no hay warnings de seguridad en el browser.

Si los 10 ítems pasan → la app va al test global.

---

**Fin del documento.** Actualizado: 2026-04-24 (sprint Jun 15 añadido).

Claude Code que implemente esto debe:
1. Leer Sección 9 antes de arrancar cualquier fase (shapes de IDs y API client).
2. Seguir el calendario de la Sección 10 semana a semana.
3. No saltarse el checkpoint de cada semana — es la única forma de saber si el Jun 15 es alcanzable.
4. Si una semana se retrasa 2+ días, reportar al humano inmediatamente con el impacto en la fecha final.
