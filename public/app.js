'use strict';

// Interfaz del consultorio. Regla de seguridad (OWASP A03): todo lo que viene de la API se muestra con
// textContent / nodos de texto, NUNCA con innerHTML, para que un texto malicioso no se ejecute como HTML.

(() => {
  const TZ = 'America/Santiago';
  let config = { nucleoUrl: '' };
  let sesion = null;
  try { sesion = JSON.parse(sessionStorage.getItem('sesion')); } catch (e) { sesion = null; }

  const estado = { aviso: null, horarios: [], elegido: null, citas: null, abierta: null, historial: null };

  // ---------- utilidades ----------
  function h(tag, props, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const c of hijos.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  function fechaHora(isoUtc) {
    return new Date(isoUtc).toLocaleString('es-CL', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
  }
  function hora(isoUtc) {
    return new Date(isoUtc).toLocaleTimeString('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }

  function aviso(tipo, mensaje) { estado.aviso = { tipo, mensaje }; }

  async function api(metodo, ruta, cuerpo) {
    const r = await fetch(ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(sesion ? { Authorization: `Bearer ${sesion.token}` } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && sesion) cerrarSesion('Su sesión venció. Inicie sesión nuevamente.');
      throw new Error(datos.error ? datos.error.mensaje : `Error ${r.status}`);
    }
    return datos;
  }

  async function accion(fn) {
    try { await fn(); } catch (e) { aviso('error', e.message); }
    dibujar();
  }

  function cerrarSesion(mensaje) {
    sesion = null;
    try { sessionStorage.removeItem('sesion'); } catch (e) { /* sin almacenamiento: nada que borrar */ }
    Object.assign(estado, { horarios: [], elegido: null, citas: null, abierta: null, historial: null });
    if (mensaje) aviso('error', mensaje);
  }

  // ---------- inicio de sesión (contra el núcleo) ----------
  async function iniciarSesion(rut, clave) {
    const r = await fetch(`${config.nucleoUrl}/api/nucleo/sesiones`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rut, clave })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ? d.error.mensaje : 'No se pudo iniciar sesión');
    sesion = { token: d.token, rut: d.rut, perfil: d.perfil, nombre: d.nombre };
    try { sessionStorage.setItem('sesion', JSON.stringify(sesion)); } catch (e) { /* sin almacenamiento: la sesión vive en memoria */ }
  }

  function vistaLogin() {
    const rut = h('input', { id: 'rut', placeholder: '11111111-1', autocomplete: 'username' });
    const clave = h('input', { id: 'clave', type: 'password', autocomplete: 'current-password' });
    return h('section', { class: 'tarjeta' },
      h('h2', {}, 'Iniciar sesión'),
      h('form', {
        onsubmit: (ev) => {
          ev.preventDefault();
          accion(async () => { await iniciarSesion(rut.value.trim(), clave.value); aviso('ok', `Bienvenido/a, ${sesion.nombre}`); await cargarCitas(); });
        }
      },
      h('label', { for: 'rut' }, 'RUT (sin puntos, con guión)'), rut,
      h('label', { for: 'clave' }, 'Clave'), clave,
      h('p', {}, h('button', { type: 'submit' }, 'Entrar')),
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
    estado.citas = d;
  }

  async function cambiar(citaId, nuevo, extra) {
    await api('PATCH', `/api/consultorio/citas/${encodeURIComponent(citaId)}/estado`, { estado: nuevo, ...(extra || {}) });
    estado.abierta = null;
    aviso('ok', `Cita ${citaId}: ahora está "${nuevo}".`);
    await cargarCitas();
  }

  function formularioAtencion(c) {
    const dx = h('textarea', { id: 'dx', placeholder: 'Diagnóstico (obligatorio)' });
    const tx = h('textarea', { id: 'tx', placeholder: 'Tratamiento o indicaciones (obligatorio)' });
    const rx = h('textarea', { id: 'rx', placeholder: 'Receta (si corresponde)' });
    return h('div', { class: 'ficha' },
      h('label', {}, 'Diagnóstico'), dx, h('label', {}, 'Tratamiento o indicaciones'), tx, h('label', {}, 'Receta'), rx,
      h('p', { class: 'acciones' },
        h('button', {
          onclick: () => accion(() => cambiar(c.citaId, 'atendida', { ficha: { diagnostico: dx.value, tratamiento: tx.value, receta: rx.value } }))
        }, 'Guardar atención'),
        h('button', { class: 'sec', onclick: () => { estado.abierta = null; dibujar(); } }, 'Cerrar')));
  }

  function vistaCitas() {
    const esVet = sesion.perfil === 'veterinario';
    const puedeGestionar = ['vecino', 'comunitario', 'funcionario'].includes(sesion.perfil);
    const lista = estado.citas ? estado.citas.datos : [];
    const titulo = ['vecino', 'comunitario'].includes(sesion.perfil) ? 'Mis citas' : 'Agenda general';
    return h('section', { class: 'tarjeta' },
      h('div', { class: 'fila' },
        h('h2', {}, titulo),
        h('button', { class: 'sec', onclick: () => accion(cargarCitas) }, 'Actualizar'),
        ['veterinario', 'jefatura', 'admin'].includes(sesion.perfil)
          ? h('button', { class: 'sec', onclick: () => accion(async () => {
            const r = await api('POST', '/api/consultorio/citas/ausentes');
            aviso('ok', `Citas marcadas como ausentes: ${r.marcadas}.`); await cargarCitas();
          }) }, 'Marcar ausentes ahora') : null),
      lista.length === 0 ? h('p', { class: 'ayuda' }, 'No hay citas para mostrar.') :
        h('div', { class: 'tabla-scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Cita', 'Horario', 'Animal', 'Veterinario', 'Estado', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, lista.flatMap((c) => {
            const activa = c.estado === 'agendada' || c.estado === 'confirmada';
            const fila = h('tr', {},
              h('td', {}, c.citaId), h('td', {}, fechaHora(c.inicio)), h('td', {}, c.animalId), h('td', {}, c.veterinarioId),
              h('td', {}, h('span', { class: `estado ${c.estado}` }, c.estado)),
              h('td', {}, h('div', { class: 'acciones' },
                activa && puedeGestionar && c.estado === 'agendada' ? h('button', { class: 'sec', onclick: () => accion(() => cambiar(c.citaId, 'confirmada')) }, 'Confirmar') : null,
                activa && puedeGestionar ? h('button', { class: 'peligro', onclick: () => accion(() => cambiar(c.citaId, 'cancelada')) }, 'Cancelar') : null,
                activa && esVet ? h('button', { onclick: () => { estado.abierta = c.citaId; dibujar(); } }, 'Atender') : null)));
            const filas = [fila];
            if (estado.abierta === c.citaId) filas.push(h('tr', {}, h('td', { colspan: '6' }, formularioAtencion(c))));
            return filas;
          })))),
      estado.citas ? h('p', { class: 'ayuda' }, `${estado.citas.total} cita(s) en total.`) : null);
  }

  // ---------- pantalla ----------
  function dibujar() {
    const cab = document.getElementById('sesion');
    cab.replaceChildren();
    if (sesion) {
      cab.append(h('span', {}, `${sesion.nombre} · ${sesion.perfil}`),
        h('button', { onclick: () => { cerrarSesion(); dibujar(); } }, 'Salir'));
    }
    const app = document.getElementById('app');
    app.replaceChildren();
    if (estado.aviso) {
      app.append(h('div', { class: `aviso ${estado.aviso.tipo}`, role: 'status' }, estado.aviso.mensaje));
      estado.aviso = null;
    }
    if (!sesion) { app.append(vistaLogin()); return; }
    if (['vecino', 'comunitario', 'funcionario'].includes(sesion.perfil)) app.append(vistaAgendar());
    app.append(vistaCitas());
    if (!['vecino', 'comunitario', 'funcionario', 'veterinario'].includes(sesion.perfil)) {
      app.append(h('p', { class: 'ayuda' }, 'Su perfil solo puede consultar la agenda.'));
    }
  }

  async function iniciar() {
    try { config = await (await fetch('/api/consultorio/config')).json(); } catch (e) { aviso('error', 'No se pudo leer la configuración del servidor.'); }
    if (sesion) { try { await cargarCitas(); } catch (e) { aviso('error', e.message); } }
    dibujar();
  }
  iniciar();
})();
