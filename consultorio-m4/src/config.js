'use strict';

// Toda la configuración sale de variables de entorno: no hay claves ni URLs privadas en el código (OWASP A02/A05).

function lista(valor) {
  return String(valor || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function cargarConfig(env = process.env) {
  const nucleoUrl = (env.NUCLEO_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return {
    puerto: parseInt(env.PORT, 10) || 4000,
    nucleoUrl,
    m1Url: (env.M1_URL || `${nucleoUrl}/api/registro`).replace(/\/+$/, ''),
    mongoUri: env.MONGODB_URI || '',
    mongoDb: env.MONGODB_DB || 'consultorio_m4',
    permitirMemoria: env.ALLOW_MEMORY === '1',
    veterinarios: lista(env.VETERINARIOS || '15555555-6,16666666-K'),
    tz: env.CLINICA_TZ || 'America/Santiago',
    // El núcleo gratuito puede estar dormido (~30 s la primera vez); el M1 debe fallar rápido (RNF-04: < 5 s)
    nucleoTimeoutMs: parseInt(env.NUCLEO_TIMEOUT_MS, 10) || 20000,
    m1TimeoutMs: parseInt(env.M1_TIMEOUT_MS, 10) || 4000,
    corsOrigin: env.CORS_ORIGIN || '',
    limitePorMinuto: parseInt(env.LIMITE_POR_MINUTO, 10) || 300,
    sembrarDemo: env.SEED_DEMO !== '0',
    horizonteDias: 60,
    plazoCancelacionHoras: 24
  };
}

module.exports = { cargarConfig };
