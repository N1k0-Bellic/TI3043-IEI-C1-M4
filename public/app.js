'use strict';

// Interfaz del consultorio. Regla de seguridad (OWASP A03): todo lo que viene de la API se muestra con
// textContent / nodos de texto, NUNCA con innerHTML, para que un texto malicioso no se ejecute como HTML.

const estado = {
  token: null,
  usuario: null,
  nucleoUrl: '',
  vista: 'agenda',
  fecha: new Date().toISOString().slice(0, 10),
  citas: [],
  citaActiva: null,
  animalBuscado: null,
  historial: [],
  mensaje: null
};

const $ = (id) => document.getElementById(id);

function limpiar(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function texto(tag, valor, attrs = {}) {
  const el = document.createElement(tag);
  if (valor !== undefined && valor !== null) el.textContent = String(valor);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  return el;
}

function avisar(tipo, msg) {
  estado.mensaje = { tipo, msg };
  render();
}

async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const headers = { Accept: 'application/json' };
  if (estado.token) headers.Authorization = `Bearer ${estado.token}`;
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(ruta, {
    method: metodo,
    headers,
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(datos.error?.mensaje || `Error HTTP ${res.status}`);
    err.codigo = datos.error?.codigo;
    err.status = res.status;
    throw err;
  }
  return datos;
}

function renderSesion() {
  const box = $('sesion');
  limpiar(box);
  if (!estado.usuario) {
    box.appendChild(texto('span', 'Sin sesión iniciada'));
    return;
  }
  box.appendChild(texto('span', `${estado.usuario.nombre || estado.usuario.rut || 'Usuario'} · ${estado.usuario.perfil}`));
  box.appendChild(texto('button', 'Cerrar sesión', {
    type: 'button',
    class: 'secundario',
    onclick: () => {
      estado.token = null;
      estado.usuario = null;
      estado.citas = [];
      estado.citaActiva = null;
      estado.mensaje = null;
      render();
    }
  }));
}

function renderLogin(main) {
  const card = texto('section', '', { class: 'tarjeta login-box' });
  card.appendChild(texto('h2', 'Iniciar sesión'));
  card.appendChild(texto('p', 'Ingresa el token emitido por el núcleo municipal para operar en el consultorio.', { class: 'suave' }));

  const form = texto('form', '', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      const token = $('inp-token').value.trim();
      if (!token) return avisar('error', 'Debes ingresar un token.');
      estado.token = token;
      try {
        const sesion = await api('/api/consultorio/sesion');
        estado.usuario = sesion.usuario || sesion;
        estado.mensaje = null;
        await cargarAgenda();
      } catch (e) {
        estado.token = null;
        estado.usuario = null;
        avisar('error', e.message);
      }
    }
  });

  form.appendChild(texto('label', 'Token Bearer', { for: 'inp-token' }));
  form.appendChild(texto('input', '', { id: 'inp-token', type: 'password', placeholder: 'Pega tu token aquí', autocomplete: 'off' }));
  form.appendChild(texto('button', 'Entrar', { type: 'submit', class: 'primario' }));
  card.appendChild(form);
  main.appendChild(card);
}

async function cargarAgenda() {
  try {
    const data = await api(`/api/consultorio/citas?fecha=${encodeURIComponent(estado.fecha)}`);
    estado.citas = Array.isArray(data.citas) ? data.citas : (Array.isArray(data) ? data : []);
    render();
  } catch (e) {
    avisar('error', e.message);
  }
}

async function buscarAnimal(codigo) {
  const limpio = String(codigo || '').trim();
  if (!limpio) return avisar('error', 'Ingresa un identificador o chip de animal.');
  try {
    const data = await api(`/api/consultorio/animales/${encodeURIComponent(limpio)}`);
    estado.animalBuscado = data.animal || data;
    estado.historial = Array.isArray(data.historial) ? data.historial : [];
    render();
  } catch (e) {
    estado.animalBuscado = null;
    estado.historial = [];
    avisar('error', e.message);
  }
}

async function cambiarEstadoCita(cita, accion) {
  const id = cita?.id || cita?._id;
  if (!id) return avisar('error', 'No se encontró el identificador de la cita.');
  try {
    await api(`/api/consultorio/citas/${encodeURIComponent(id)}/${accion}`, { metodo: 'PATCH' });
    if (estado.citaActiva && (estado.citaActiva.id === id || estado.citaActiva._id === id)) {
      estado.citaActiva = { ...estado.citaActiva, estado: accion === 'ausente' ? 'ausente' : 'completada' };
    }
    estado.mensaje = {
      tipo: 'ok',
      msg: accion === 'ausente' ? 'Cita marcada como ausente.' : 'Atención de cita completada.'
    };
    await cargarAgenda();
  } catch (e) {
    avisar('error', e.message);
  }
}

