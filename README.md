# Consultorio veterinario municipal · Módulo 4

Módulo 4 del Sistema municipal de tenencia responsable de mascotas (TI3043, INACAP Antofagasta, 2026).
Maneja la **agenda de citas** del consultorio y la **ficha clínica** de cada animal. Tiene su propia base MongoDB y
habla con el resto del sistema solo por API REST:

- **Núcleo** (docente): inicio de sesión; cada endpoint valida el token y el perfil antes de responder (RN-05).
- **M1 (registro de animales)**: confirma que el animal existe, no está fallecido y quién es su tutor o responsable.
  En la ES3 se usa el M1 simulado del núcleo (`/api/registro`, animales `SIM-000001` a `SIM-000010`); en la ES4 solo cambia `M1_URL`.

**Stack:** Node 18+ (sin framework: solo `http` nativo), driver oficial `mongodb`, interfaz en HTML/JS puro.
**Patrón de diseño:** DAO (`src/dao/`), como se definió en la ES2 (la lógica de negocio no conoce Mongo).

## Ejecutar en local

```bash
npm install
cp .env.example .env      # completar NUCLEO_URL, M1_URL y MONGODB_URI. El .env NO se sube al repo
node --env-file=.env src/index.js      # http://localhost:4000
```

- Núcleo en línea (trae el M1 simulado): `NUCLEO_URL=https://nucleo-tr.onrender.com` (si está dormido, la primera respuesta tarda ~30 s).
- Copia local del núcleo (`nucleo-tr-local`, puerto 3000): `NUCLEO_URL=http://localhost:3000`. **No trae M1**, así que agendar fallará con 503 hasta que `M1_URL` apunte a uno.
- Sin Atlas, solo para desarrollar: `ALLOW_MEMORY=1 npm run dev` (los datos se pierden al reiniciar).
- Pruebas: `npm test` (no necesita red ni Atlas: levanta un núcleo y un M1 simulados y usa memoria).

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NUCLEO_URL` | Sí (en producción) | URL del núcleo, sin `/` final |
| `MONGODB_URI` | Sí | Cadena de conexión de Atlas (secreto: solo en variables de entorno) |
| `MONGODB_DB` | No (`consultorio_m4`) | Nombre de la base |
| `M1_URL` | No | URL del M1; por defecto `NUCLEO_URL/api/registro` |
| `VETERINARIOS` | No | RUT de los veterinarios con agenda (por defecto los dos de prueba) |
| `CORS_ORIGIN` | No | Origen externo autorizado (la interfaz propia no lo necesita) |
| `LIMITE_POR_MINUTO` | No (300) | Peticiones por IP y minuto |
| `SEED_DEMO` | No (activo) | Crea la cita `C-DEMO-0001` que usa `entrega.json`; `0` la desactiva |
| `PORT` | No (4000) | Render lo define solo |

Sin `MONGODB_URI` el servicio no arranca (salvo `ALLOW_MEMORY=1`).

## Despliegue (Render + Atlas)

1. Repositorio público en GitHub con `JaimeMartikorena` como colaborador.
2. Atlas: clúster gratuito, usuario de base con permisos solo sobre `consultorio_m4`, acceso de red `0.0.0.0/0` (Render gratis no tiene IP fija).
3. Render: *New → Web Service*, conectar el repo, Build `npm install`, Start `npm start`, y cargar las variables de la tabla en *Environment*.
4. Comprobar `https://<servicio>.onrender.com/api/consultorio/salud` y abrir `/` para iniciar sesión.
5. El plan gratuito se duerme: **abrirlo justo antes de la entrega y de la conversación**.

## Usuarios de prueba (núcleo, clave `tenencia2026`)

| Perfil | RUT | Sirve para |
|---|---|---|
| vecino | 11111111-1 | Dueño de SIM-000001 (con microchip), SIM-000002 (sin microchip), SIM-000008 |
| vecino | 12222222-5 | Dueño de SIM-000003 y SIM-000004 (**fallecido**: no se agenda) |
| comunitario | 13333333-9 | Responsable de SIM-000005 y SIM-000010 |
| veterinario | 15555555-6 | Atender citas, ver historial, procesar ausentes |
| funcionario | 17777777-3 | Ve la agenda; agenda a nombre de un tutor; **no** ve historial |
| jefatura | 19999999-0 | Lee la bitácora |

## Estados de la cita

`agendada → confirmada → atendida` · `agendada|confirmada → cancelada` (≥ 24 h antes) · `agendada|confirmada → ausente` (lo asigna solo el sistema al terminar su hora).
`atendida`, `cancelada` y `ausente` son finales. Bloques de 30 min, lunes a viernes 09:00-13:00 y 14:00-17:00 (hora de Santiago).

## Estructura

```
src/index.js      arranque (elige DAO, siembra la demo, reloj de ausentes)
src/app.js        servidor http: token -> perfil -> cuerpo -> manejador, encabezados de seguridad, límite por IP
src/rutas.js      reglas de negocio y manejadores (una función por historia)
src/clientes.js   llamadas al núcleo y al M1 (con tiempo máximo)
src/dao/          memoria.js (pruebas) y mongo.js (producción, índices únicos y TTL)
src/tiempo.js     bloques de 30 min en hora local <-> ISO UTC
public/           interfaz (login contra el núcleo, agendar, citas, atender, historial)
test/e2e.js       61 pruebas con núcleo y M1 simulados
entrega.json      una verificación por historia
```
