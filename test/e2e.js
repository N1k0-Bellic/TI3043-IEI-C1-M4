// [PENDIENTE] contenido de commits anteriores no disponible (reconstruido desde parche)
    assert.strictEqual(r.status, 404);
  });

  console.log('\nCV-01 Agendar (RF-01, RF-02, RN-06)');
  let citaId;
  const fechaFutura = diaHabil(3, tz);
  let bloque;
  await prueba('GET /horarios lista bloques libres de 30 min', async () => {
    const r = await pedir('GET', `/api/consultorio/horarios?fecha=${fechaFutura}&limit=100`, 'tok-vecino1');
    esperar(r, 200);
    assert.ok(r.datos.total > 0);
    bloque = r.datos.datos[0];
    assert.strictEqual(new Date(bloque.fin) - new Date(bloque.inicio), 30 * 60000);
  });
  await prueba('fin de semana no tiene bloques', async () => {
    let f = T.sumaDias(T.fechaLocal(new Date(), tz), 1);
    while (new Date(f + 'T00:00:00Z').getUTCDay() !== 6) f = T.sumaDias(f, 1);
    const r = await pedir('GET', `/api/consultorio/horarios?fecha=${f}`, 'tok-vecino1');
    assert.strictEqual(r.datos.total, 0);
  });
  await prueba('fecha mal formada -> 400', async () => esperar(await pedir('GET', '/api/consultorio/horarios?fecha=hoy', 'tok-vecino1'), 400, 'FECHA_INVALIDA'));
  await prueba('POST /citas en un bloque elegido -> 201, estado agendada', async () => {
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', inicio: bloque.inicio, veterinarioId: bloque.veterinarioId, motivo: 'Control' });
    esperar(r, 201);
    assert.strictEqual(r.datos.estado, 'agendada');
    assert.strictEqual(r.datos.inicio, bloque.inicio);
    citaId = r.datos.citaId;
  });
  await prueba('el bloque ocupado deja de aparecer en /horarios', async () => {
    const r = await pedir('GET', `/api/consultorio/horarios?fecha=${fechaFutura}&veterinarioId=${bloque.veterinarioId}&limit=100`, 'tok-vecino1');
    assert.ok(!r.datos.datos.some((b) => b.inicio === bloque.inicio));
  });
  await prueba('mismo bloque y veterinario -> 409 BLOQUE_OCUPADO (RN-06)', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino2', { animalId: 'SIM-000003', inicio: bloque.inicio, veterinarioId: bloque.veterinarioId }), 409, 'BLOQUE_OCUPADO');
  });
  await prueba('sin horario: asigna el primer bloque libre (repetible) -> 201', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' }), 201);
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' }), 201);
  });
  await prueba('animal fallecido -> 409 ANIMAL_FALLECIDO (RF-02)', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino2', { animalId: 'SIM-000004' }), 409, 'ANIMAL_FALLECIDO'));
  await prueba('animal inexistente -> 404', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-777777' }), 404, 'ANIMAL_NO_ENCONTRADO'));
  await prueba('animal sin microchip SÍ se puede agendar (respuesta 4 del cliente)', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000002' }), 201));
  await prueba('animal de otro vecino -> 403', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000003' }), 403));
  await prueba('bloque que no existe (09:15) -> 400 BLOQUE_INVALIDO', async () => {
    const d = new Date(bloque.inicio); d.setUTCMinutes(d.getUTCMinutes() + 15);
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', inicio: iso(d) }), 400, 'BLOQUE_INVALIDO');
  });
  await prueba('bloque en el pasado -> 400', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', inicio: '2020-01-06T12:00:00Z' }), 400, 'BLOQUE_FUERA_DE_RANGO'));
  await prueba('animalId con caracteres raros o como objeto -> 400 (no llega a Mongo)', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: { $ne: null } }), 400);
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: '../../etc' }), 400, 'ID_INVALIDO');
  });
  await prueba('veterinario no puede agendar -> 403', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vet', { animalId: 'SIM-000001' }), 403, 'PERFIL_NO_AUTORIZADO'));
  await prueba('funcionario agenda a nombre de un tutor (solicitanteRut)', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-func', { animalId: 'SIM-000003' }), 400, 'RUT_INVALIDO');
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-func', { animalId: 'SIM-000003', solicitanteRut: '12222222-5' });
    esperar(r, 201);
    assert.strictEqual(r.datos.solicitanteRut, '12222222-5');
  });
  await prueba('RNF-04: M1 caído -> 503 en menos de 5 s y no se crea nada', async () => {
    const antes = dao.citas.length;
    m1Caido = true;
    const t0 = Date.now();
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' });
    m1Caido = false;
    esperar(r, 503, 'M1_NO_DISPONIBLE');
    assert.ok(Date.now() - t0 < 5000, 'tardó más de 5 s');
    assert.strictEqual(dao.citas.length, antes);
  });

  console.log('\nCV-05 Animal comunitario (RF-08)');
  await prueba('responsable registrado agenda -> 201', async () => {
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-com1', { animalId: 'SIM-000005' });
    esperar(r, 201);
    assert.strictEqual(r.datos.solicitanteRut, '13333333-9');
  });
  await prueba('otro comunitario -> 403', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-com2', { animalId: 'SIM-000005' }), 403));
  await prueba('animal comunitario sin responsable (agenda un funcionario) -> 409', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-func', { animalId: 'SIM-000099', solicitanteRut: '13333333-9' }), 409, 'RESPONSABLE_NO_REGISTRADO');
  });

  console.log(`\n${ok} pruebas OK, ${fallos} con fallos`);
  app.close(); nucleo.close(); m1.close();
  process.exit(fallos ? 1 : 0);