function renderAgenda(main) {
  const sec = texto('section', '', { class: 'tarjeta' });
  const cab = texto('div', '', { class: 'barra-superior' });
  cab.appendChild(texto('h2', 'Agenda del día'));

  const filtro = texto('div', '', { class: 'fila-controles' });
  filtro.appendChild(texto('input', '', {
    type: 'date',
    value: estado.fecha,
    onchange: (ev) => { estado.fecha = ev.target.value; cargarAgenda(); }
  }));
  filtro.appendChild(texto('button', 'Actualizar', {
    type: 'button',
    class: 'secundario',
    onclick: () => cargarAgenda()
  }));
  cab.appendChild(filtro);
  sec.appendChild(cab);

  if (!estado.citas.length) {
    sec.appendChild(texto('p', 'No hay citas registradas para la fecha seleccionada.', { class: 'suave' }));
  } else {
    const tabla = texto('table', '', { class: 'tabla' });
    const thead = texto('thead');
    const trHead = texto('tr');
    ['Hora', 'Animal', 'Responsable', 'Estado', 'Acciones'].forEach((h) => trHead.appendChild(texto('th', h)));
    thead.appendChild(trHead);
    tabla.appendChild(thead);

    const tbody = texto('tbody');
    for (const c of estado.citas) {
      const tr = texto('tr');
      tr.appendChild(texto('td', c.hora || c.horario || '-'));
      tr.appendChild(texto('td', c.animalNombre || c.animalId || '-'));
      tr.appendChild(texto('td', c.responsableRut || c.tutorRut || '-'));
      tr.appendChild(texto('td', texto('span', c.estado || 'programada', { class: `badge estado-${c.estado || 'programada'}` })));

      const tdAcc = texto('td', '', { class: 'fila-controles' });
      tdAcc.appendChild(texto('button', 'Atender', {
        type: 'button',
        class: 'primario',
        onclick: () => {
          estado.citaActiva = c;
          estado.vista = 'atencion';
          if (c.animalId) buscarAnimal(c.animalId);
          else render();
        }
      }));
      tdAcc.appendChild(texto('button', 'Marcar ausente', {
        type: 'button',
        class: 'secundario',
        onclick: () => cambiarEstadoCita(c, 'ausente')
      }));
      tdAcc.appendChild(texto('button', 'Completar atención', {
        type: 'button',
        class: 'primario',
        onclick: () => cambiarEstadoCita(c, 'completar')
      }));
      tr.appendChild(tdAcc);
      tbody.appendChild(tr);
    }
    tabla.appendChild(tbody);
    sec.appendChild(tabla);
  }
  main.appendChild(sec);
}

function renderAtencion(main) {
  const sec = texto('section', '', { class: 'tarjeta' });
  const top = texto('div', '', { class: 'barra-superior' });
  top.appendChild(texto('h2', 'Atención clínica y búsqueda de animal'));
  top.appendChild(texto('button', 'Volver a agenda', {
    type: 'button',
    class: 'secundario',
    onclick: () => { estado.vista = 'agenda'; render(); }
  }));
  sec.appendChild(top);

  if (estado.citaActiva) {
    const barraCita = texto('div', '', { class: 'fila-controles' });
    barraCita.appendChild(texto('span', `Cita seleccionada: ${estado.citaActiva.hora || '-'} · Estado: ${estado.citaActiva.estado || 'programada'}`));
    barraCita.appendChild(texto('button', 'Marcar ausente', {
      type: 'button',
      class: 'secundario',
      onclick: () => cambiarEstadoCita(estado.citaActiva, 'ausente')
    }));
    barraCita.appendChild(texto('button', 'Completar atención', {
      type: 'button',
      class: 'primario',
      onclick: () => cambiarEstadoCita(estado.citaActiva, 'completar')
    }));
    sec.appendChild(barraCita);
  }

  const formBusq = texto('form', '', {
    class: 'fila-controles',
    onsubmit: (ev) => {
      ev.preventDefault();
      buscarAnimal($('inp-animal').value);
    }
  });
  formBusq.appendChild(texto('input', '', {
    id: 'inp-animal',
    type: 'text',
    placeholder: 'ID o código del animal',
    value: estado.citaActiva?.animalId || ''
  }));
  formBusq.appendChild(texto('button', 'Buscar animal', { type: 'submit', class: 'primario' }));
  sec.appendChild(formBusq);

  if (estado.animalBuscado) {
    const a = estado.animalBuscado;
    const ficha = texto('div', '', { class: 'ficha' });
    ficha.appendChild(texto('h3', a.nombre || `Animal ${a.id || ''}`));
    ficha.appendChild(texto('p', `Especie: ${a.especie || '-'} · Estado: ${a.estado || '-'}`));
    ficha.appendChild(texto('p', `Responsable / Tutor: ${a.responsableRut || a.tutorRut || 'No registrado'}`));
    sec.appendChild(ficha);
  }

  main.appendChild(sec);
}

function render() {
  renderSesion();
  const main = $('app');
  limpiar(main);

  if (estado.mensaje) {
    main.appendChild(texto('div', estado.mensaje.msg, { class: `alerta alerta-${estado.mensaje.tipo}` }));
  }

  if (!estado.usuario) {
    renderLogin(main);
    return;
  }

  if (estado.vista === 'atencion') {
    renderAtencion(main);
  } else {
    renderAgenda(main);
  }
}

async function iniciar() {
  try {
    const cfg = await api('/api/consultorio/config');
    estado.nucleoUrl = cfg.nucleoUrl || '';
  } catch (_) {}
  render();
}

iniciar();