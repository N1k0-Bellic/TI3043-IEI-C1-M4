// [PENDIENTE] contenido de commits anteriores no disponible (reconstruido desde parche)
      h('p', { class: 'ayuda' }, 'Se usan los usuarios del núcleo. Ejemplos: 11111111-1 (vecino), 13333333-9 (comunitario), 15555555-6 (veterinario), 17777777-3 (funcionario).')));
  }

  // ---------- agendar (CV-01, CV-05) ----------
  async function verHorarios(fecha) {
    const d = await api('GET', `/api/consultorio/horarios?fecha=${encodeURIComponent(fecha)}&limit=100`);
    estado.horarios = d.datos;
    estado.elegido = null;
    if (d.datos.length === 0) aviso('error', 'No hay bloques libres ese día (fines de semana y fechas pasadas no tienen atención).');
  }

  function vistaAgendar() {
    const animal = h('input', { id: 'animal', placeholder: 'SIM-000001', maxlength: '40' });
    const solicitante = sesion.perfil === 'funcionario' ? h('input', { id: 'solicitante', placeholder: '11111111-1' }) : null;
    const fecha = h('input', { id: 'fecha', type: 'date' });
    const motivo = h('input', { id: 'motivo', maxlength: '200', placeholder: 'Control sano, vacunación…' });
    return h('section', { class: 'tarjeta' },
      h('h2', {}, 'Agendar una cita'),
      h('div', { class: 'fila' },
        h('div', {}, h('label', { for: 'animal' }, 'Identificador del animal (M1)'), animal),
        solicitante ? h('div', {}, h('label', { for: 'solicitante' }, 'RUT del tutor o responsable'), solicitante) : null,
        h('div', {}, h('label', { for: 'fecha' }, 'Fecha'), fecha),
        h('button', { class: 'sec', onclick: () => accion(() => verHorarios(fecha.value)) }, 'Ver horarios')),
      h('div', { class: 'bloques' }, estado.horarios.map((b) =>
        h('button', {
          class: estado.elegido === b ? 'elegido' : '',
          onclick: () => { estado.elegido = b; dibujar(); }
        }, `${hora(b.inicio)} · ${b.veterinarioId}`))),
      h('label', { for: 'motivo' }, 'Motivo (opcional)'), motivo,
      h('p', {}, h('button', {
        onclick: () => accion(async () => {
          const cuerpo = { animalId: animal.value.trim(), motivo: motivo.value.trim() };
          if (solicitante) cuerpo.solicitanteRut = solicitante.value.trim();
          if (estado.elegido) { cuerpo.inicio = estado.elegido.inicio; cuerpo.veterinarioId = estado.elegido.veterinarioId; }
          const c = await api('POST', '/api/consultorio/citas', cuerpo);
          estado.horarios = []; estado.elegido = null;
          aviso('ok', `Cita ${c.citaId} agendada para ${fechaHora(c.inicio)}.`);
          await cargarCitas();
        })
      }, estado.elegido ? 'Agendar en el bloque elegido' : 'Agendar en el primer bloque libre')));
  }

  // ---------- citas / agenda ----------
  async function cargarCitas() {
    const d = await api('GET', '/api/consultorio/citas?limit=50');
// [PENDIENTE] contenido de commits anteriores no disponible (reconstruido desde parche)
      estado.aviso = null;
    }
    if (!sesion) { app.append(vistaLogin()); return; }
    if (['vecino', 'comunitario', 'funcionario'].includes(sesion.perfil)) app.append(vistaAgendar());
    app.append(vistaCitas());
    if (!['vecino', 'comunitario', 'funcionario', 'veterinario'].includes(sesion.perfil)) {
      app.append(h('p', { class: 'ayuda' }, 'Su perfil solo puede consultar la agenda.'));
