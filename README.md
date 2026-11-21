# Credo — Plataforma Católica Internacional, Radio en Vivo y App Android

Plataforma web móvil (PWA **Apple-grade** con diseño minimalista, tipografía **SF Pro Rounded Bold**, física real de **Apple Springs** y dock flotante estilo **Dynamic Island**) + Backend API + App Android nativa (`.apk`) con motor de actualizaciones OTA basado en **GitHub Releases**.

---

## 1. Accesos y Enlaces en Producción

| Recurso | URL / Detalle |
|---|---|
| **Web oficial (HTTPS / TLS 1.3)** | `https://credoapp.tech` |
| **Repositorio GitHub** | `https://github.com/ThePunisherBaby/credo-app` |
| **Último APK firmado (GitHub Releases)** | `https://github.com/ThePunisherBaby/credo-app/releases/latest` |
| **Descarga directa APK v1.0.0** | `https://github.com/ThePunisherBaby/credo-app/releases/download/v1.0.0/Credo-v1.0.0.apk` |
| **Radio en Vivo integrada** | **Aire 96 FM** (`https://aire96fm.com.do`) y **Reflexionando la Palabra** (`https://reflexionandolapalabra.com`) |
| **Perfil CEO verificado** | **P. Domingo Vásquez** (`padre.domingo@credo.org`, `is_ceo: true`, `is_admin: true`) |

---

## 2. Arquitectura del Software

```text
credo/
├── backend/                     # API REST + Servidor Estático (Node.js 22 + Express + PostgreSQL)
│   ├── Dockerfile               # Contenedor aislado (puerto 8080, /health)
│   └── src/
│       ├── index.js             # Express, HSTS preload, CSP, HTTPS enforce, sync cada 15 min
│       ├── config.js            # Rangos del clero, tipos de unidad y configuración JWT
│       ├── db/
│       │   ├── pool.js          # Conexión PostgreSQL + inicialización de esquema
│       │   ├── schema.sql       # Tablas: ecclesiastical_units, users, posts, live_channels,
│       │   │                    #   prayer_intentions, prayer_logs, parish_offerings, stories,
│       │   │                    #   saved_posts, media_assets, conversations, messages, follows
│       │   └── seed.js          # Jerarquía eclesiástica mundial + CEO P. Domingo Vásquez + radios reales
│       ├── middleware/auth.js   # JWT + requireClergy (403 CLERGY_ONLY_PUBLISH para laicos)
│       ├── utils/
│       │   ├── hierarchy.js     # Consultas recursivas de linaje eclesiástico
│       │   └── officialSync.js  # Federación real WordPress API (aire96fm.com.do & reflexionandolapalabra.com)
│       └── routes/
│           ├── auth.js          # Registro, login y sesión actual
│           ├── posts.js         # Feed curado paginado, detalle, reacciones, comentarios, guardados
│           ├── live.js          # Hub de Radio y TV en vivo
│           ├── prayers.js       # Liturgia del Día en directo, Muro de Intenciones y Ofrendas Parroquiales
│           ├── units.js         # Jerarquía Mundial (carga perezosa nivel por nivel) y fichas parroquiales
│           ├── users.js         # Directorio verificado, perfiles, seguimiento y Credo Plus
│           ├── messages.js      # Grupos pastorales y mensajería directa
│           ├── media.js         # Subida de imágenes comprimidas + proxy oficial (/api/v1/media/proxy)
│           └── stories.js       # Destacados oficiales del clero
│
├── web/                         # Front-end PWA Ultra-Ligero (~120 KB, renderizado estricto por vista)
│   ├── index.html               # Shell semántico, FOUC-free color-scheme, SF Pro Rounded + Nunito + Lora
│   ├── styles.css               # Dual Mode (Oscuro OLED #000000 / Claro #F7F6F2), Liquid Glass, Springs
│   ├── app.js                   # Router perezoso por vista, caché 0ms, reproductor persistente y modales
│   ├── springs.mjs              # Motor físico Apple Springs (SpringValue, Dynamic Island pill, SnapSheet)
│   ├── glass.js                 # Refracción Snell Liquid Glass (Chromium) + glow interactivo táctil
│   ├── audio-engine.js          # Motor de radio MP3 en directo + Media Session + Temporizador + Voz Evangelio
│   ├── i18n.js                  # 5 idiomas (es, en, it, pt, fr) con detección automática
│   └── views/                   # Módulos ES cargados bajo demanda (solo existe el DOM de la vista activa)
│       ├── feed.js              # Inicio: Destacados en vivo, Evangelio de Hoy y Feed Curado paginado
│       ├── live.js              # En Vivo: Hero Aire 96 FM y emisoras oficiales
│       ├── prayer.js            # Oración: Liturgia del Día con A-/A+/Voz + Muro de Intenciones
│       ├── parishes.js          # Parroquias: Mi Parroquia, Directorio Verificado y Jerarquía Mundial
│       ├── profile.js           # Perfil: Guardados, Ajustes de Accesibilidad, Credo Plus y OTA Android
│       └── messages.js          # Comunidad y mensajería pastoral
│
├── android-app/                 # App Android Nativa (Kotlin + Gradle 9.3.1 + AGP 9.1.0 + SDK 36)
│   ├── version.properties       # VERSION_CODE y VERSION_NAME (fuente única de verdad)
│   └── app/src/main/java/tech/credoapp/credo/
│       ├── MainActivity.kt      # WebView OLED edge-to-edge + audio en vivo + puente window.CredoNative
│       └── GitHubUpdateEngine.kt# Motor OTA nativo vía GitHub Releases API + progreso + FileProvider
│
├── releases/                    # APKs compilados y firmados + checksums SHA-256
│   ├── Credo-v1.0.0.apk
│   └── Credo-v1.0.0.apk.sha256
│
├── .github/workflows/
│   └── android-release.yml      # CI/CD: compila, firma y publica Release en cada tag v*
├── deploy.sh                    # Despliega web + backend al VPS (servicio aislado `credo`)
└── publish-update.sh            # Publica una nueva versión Android OTA en 1 comando
```

