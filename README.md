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
- La seccion `Rankings dinamicos` del `Dashboard` prioriza datos operativos reales cuando estan disponibles: costos por OT combinando compras y mano de obra, equipos por costo acumulado, tecnicos por actividades/horas y proveedores por compras desde `Copia de Matriz de Seguimiento (respuestas)`. Si no hay datos suficientes, conserva el ranking generico anterior como respaldo.
- Las listas de `Alertas inteligentes` y `Rankings dinamicos` en el `Dashboard` tienen scroll interno para mantener la vista compacta sin cambiar los calculos ni la informacion mostrada.
- La vista `Registros` permite filtrar por `OT` y tambien por `ESTADO` con las opciones `TERMINADO`, `REVISION`, `SIN REVISAR` y `SIN INICIAR`.
- La vista `Ver detalle` incluye generacion de informes por OT con IA. El informe toma la fila financiera correspondiente en `HOJA RESUMEN FINANCIERO OTS / Hoja 2`, usa `MANO OBRA`, `DETALLE_MANO_OBRA`, tiempos, ordenes de compra y SP relacionadas, y guarda el resultado buscando dinamicamente la columna con encabezado `INFORME`.
- La sincronizacion del resumen financiero agrega `QUIEN SOLICITA` desde `Copia de ORDENES DE TRABAJO TYC` hacia `HOJA RESUMEN FINANCIERO OTS / Hoja 2`, conservando la asociacion por `OT`. El modal `Ver detalle` tambien muestra este dato en una tarjeta propia y usa como respaldo el valor de la OT cuando todavia no se ha sincronizado el resumen.
- En `Copia de Matriz de Seguimiento (respuestas)`, la columna `ORDENES DE COMPRA` se muestra con el valor real de cada fila. Esto evita que la vista junte todas las OC de una misma OT en una sola celda y permite revisar `OC 1`, `OC 2` y siguientes de forma ordenada fila por fila.
- El modal `Ver detalle` complementa la informacion financiera con una seccion `Datos de la Orden de Trabajo`, tomada de `Copia de ORDENES DE TRABAJO TYC`. Incluye fecha de solicitud, lugar, solicitante, area, equipo, formato de actividades, descripcion general del fallo/solicitud y comentarios.
- En el modal `Ver detalle`, el campo `FORMATO DE ACTIVIDADES` se muestra como enlace clicable cuando contiene una URL valida (`http`, `https` o `www`), abriendo el recurso en una nueva pestana sin cambiar la obtencion de datos ni la estructura visual del modal.
- El modal `Ver detalle` calcula `TOTAL VALOR COMPRA (AGREGAR)` sumando la columna `VALOR COMPRA (AGREGAR)` de todos los registros de `Copia de Matriz de Seguimiento (respuestas)` asociados a la misma OT. El cruce por OT normaliza valores como `OT-3` y `3` para evitar falsos `NO ESPECIFICADO`.
- La recuperacion de datos de `Copia de ORDENES DE TRABAJO TYC` acepta variaciones de encabezados para fecha, lugar, solicitante, area, equipo, formato de actividades, descripcion y comentarios, mostrando `NO ESPECIFICADO` solo cuando el dato no exista en el origen.
- La IA que genera informes de OT recibe esos datos de la orden de trabajo en `datosOrdenTrabajoTYC` y el total `metricas.valorCompraAgregarTotal`; debe considerarlos como contexto operativo y financiero obligatorio para producir analisis, hallazgos, conclusiones y recomendaciones mas precisas.
- Los tooltips de encabezados en `Registros` mantienen sus conteos y totales, y ahora tambien indican documento, hoja y columna de origen de la informacion mostrada.
- Despues de generar o cargar un informe en `Ver detalle`, la app permite enviarlo por correo. El usuario selecciona un emisor y uno o varios receptores previamente configurados en `Email y Telegram`; se envia solo el contenido del informe usando Gmail API.
- En `Email y Telegram`, el usuario puede activar opcionalmente `Incluir emisor como receptor` para que el correo emisor tambien reciba las pruebas, reportes, recordatorios y notificaciones por email. Si la opcion queda desactivada, los destinatarios funcionan exactamente como antes y no se modifica la lista de receptores configurados.
- Los correos configurados en `Email y Telegram` se sincronizan con `HOJA RESUMEN FINANCIERO OTS / Correos vinculados`. La columna `CORREOS EMISOR` guarda los emisores y `CORREOS RECEPTORES` guarda los destinatarios efectivos, incluyendo el emisor cuando `Incluir emisor como receptor` esta activo. Al sincronizar, esa hoja se usa como fuente oficial para hidratar la configuracion de correos.
- `Ver detalle` muestra una seccion `Reporte de actividades (Facturacion)` agrupada por la llave `OT`, tomada de la hoja `FACTURACION` del archivo de actividades. Incluye colaborador, proceso facturado, equipo intervenido, OT reporte de campo, horometro/kilometraje, actividad realizada y repuestos utilizados.
- El resumen financiero llena la columna existente `NUMERO DE COLABORADORES` con formato multilinea: `Numero : N` seguido por los colaboradores unicos vinculados a la OT.
- En `Registros > Editar`, la seccion `Asociar registro` permite seleccionar multiples receptores configurados en `Email y Telegram`, agregar correos extra y guardar esos destinatarios en la asociacion.
- `Notas y Recordatorios` permite configurar `FECHA INICIO`, `FECHA FINALIZACION`, frecuencia `Mensual`, `CORREO EMISOR` y `CORREO RECEPTOR`. Los emisores y receptores se toman desde `HOJA RESUMEN FINANCIERO OTS / Correos vinculados`, y al guardar en Sheets se agregan las columnas `DATE`, `TITULO`, `DETALLE`, `FRECUENCIA`, `FECHA INICIO`, `FECHA FINALIZACION`, `CORREO EMISOR` y `CORREO RECEPTOR` sin cambiar el flujo base de notas.
- La ejecucion de recordatorios respeta el rango configurado: no envia antes de `FECHA INICIO` ni despues de `FECHA FINALIZACION`; los recordatorios mensuales se envian una vez al mes segun el dia definido en la fecha del recordatorio o en la fecha de inicio.
- Los cambios en columnas `ESTADO` se monitorean globalmente. Cuando la app sincroniza y detecta un estado distinto al ultimo observado, envia un correo automatico a los receptores configurados.
- Ademas del monitoreo de `ESTADO`, la app mantiene una linea base separada para cambios generales en campos asociados a una OT. Cuando un dato real cambia en cualquier documento con OT, envia un correo con OT, documento, hoja, campo modificado, valor anterior, valor nuevo, fecha/hora y usuario responsable si esta disponible, sin duplicar la notificacion existente de `ESTADO`.
- Los recordatorios por email siguen disponibles: `Diario` se envia a las 12:00, `Semanal` se envia los viernes a las 12:00 y `Cambio de estado` envia una plantilla con estado anterior y nuevo.

## Integraciones

- Google Sheets se lee con Google Sheets API y OAuth en navegador.
- Las fuentes iniciales estan en `src/constants/config.js`.
- La capa IA usa OpenAI Chat Completions desde `src/App.jsx` para prueba.
- El `client_secret` queda guardado solo como dato de configuracion para migrarlo luego a backend; el login OAuth del navegador usa `client_id`.
- La lectura de Sheets usa `values:batchGet` para traer todas las pestanas detectadas del documento.
- La edicion usa Google Sheets API: `values.update`, `values.append` y `batchUpdate` para crear hojas.
- La conexion OAuth con Google conserva el token en `localStorage` junto con su expiracion y fecha de vinculacion. La app reutiliza el token mientras siga vigente e intenta renovarlo silenciosamente antes de volver a solicitar autorizacion, sin cambiar los flujos de sincronizacion ni automatizaciones.
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
