# Contrato de API · Módulo 4 Consultorio veterinario

*(Para pegar en la Wiki del proyecto de integración en Taiga.)*

Base: `https://<prototipo>.onrender.com/api/consultorio` · JSON · fechas ISO 8601 UTC.
Todas las rutas (salvo `/salud` y `/config`) exigen `Authorization: Bearer <token del núcleo>`. Sin token → 401; perfil sin permiso → 403.

Errores: `{"error": {"codigo": "ANIMAL_FALLECIDO", "mensaje": "..."}}`
Listados: `?page=1&limit=20` (máx. 100) → `{page, limit, total, totalPaginas, datos: [...]}`

## Endpoints que ofrece

| Método | Ruta | Perfiles | Respuestas |
|---|---|---|---|
| GET | `/horarios?fecha=YYYY-MM-DD&veterinarioId=` | todos | 200, 400, 404 |
| POST | `/citas` | vecino, comunitario, funcionario | 201, 400, 403, 404, 409, 503 |
| GET | `/citas?estado=&fecha=&animalId=&veterinarioId=` | todos (vecino/comunitario: solo las suyas) | 200, 400 |
| GET | `/citas/{citaId}` | todos (vecino/comunitario: solo las suyas) | 200, 403, 404 |
| PATCH | `/citas/{citaId}/estado` | vecino, comunitario, funcionario (confirmar/cancelar); veterinario (atendida) | 200, 400, 403, 404, 409 |
| PATCH | `/citas/{citaId}/horario` | vecino, comunitario, funcionario | 200, 400, 403, 404, 409 |
| POST | `/citas/ausentes` | veterinario, jefatura, admin | 200 |
| GET | `/animales/{animalId}/historial` | vecino, comunitario (solo los suyos), veterinario | 200, 403, 404, 503 |
| GET | `/bitacora` | jefatura, admin | 200 |

## Endpoints que consume

| Método y ruta | Proveedor | Para qué |
|---|---|---|
| `GET /api/nucleo/sesiones/actual` | Núcleo | Validar el token y obtener `{rut, perfil, nombre}` en cada petición (401 si es inválido; 503 si no responde) |
| `GET /api/nucleo/usuarios/{rut}` | Núcleo | Confirmar que existe el tutor cuando un funcionario agenda a su nombre |
| `GET /api/registro/animales/{animalId}` | M1 | Confirmar que el animal existe (404), no está `fallecido` (409) y quién es su tutor/responsable (RN-05 con el token del usuario). Sin respuesta en 4 s → 503, sin crear nada (RNF-04) |

## Ejemplos

**Agendar** — `POST /citas` (perfil vecino). `inicio` y `veterinarioId` son opcionales: sin ellos se asigna el primer bloque libre.
```json
{ "animalId": "SIM-000001", "motivo": "Control sano y vacunación",
  "inicio": "2026-11-27T12:00:00Z", "veterinarioId": "15555555-6" }
```
`201`
```json
{ "citaId": "C-3F9A1B2C4D", "animalId": "SIM-000001", "solicitanteRut": "11111111-1",
  "veterinarioId": "15555555-6", "inicio": "2026-11-27T12:00:00Z", "fin": "2026-11-27T12:30:00Z",
  "motivo": "Control sano y vacunación", "estado": "agendada",
  "creada": "2026-11-20T05:30:00Z", "actualizada": "2026-11-20T05:30:00Z",
  "historial": [{ "estado": "agendada", "fecha": "2026-11-20T05:30:00Z", "por": "11111111-1" }] }
```

**Atender** — `PATCH /citas/{citaId}/estado` (perfil veterinario). Sin `diagnostico` y `tratamiento` → 400 y la cita no cambia.
```json
{ "estado": "atendida",
  "ficha": { "diagnostico": "Otitis leve", "tratamiento": "Gotas óticas 7 días", "receta": "Otomax" } }
```

**Error**
```json
{ "error": { "codigo": "CANCELACION_FUERA_DE_PLAZO", "mensaje": "Solo se puede cancelar con al menos 24 horas de anticipación (RN-07)" } }
```

## Códigos de error de negocio

| HTTP | Código | Cuándo |
|---|---|---|
| 400 | `DATOS_INVALIDOS`, `ID_INVALIDO`, `FECHA_INVALIDA`, `INICIO_INVALIDO`, `BLOQUE_INVALIDO`, `BLOQUE_FUERA_DE_RANGO`, `ESTADO_INVALIDO`, `FICHA_REQUERIDA`, `RUT_INVALIDO`, `JSON_INVALIDO` | Entrada mal formada |
| 401 | `TOKEN_REQUERIDO`, `TOKEN_INVALIDO` | Sin token, inválido o vencido |
| 403 | `PERFIL_NO_AUTORIZADO` | Perfil sin permiso o recurso ajeno |
| 404 | `CITA_NO_ENCONTRADA`, `ANIMAL_NO_ENCONTRADO`, `VETERINARIO_NO_ENCONTRADO`, `RUTA_NO_ENCONTRADA` | No existe |
| 409 | `ANIMAL_FALLECIDO`, `RESPONSABLE_NO_REGISTRADO`, `BLOQUE_OCUPADO`, `TRANSICION_INVALIDA`, `CANCELACION_FUERA_DE_PLAZO`, `REAGENDAMIENTO_FUERA_DE_PLAZO`, `CONFLICTO_DE_ESTADO`, `SIN_HORARIOS` | Choca con una regla del negocio |
| 429 | `DEMASIADAS_PETICIONES` | Límite por IP |
| 503 | `NUCLEO_NO_DISPONIBLE`, `M1_NO_DISPONIBLE` | Servicio externo caído |
