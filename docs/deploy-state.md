# Estado del deploy — Nova Fora

> Última actualización: 2026-04-24 · **Semanas 1 + 2 completadas en día 1.**

## URLs en producción

| Servicio | URL | Status |
|---|---|---|
| **Frontend (web)** | https://nova-fora-web.vamj8y.easypanel.host | ✅ live |
| **API** | https://nova-fora-api.vamj8y.easypanel.host | ✅ live |
| **Docs (Swagger)** | https://nova-fora-api.vamj8y.easypanel.host/docs | ✅ live |
| **Health** | https://nova-fora-api.vamj8y.easypanel.host/health | ✅ 200 |
| **Ready (DB+Redis)** | https://nova-fora-api.vamj8y.easypanel.host/health/ready | ✅ 200 |
| **EasyPanel** | http://187.127.251.190:3000 | 🔐 admin only |

## Login demo (producción)

Abrir https://nova-fora-web.vamj8y.easypanel.host, elegir cualquier card,
click Sign In. Password: `nova2026!` (compartido entre los 4 usuarios).

| Role | Email | Dashboard visible |
|---|---|---|
| DSP Fleet Owner | tamika@ribrell21.com | Real DVIC + defects + rewards |
| Vendor Admin | olger@dullesmidas.com | Work orders + fleet snapshot + scorecard |
| Technician | david@dullesmidas.com | Work orders (assigned to me) |
| Site Admin | maria@novafora.com | Todo + Ghost mode |

## Infraestructura

