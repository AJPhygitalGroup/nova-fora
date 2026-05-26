# Re-deploy Nova Fora en VPS Hostinger + EasyPanel

Guía paso-a-paso para montar el stack completo (API + frontend + Postgres + Redis + MinIO) desde cero en un VPS nuevo de Hostinger, usando EasyPanel como orquestador.

**Tiempo estimado:** 30-45 min sin contar la restauración del backup.

---

## FASE 0 — Pre-requisitos

Antes de empezar tener listo:

- VPS Hostinger funcionando (mínimo: **2 vCPU / 4 GB RAM / 80 GB SSD** — el plan KVM 2 era el que tenías)
- IP pública del VPS + password de root
- Acceso al panel Hostinger (`hpanel.hostinger.com`)
- Cuenta GitHub con acceso al repo `AJPhygitalGroup/nova-fora`
- Backup de la DB en tu PC (`.sql`, `.dump`, o `.tar.gz`)

---

## FASE 1 — Setup inicial del VPS (5 min)

### 1.1 Entrar al VPS

hPanel → VPS → tu nuevo servidor → **Browser terminal**. Te abre un shell ya logueado como `root`.

### 1.2 Actualizar el sistema

```bash
apt update && apt upgrade -y
```

Si pide reiniciar el kernel, dale Enter y dejá que termine. Después:

```bash
reboot
```

Esperá 1–2 min y reconectate por el Browser terminal.

---

## FASE 2 — Instalar EasyPanel (5 min)

```bash
curl -sSL https://get.easypanel.io | sh
```

El script instala Docker + Docker Compose + EasyPanel + Traefik. Tarda 3–5 min.

Cuando termine vas a ver algo como:

```
EasyPanel is running on http://<TU_IP>:3000
```

### 2.1 Primer login a EasyPanel

1. Abrí `http://<IP_DEL_VPS>:3000` en el navegador
2. Crea el usuario admin → email + password segura
3. Te lleva al dashboard vacío

---

## FASE 3 — Conectar GitHub (crítico — fue el cuello de botella la vez pasada)

EasyPanel → Settings (⚙️) → **GitHub** y pegás un Personal Access Token classic con scope `repo`.

Si no tenés uno generalo en:

- `https://github.com/settings/tokens/new` (classic, NO fine-grained)
- **Note:** `Easypanel Nova Fora`
- **Expiration:** No expiration (o 90 días)
- **Scopes:** ✅ marcá **`repo`** (cubre todo lo necesario)
- Click **Generate token** → COPIÁ el valor `ghp_...` (solo se muestra una vez)

Pegalo en EasyPanel y dale Save. Vas a ver toast verde "Github token updated".

---

## FASE 4 — Crear el proyecto

1. En el dashboard click **+ Project** (arriba a la izquierda)
2. Name: `nova-fora`
3. Create

Te lleva a la vista del proyecto vacío con sidebar para los servicios.

---

## FASE 5 — Crear los 5 servicios

⚠️ **ORDEN IMPORTA**: Postgres + Redis + MinIO primero (son dependencias), luego API, luego Web.

### 5.1 Postgres

1. **+ Service** → **Postgres** (template)
2. **Name:** `postgres`
3. **Generate Password** → anotá la password generada
4. **Version:** `17`
5. Create
6. Esperá ~30 s a que arranque (verde)

### 5.2 Redis

1. **+ Service** → **Redis** (template)
2. **Name:** `redis`
3. **Generate Password** → anotala
4. **Version:** `7`
5. Create

### 5.3 MinIO (storage)

1. **+ Service** → **App**
2. **Name:** `storage`
3. **Source** tab:
   - Type: **Docker Image**
   - Image: `minio/minio:latest`
4. **Deploy** tab → **Command:**
   ```
   minio server /data --console-address ":9001"
   ```
5. **Mounts** tab → Add Volume:
   - Name: `data`
   - Mount path: `/data`
6. **Environment** tab → pegá (cambiá la password):
   ```
   MINIO_ROOT_USER=novaadmin
   MINIO_ROOT_PASSWORD=GENERA_PASSWORD_LARGA_AQUI
   MINIO_API_CORS_ALLOW_ORIGIN=*
   ```
7. **Domains** tab → **Add Domain** → te genera algo como `nova-fora-storage-XXXXX.easypanel.host`. **ANOTALO** — lo vas a necesitar.
8. Save + Deploy

Después de que arranque, volvé al Environment y agregá:
```
MINIO_SERVER_URL=https://<el-dominio-que-anotaste>
```
Save + Deploy de nuevo.

### 5.4 API (FastAPI backend)

1. **+ Service** → **App**
2. **Name:** `api`
3. **Source** tab:
   - Type: **GitHub**
   - Owner: `AJPhygitalGroup`
   - Repository: `nova-fora`
   - Branch: `main`
   - Build path: `/apps/api`
4. **Build** tab:
   - Type: **Dockerfile**
   - File: `Dockerfile`
5. **Domains** tab → **Add Domain** → anotá el URL generado (algo como `nova-fora-api-XXXXX.easypanel.host`)
6. **Environment** tab → pegá esto (reemplazá los placeholders):
   ```
   ENV=production
   DATABASE_URL=postgresql+asyncpg://postgres:POSTGRES_PASS_AQUI@nova-fora_postgres:5432/postgres
   REDIS_URL=redis://:REDIS_PASS_AQUI@nova-fora_redis:6379
   JWT_SECRET=GENERA_HEX_DE_64_CHARS_AQUI
   JWT_ALGORITHM=HS256
   JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
   JWT_REFRESH_TOKEN_EXPIRE_DAYS=30
   APP_URL=https://<DOMINIO_WEB>
   API_URL=https://<DOMINIO_API>
   CORS_ORIGINS=https://<DOMINIO_WEB>,http://localhost:5173
   S3_ENDPOINT=http://nova-fora_storage:9000
   S3_PUBLIC_ENDPOINT=https://<DOMINIO_STORAGE>
   S3_ACCESS_KEY=novaadmin
   S3_SECRET_KEY=PASSWORD_QUE_PUSISTE_EN_MINIO
   ```

   Para generar `JWT_SECRET` corré en el Browser terminal:
   ```bash
   openssl rand -hex 32
   ```
   Copiá el output (64 caracteres hex).

   El `<DOMINIO_WEB>` lo vas a generar en el próximo paso. Por ahora dejá un placeholder y volvé acá después.

