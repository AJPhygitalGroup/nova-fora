# Estado del deploy — Nova Fora

> Última actualización: 2026-04-24 · Semana 1 del sprint completada.

## URLs en producción

| Servicio | URL | Status |
|---|---|---|
| **API** | https://nova-fora-api.vamj8y.easypanel.host | ✅ live |
| **Docs (Swagger)** | https://nova-fora-api.vamj8y.easypanel.host/docs | ✅ live |
| **Health** | https://nova-fora-api.vamj8y.easypanel.host/health | ✅ 200 |
| **Ready (DB+Redis)** | https://nova-fora-api.vamj8y.easypanel.host/health/ready | ✅ 200 |
| **Frontend** | _(pendiente — Semana 2-3)_ | ⏳ |
| **EasyPanel** | http://187.127.251.190:3000 | 🔐 admin only |

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

## Qué falta (Semana 2 del sprint)

- [ ] Modelos SQLModel: Organization, User, Vehicle, Inspection, WorkOrder
- [ ] Alembic configurado + primera migración
- [ ] Endpoints de auth: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`
- [ ] Seed users (Tamika, Olger, David, Maria — las 4 cuentas demo)
- [ ] Wiring del `Login.jsx` del frontend demo contra `/auth/login`
