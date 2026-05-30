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

- Copia de Matriz de Seguimiento (respuestas): https://docs.google.com/spreadsheets/d/1Hh4p4ydxmfT1BHC3E8YLoluXVUOBZvOfUKT-yR3tjrI/edit?gid=1301505875#gid=1301505875
- Copia de ORDENES DE TRABAJO TYC: https://docs.google.com/spreadsheets/d/1wWFSW2M3CdxHlr3q-L4eeMhmGMvmCaeUA0tGptWOqME/edit?gid=1862269386#gid=1862269386
- Copia de REPORTE DE ACTIVIDADES MANTENIMIENTO (respuestas): https://docs.google.com/spreadsheets/d/1PZCi-L47ltwrJXGdwF1gjWj7fZHdeFeS_MDwS8cpS3A/edit?gid=1575504867#gid=1575504867
- HOJA RESUMEN FINANCIERO OTS: https://docs.google.com/spreadsheets/d/1Aaaj5rxLEl6KakxsXGV9BlIDkCyrqSZad6eayyAX4TQ/edit?usp=sharing&utm_source=chatgpt.com&urp=gmail_link

## Cambios operativos recientes

- La vista `Dashboard` calcula `Filas OT` usando solo la columna `OT` de `Copia de ORDENES DE TRABAJO TYC`, en la pestana `gid=1862269386`.
- La vista `Registros` permite filtrar por `OT` y tambien por `ESTADO` con las opciones `TERMINADO`, `REVISION`, `SIN REVISAR` y `SIN INICIAR`.
- La vista `Ver detalle` incluye generacion de informes por OT con IA. El informe toma la fila financiera correspondiente en `HOJA RESUMEN FINANCIERO OTS / Hoja 2`, usa `MANO OBRA`, `DETALLE_MANO_OBRA`, tiempos, ordenes de compra y SP relacionadas, y guarda el resultado buscando dinamicamente la columna con encabezado `INFORME`.
- La sincronizacion del resumen financiero agrega `QUIEN SOLICITA` desde `Copia de ORDENES DE TRABAJO TYC` hacia `HOJA RESUMEN FINANCIERO OTS / Hoja 2`, conservando la asociacion por `OT`. El modal `Ver detalle` tambien muestra este dato en una tarjeta propia y usa como respaldo el valor de la OT cuando todavia no se ha sincronizado el resumen.
- En `Copia de Matriz de Seguimiento (respuestas)`, la columna `ORDENES DE COMPRA` se muestra con el valor real de cada fila. Esto evita que la vista junte todas las OC de una misma OT en una sola celda y permite revisar `OC 1`, `OC 2` y siguientes de forma ordenada fila por fila.
- El modal `Ver detalle` complementa la informacion financiera con una seccion `Datos de la Orden de Trabajo`, tomada de `Copia de ORDENES DE TRABAJO TYC`. Incluye fecha de solicitud, lugar, solicitante, area, equipo, formato de actividades, descripcion general del fallo/solicitud y comentarios.
- La IA que genera informes de OT recibe esos datos de la orden de trabajo en `datosOrdenTrabajoTYC` y debe considerarlos como contexto operativo obligatorio para producir analisis, hallazgos, conclusiones y recomendaciones mas precisas.
- Los tooltips de encabezados en `Registros` mantienen sus conteos y totales, y ahora tambien indican documento, hoja y columna de origen de la informacion mostrada.
- Despues de generar o cargar un informe en `Ver detalle`, la app permite enviarlo por correo. El usuario selecciona un emisor y uno o varios receptores previamente configurados en `Email y Telegram`; se envia solo el contenido del informe usando Gmail API.
- `Ver detalle` muestra una seccion `Reporte de actividades (Facturacion)` agrupada por la llave `OT`, tomada de la hoja `FACTURACION` del archivo de actividades. Incluye colaborador, proceso facturado, equipo intervenido, OT reporte de campo, horometro/kilometraje, actividad realizada y repuestos utilizados.
- El resumen financiero llena la columna existente `NUMERO DE COLABORADORES` con formato multilinea: `Numero : N` seguido por los colaboradores unicos vinculados a la OT.
- En `Registros > Editar`, la seccion `Asociar registro` permite seleccionar multiples receptores configurados en `Email y Telegram`, agregar correos extra y guardar esos destinatarios en la asociacion.
- Los cambios en columnas `ESTADO` se monitorean globalmente. Cuando la app sincroniza y detecta un estado distinto al ultimo observado, envia un correo automatico a los receptores configurados.
- Los recordatorios por email siguen disponibles: `Diario` se envia a las 12:00, `Semanal` se envia los viernes a las 12:00 y `Cambio de estado` envia una plantilla con estado anterior y nuevo.

## Integraciones

- Google Sheets se lee con Google Sheets API y OAuth en navegador.
- Las fuentes iniciales estan en `src/constants/config.js`.
- La capa IA usa OpenAI Chat Completions desde `src/App.jsx` para prueba.
- El `client_secret` queda guardado solo como dato de configuracion para migrarlo luego a backend; el login OAuth del navegador usa `client_id`.
- La lectura de Sheets usa `values:batchGet` para traer todas las pestanas detectadas del documento.
- La edicion usa Google Sheets API: `values.update`, `values.append` y `batchUpdate` para crear hojas.
- Telegram puede enviarse directo en prueba o mediante `netlify/functions/send-telegram.js`.
- Email automatico y pruebas de correo usan Gmail API directamente desde el navegador con OAuth. El scope requerido es `https://www.googleapis.com/auth/gmail.send`.

## Variables Netlify opcionales

```bash
SENDGRID_API_KEY=...
NOTIFICATION_FROM_EMAIL=notificaciones@empresa.com
TELEGRAM_BOT_TOKEN=...
```

## Produccion

Para produccion, mueve credenciales y llamadas a OpenAI/Google a Netlify Functions con variables de entorno. Las credenciales incluidas son solo para la prueba indicada por el solicitante.
