# Plataforma Operacional Inteligente

Aplicacion React/Vite para convertir multiples Google Sheets en una capa tipo CRM/ERP con lectura dinamica de pestanas, columnas, registros, relaciones, KPIs, alertas y asistente IA.

## Uso local

Este proyecto usa React + Vite y corre localmente en `http://127.0.0.1:5501/`.

### 1. Instalar dependencias

Si es la primera vez que abres el proyecto, instala las dependencias:

```bash
corepack pnpm install
```

Si `pnpm` no esta disponible directamente, `corepack` lo habilita desde Node.

### 2. Arrancar la aplicacion

```bash
corepack pnpm run dev
```

Vite debe mostrar una salida parecida a:

```bash
Local: http://127.0.0.1:5501/
```

Luego abre en el navegador:

```text
http://127.0.0.1:5501/
```

### 3. Sincronizar Google Sheets

Dentro de la app, presiona `Sincronizar` en la barra izquierda. Si Google solicita permisos, inicia sesion con una cuenta que tenga acceso a los Google Sheets configurados.

Tambien puedes publicar el directorio directamente en Netlify.

Para OAuth local, el proyecto usa `http://127.0.0.1:5501`, que debe existir en Google Cloud Console como origen autorizado de JavaScript.

### Variables locales

Las credenciales sensibles no deben versionarse. Copia `.env.example` a `.env.local` y completa los valores necesarios para IA/Google:

```bash
VITE_REPORT_AGENT_API_KEY=...
VITE_OPENAI_API_KEY=...
VITE_GOOGLE_CLIENT_ID=...
```

## Google Sheets configurados

- Matriz de Seguimiento: https://docs.google.com/spreadsheets/d/1Hh4p4ydxmfT1BHC3E8YLoluXVUOBZvOfUKT-yR3tjrI/edit?gid=1301505875#gid=1301505875
- Ordenes de Trabajo TYC: https://docs.google.com/spreadsheets/d/1wWFSW2M3CdxHlr3q-L4eeMhmGMvmCaeUA0tGptWOqME/edit?gid=1862269386#gid=1862269386
- Reporte de Actividades Mantenimiento: https://docs.google.com/spreadsheets/d/1PZCi-L47ltwrJXGdwF1gjWj7fZHdeFeS_MDwS8cpS3A/edit?gid=1575504867#gid=1575504867
- Resumen Financiero OTS: https://docs.google.com/spreadsheets/d/1Aaaj5rxLEl6KakxsXGV9BlIDkCyrqSZad6eayyAX4TQ/edit?gid=0#gid=0

## Integraciones

- Google Sheets se lee con Google Sheets API y OAuth en navegador.
- Las fuentes iniciales estan en `src/App.jsx`.
- La capa IA usa OpenAI Chat Completions desde `src/App.jsx` para prueba.
- El `client_secret` queda guardado solo como dato de configuracion para migrarlo luego a backend; el login OAuth del navegador usa `client_id`.
- La lectura de Sheets usa `values:batchGet` para traer todas las pestanas detectadas del documento.
- La edicion usa Google Sheets API: `values.update`, `values.append` y `batchUpdate` para crear hojas.
- Telegram puede enviarse directo en prueba o mediante `netlify/functions/send-telegram.js`.
- Email automatico queda preparado con `netlify/functions/send-email.js` usando SendGrid.

## Variables Netlify opcionales

```bash
SENDGRID_API_KEY=...
NOTIFICATION_FROM_EMAIL=notificaciones@empresa.com
TELEGRAM_BOT_TOKEN=...
```

## Produccion

Para produccion, mueve credenciales y llamadas a OpenAI/Google a Netlify Functions con variables de entorno. Las credenciales incluidas son solo para la prueba indicada por el solicitante.
