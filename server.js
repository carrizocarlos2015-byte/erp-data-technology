// server.js
const express = require('express');
const cors = require('cors');
const pool = require('./src/config/db');

// Importar rutas
const clienteRoutes = require('./src/routes/clienteRoutes');
const cuentaCorrienteRoutes = require('./src/routes/cuentaCorrienteRoutes');
const finanzasRoutes = require('./src/routes/finanzasRoutes');
const chequesRoutes = require('./src/routes/chequesRoutes');
const trabajosRoutes = require('./src/routes/trabajosRoutes');
const agendaRoutes = require('./src/routes/agendaRoutes');
const empresaRoutes = require('./src/routes/empresaRoutes');
const inventarioRoutes = require('./src/routes/inventarioRoutes');
const presupuestosRoutes = require('./src/routes/presupuestosRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(cors());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('🚀 API del ERP Data Technology está corriendo...');
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, message: '✅ Conexión exitosa', timestamp: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ success: false, message: '❌ Error de conexión', error: error.message });
  }
});

// Usar rutas
app.use('/api/clientes', clienteRoutes);
app.use('/api/cuenta-corriente', cuentaCorrienteRoutes);
app.use('/api/finanzas', finanzasRoutes);
app.use('/api/cheques', chequesRoutes);
app.use('/api/trabajos', trabajosRoutes);
app.use('/api/agenda', agendaRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/presupuestos', presupuestosRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Puerto: ${PORT}`);
});