---

## 3. Reglas de Negocio y Seguridad

- **Feed Curado (Solo Clero Verificado):** Cualquier persona puede crear perfil, reaccionar (*Amén*), guardar, comentar y publicar intenciones de oración; la publicación en el feed está protegida por `requireClergy` en el backend (`403 CLERGY_ONLY_PUBLISH` para cuentas laicas).
- **Renderizado por Vista Bajo Demanda:** Cada pestaña importa su módulo JS solo cuando se visita, destruye el DOM de la vista anterior y cancela peticiones pendientes con `AbortController`.
- **Seguridad Web / HTTPS:** Certificado **Let's Encrypt TLS 1.3**, registro DNS `CAA`, redirección automática a HTTPS, `Strict-Transport-Security` (`preload`), `Content-Security-Policy` con `upgrade-insecure-requests`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` y `Permissions-Policy`.

---

## 4. Comandos de Operación

### Desplegar cambios Web / Backend a `https://credoapp.tech`
```bash
./deploy.sh
```

### Publicar una nueva actualización Android (OTA vía GitHub Releases)
```bash
./publish-update.sh 1.0.1 "Descripción de mejoras"
```
Esto incrementa `VERSION_CODE`, compila y firma el APK con el keystore permanente (`~/.credo-keys/credo-release.jks`), genera el `.sha256`, crea el tag `v1.0.1`, sube a GitHub y publica el Release. Todos los teléfonos con Credo instalado detectan la actualización automáticamente al abrir la app o desde **Perfil → Ajustes → Buscar actualizaciones**.

### Compilación automática en GitHub Actions
Al subir cualquier tag `v*` (`git tag v1.0.2 && git push origin v1.0.2`), el workflow `.github/workflows/android-release.yml` compila, firma usando los secretos configurados en el repositorio (`CREDO_KEYSTORE_BASE64`, `CREDO_KEYSTORE_PASS`, `CREDO_KEY_ALIAS`, `CREDO_KEY_PASS`) y publica el Release automáticamente.
