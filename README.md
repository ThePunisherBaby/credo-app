# Credo — Red Social Internacional con Jerarquía Eclesiástica Mundial

Aplicación **Flutter (Web, Android e iOS)** + **Backend propio (Node.js + PostgreSQL)** desplegada como servicio aislado `credo` en tu VPS de Hostinger en **`https://credoapp.tech`** (y dirección técnica `https://credo.srv2108371.hstgr.cloud`).

## Estructura del proyecto
- `app/`: Aplicación Flutter multiplataforma (Web, Android, iOS) con soporte multi-idioma automático (`es`, `en`, `it`, `pt`, `fr`).
- `backend/`: API REST Express + PostgreSQL + servidor de archivos estáticos de Flutter Web + `Dockerfile` para Coolify.
- `deploy.sh`: Compila Flutter Web en el Mac, copia el resultado a `backend/public/` y sube el paquete al VPS con `subir.sh`.

## Reglas de negocio principales
- **Árbol jerárquico mundial:** Santa Sede → Dicasterios / Conferencias Episcopales / Órdenes Religiosas → Arquidiócesis → Diócesis → Vicarías / Seminarios / Parroquias.
- **Perfiles con linaje e historial de cargos:** Cada usuario (Cardenal, Arzobispo, Obispo, Monseñor, Sacerdote, Diácono, Vida Consagrada, Seminarista, Catequista, Fiel Laico) tiene perfil completo mostrando a qué jurisdicción pertenece y su historial de asignaciones.
- **Publicación exclusiva del clero:** Todos tienen perfil, siguen jurisdicciones/personas, reaccionan (*Amén*, *En oración*, *Gracias*), comentan y participan en mensajería y grupos pastorales; **solo el clero ordenado puede publicar** en el feed (validado en backend y frontend).
- **Cuentas de demostración precargadas** (contraseña: `Credo2026!`):
  - Clero (puede publicar): `padre.mateo@credo.org`, `arzobispo.santo.domingo@credo.org`, `cardenal.valerio@credo.org`
  - Fiel Laico (perfil completo, lectura e interacción sin publicar): `maria.laica@credo.org`

## Comandos útiles
- Desplegar cambios al VPS: `./deploy.sh`
- Compilar Android APK apuntando al dominio oficial:
  `cd app && flutter build apk --release --dart-define=CREDO_API_URL=https://credoapp.tech`
- Compilar iOS:
  `cd app && flutter build ios --release --dart-define=CREDO_API_URL=https://credoapp.tech`