7. Save + Deploy
8. Mirá los logs (Logs tab) — debe arrancar uvicorn después de aplicar Alembic migrations (~30 s)

### 5.4.1 IMPORTANTE — Workaround del bug de MinIO `_FILE` overrides

MinIO de EasyPanel viene con `MINIO_ROOT_USER_FILE=access_key` y
`MINIO_ROOT_PASSWORD_FILE=secret_key` precargados, que **anulan** los env
`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`. Como los archivos no existen,
MinIO arranca con su default `minioadmin/minioadmin` — y los presigned
URLs del API (firmados con `S3_ACCESS_KEY=admin`, `S3_SECRET_KEY=Salomo…`)
devuelven `403 InvalidAccessKeyId` cuando el browser intenta subir fotos.

**Fix una sola vez por VPS** (persiste en el data dir de MinIO; no se
pierde con redeploys del API):

```bash
ssh -i ~/.ssh/nova_claude_key root@<VPS_IP>

# Crear el usuario "admin" en MinIO con la password que el API espera
docker exec $(docker ps -qf name=nova-fora_minio) sh -c '
  mc alias set local http://localhost:9000 minioadmin minioadmin && \
  mc admin user add local admin "Salomo91*Dios" && \
  mc admin policy attach local consoleAdmin --user admin
'
```

Después, probá subir una foto desde el wizard de inspección — debe devolver
HTTP 200 en el PUT al presigned URL.

Detectado 2026-05-26 cuando un inspector vio `Upload failed (403)` en el
paso "Lectura del odómetro" del wizard.

### 5.5 Web (frontend Vite)

1. **+ Service** → **App**
2. **Name:** `web`
3. **Source** tab:
   - GitHub
   - Owner: `AJPhygitalGroup`
   - Repository: `nova-fora`
   - Branch: `main`
   - Build path: `/nova-fora-demo`
4. **Build** tab → Dockerfile / File: `Dockerfile`
5. **Build Args** tab → **Add:**
   - Name: `VITE_API_BASE_URL`
   - Value: `https://<DOMINIO_API>`
6. **Domains** tab → **Add Domain** → anotá el URL
7. Save + Deploy

### 5.6 Volver al API y actualizar APP_URL + CORS

Ahora que tenés el dominio del Web:

1. Servicio `api` → Environment tab
2. Actualizá:
   - `APP_URL=https://<DOMINIO_WEB>`
   - `CORS_ORIGINS=https://<DOMINIO_WEB>,http://localhost:5173`
3. Save → Deploy

---

## FASE 6 — Dame acceso SSH

Para que pueda ayudarte con la restauración del backup, deploys manuales, debugging, etc., pegá esto en el Browser terminal:

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh && echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHQAk1+TjRwholay9DXhVaMO6F2TlTxfY7WBj0bTBwBU claude-deploy" >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && tail -1 /root/.ssh/authorized_keys
```

Te debe mostrar la línea `ssh-ed25519 AAAA... claude-deploy`. Decime la IP nueva y pruebo conexión.

---

## FASE 7 — Restaurar el backup de la DB

Una vez que tenga SSH:

1. Vos copiás el backup desde tu PC al VPS:
   ```bash
   scp tu_backup.sql.gz root@<NUEVA_IP>:/root/
   ```
2. Yo descomprimo y lo restauro al contenedor Postgres
3. Verificamos: `SELECT count(*) FROM users; FROM vehicles; FROM inspections;`

⚠️ **Limitación conocida:** Las URLs de fotos en el backup apuntan al MinIO viejo. Si no tenés backup de MinIO también, las fotos no van a cargar (las metadata sí, las imágenes no). La data nueva que entren después del test sí queda en MinIO nuevo.

---

## FASE 8 — Verificación final

Abrí en el navegador: `https://<DOMINIO_WEB>/`

- Debe cargar el login de Nova Fora
- Logueate con un usuario del backup → debe entrar normal
- Andá al wizard de inspección → debe llegar al checklist NOVABODY

---

## Notas / gotchas conocidas

1. **EasyPanel "Deploy" button no construye realmente** (bug que descubrimos la vez pasada). Si después de un commit el bundle no cambia, hay que rebuildear vía SSH. Mientras la integración GitHub esté funcionando, el primer deploy SÍ construye — el bug aparece en los re-deploys subsecuentes.

2. **Token GitHub expira / se revoca.** Si los deploys empiezan a fallar con "GET /repos/... 404", regenerá el PAT (Fase 3).

3. **El dominio `easypanel.host` auto-generado tiene HTTPS** (Let's Encrypt automático). No necesitás configurar SSL.

4. **Si querés tu propio dominio** (ej: `nova-fora.com`):
   - En el DNS del registrar: A record apuntando a la IP del VPS
   - En EasyPanel → servicio web → Domains tab → Add Domain con tu dominio
   - EasyPanel genera el cert SSL automático

5. **Backups automáticos**: Configurá snapshots semanales en Hostinger (panel del VPS → Snapshots) para no volver a perder data.
