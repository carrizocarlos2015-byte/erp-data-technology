// src/config/db.js
// Conexión a la Base de Datos PostgreSQL (Supabase) - Versión robusta

const { Pool } = require('pg');
require('dotenv').config();

// Forzar resolución DNS a IPv4 (evita problemas con IPv6)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Parsear la URL de conexión
const url = new URL(process.env.DATABASE_URL);

const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.substring(1), // Quitar el '/' inicial
  user: url.username,
  password: decodeURIComponent(url.password), // Decodificar caracteres especiales
  ssl: { 
    rejectUnauthorized: false // Supabase requiere SSL
  },
  connectionTimeoutMillis: 10000, // 10 segundos de timeout
  idleTimeoutMillis: 30000, // 30 segundos de inactividad
});

// Evento: cuando se conecta exitosamente
pool.on('connect', () => {
  console.log('✅ Conectado a la Base de Datos PostgreSQL (Supabase)');
});

// Evento: si hay un error de conexión
pool.on('error', (err) => {
  console.error('❌ Error inesperado en el Pool de DB:', err.message);
});

// Exportamos el pool para usarlo en otros archivos
module.exports = pool;