- **VPS:** Hostinger KVM (187.127.251.190) · Ubuntu 22.04 · 32 GB RAM · 387 GB SSD
- **Panel:** EasyPanel (Docker Swarm + Traefik 3.6.7 + Let's Encrypt)
- **Project:** `nova-fora`
- **Network overlay:** `easypanel-nova-fora` (DNS interno entre servicios)

## Servicios activos en el stack

| Service (swarm) | Image | Purpose |
|---|---|---|
| `nova-fora_postgres` | `postgres:17` | DB principal — user `nova`, db `nova` |
| `nova-fora_redis` | `redis:7` | Cache + pub/sub (auth required) |
| `nova-fora_api` | `easypanel/nova-fora/api` (build from GitHub `apps/api/Dockerfile`) | FastAPI backend |
| `nova-fora_web` | `easypanel/nova-fora/web` (build from GitHub `nova-fora-demo/Dockerfile`) | React 19 + Vite + nginx:alpine |

## Source

- **GitHub repo:** https://github.com/AJPhygitalGroup/nova-fora
- **Branch deployado:** `main`
- **Auto-deploy:** ✅ activo (push a `main` re-deploya en ~1-3 min)
- **GitHub token:** fine-grained PAT con solo `Contents: Read` en `AJPhygitalGroup/nova-fora`. Expira en 1 año.

## Hostnames internos (DNS del swarm overlay)

Dentro de cualquier container del proyecto, estos hostnames resuelven:

- `nova-fora_postgres:5432` → PostgreSQL
- `nova-fora_redis:6379` → Redis
- `nova-fora_api:8000` → API FastAPI

## Variables de entorno configuradas en el servicio `api`

```
ENV=production
DATABASE_URL=postgresql+asyncpg://nova:<postgres_pass>@nova-fora_postgres:5432/nova
REDIS_URL=redis://:<redis_pass>@nova-fora_redis:6379
JWT_SECRET=<64-char hex>
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=30
APP_URL=http://187.127.251.190          # se actualiza cuando el frontend tenga dominio
API_URL=http://187.127.251.190
```

> Las passwords reales están en EasyPanel UI del servicio correspondiente (tab Environment).
> Para rotar: cambias la var en el servicio afectado → redeploy.

## Acceso SSH (operación / debug)

Desde el repo local:

```bash
ssh -i ~/.ssh/nova_vps root@187.127.251.190
```

La clave privada `nova_vps` vive en `C:\Users\Jorge\.ssh\nova_vps` — **nunca** se commitea.

## Comandos útiles vía SSH

```bash
# Ver servicios del swarm
docker service ls

# Logs del API (últimas 50 líneas)
docker service logs --tail 50 nova-fora_api

# Logs en vivo
docker service logs -f nova-fora_api

# Conectar a Postgres
docker exec -it $(docker ps -qf name=nova-fora_postgres) psql -U nova nova

# Reiniciar el API
docker service update --force nova-fora_api

# Ver env vars del API (sin secrets)
docker service inspect nova-fora_api \
  --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{.}}{{println}}{{end}}' \
  | grep -vE 'PASSWORD|SECRET'
```

## Semana 3 PR 1 + PR 3 — HECHO (Abr 24)

- [x] Modelo Vehicle (SQLModel) + migración `20260424_1930` aplicada
- [x] Endpoints `/vehicles` (GET list, GET by id, POST, PATCH) con role scoping
- [x] Accepts `VAN-XXXX` o int como path id
- [x] Soft-delete via `isActive: false`
- [x] Seed de 8 vans reales de Ribrell 21 (del scrape del 2026-04-15)
- [x] Frontend `MyVehicles.jsx` wired contra API real
- [x] Transform snake_case ↔ camelCase en cliente (bidireccional)
- [x] Loading splash + error state con retry en la UI

### Tabla vehicles en prod

| # | id_str | fleet_id | VIN | year | make | model | mileage | grounded |
|---|---|---|---|---|---|---|---|---|
| 1 | VAN-0001 | PR013 | 1FMCU9GD5MUA00013 | 2021 | Mercedes | Sprinter 2500 | 86209 | no |
| 2 | VAN-0002 | PR021 | ...00021 | 2021 | Mercedes | Sprinter 2500 | 91248 | no |
| 3 | VAN-0003 | PR016 | ...00016 | 2021 | Mercedes | Sprinter 2500 | 95073 | no |
| 4 | VAN-0004 | PR005 | ...00005 | 2020 | Ford | Transit 250 | 83646 | no |
| 5 | VAN-0005 | PR025 | ...00025 | 2022 | Ram | ProMaster 2500 | 84267 | no |
| 6 | VAN-0006 | PR026 | ...00026 | 2022 | Ram | ProMaster 2500 | 5200 | **yes** (brake) |
| 7 | VAN-0007 | PR004 | ...00004 | 2020 | Ford | Transit 250 | 90708 | no |
| 8 | VAN-0008 | PR006 | ...00006 | 2020 | Ford | Transit 250 | 99597 | no |

## Semana 2 — HECHO (Abr 24)

- [x] Modelos SQLModel: Organization + User (con enums VARCHAR + TIMESTAMPTZ)
- [x] Alembic configurado, migración `20260424_1600` aplicada en prod
- [x] JWT auth: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`
- [x] bcrypt directo (sin passlib — incompatibilidad con bcrypt 4+)
- [x] Seed: 3 orgs + 4 usuarios demo, todos login verificado end-to-end

### Usuarios demo (password: `nova2026!`)

| Email | Org | org_id | Role |
|---|---|---|---|
| tamika@ribrell21.com | Ribrell 21 | DSP-0004 | dsp_owner |
| olger@dullesmidas.com | Dulles Midas | V-005 | vendor_admin |
| david@dullesmidas.com | Dulles Midas | V-005 | technician |
| maria@novafora.com | Nova Fora | NF-006 | site_admin |

## Qué falta (Semana 3 — Vehicles + Inspections)

- [ ] Modelo Vehicle (+ migration)
- [ ] Modelo Inspection + ReportedDefect + Photo (+ migration)
- [ ] Endpoints `/vehicles` (CRUD + list + filter)
- [ ] Endpoints `/inspections` (POST, GET, PATCH, submit)
- [ ] Endpoint `/inspections/{id}/photos` con presigned S3/MinIO URL
- [ ] Wiring del `Login.jsx` del frontend demo contra `/auth/login` (cierra el loop visual)
