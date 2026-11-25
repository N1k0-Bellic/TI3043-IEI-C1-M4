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
          accion(async () => { await iniciarSesion(rut.value.trim(), clave.value); aviso('ok', `Bienvenido/a, ${sesion.nombre}`); });
        }
      },
      h('label', { for: 'rut' }, 'RUT (sin puntos, con guión)'), rut,
      h('label', { for: 'clave' }, 'Clave'), clave,
      h('p', {}, h('button', { type: 'submit' }, 'Entrar')),
      h('p', { class: 'ayuda' }, 'Se usan los usuarios del núcleo. Ejemplos: 11111111-1 (vecino), 13333333-9 (comunitario), 15555555-6 (veterinario), 17777777-3 (funcionario).')));
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
  }

  async function iniciar() {
    try { config = await (await fetch('/api/consultorio/config')).json(); } catch (e) { aviso('error', 'No se pudo leer la configuración del servidor.'); }
    dibujar();
  }
  iniciar();
})();
