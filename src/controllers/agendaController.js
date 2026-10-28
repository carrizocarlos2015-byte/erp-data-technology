// src/controllers/agendaController.js
// Controlador del Módulo de Agenda

const pool = require('../config/db');

// 🟢 GET: Obtener todos los eventos
exports.obtenerEventos = async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id,
        a.codigo_evento,
        a.titulo,
        a.cliente_id,
        a.fecha_inicio,
        a.fecha_fin,
        a.tipo_evento,
        a.estado,
        a.observaciones,
        a.monto_cobrado,
        a.metodo_pago,
        a.cobrado,
        a.created_at,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre
      FROM agenda a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      ORDER BY a.fecha_inicio DESC
    `;
    const result = await pool.query(query);

    const eventos = result.rows.map(row => ({
      id: row.id,
      codigo_evento: row.codigo_evento,
      titulo: row.titulo,
      cliente_id: row.cliente_id,
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin,
      tipo_evento: row.tipo_evento,
      estado: row.estado,
      observaciones: row.observaciones,
      monto_cobrado: parseFloat(row.monto_cobrado),
      metodo_pago: row.metodo_pago,
      cobrado: row.cobrado,
      cliente: row.cliente_id ? {
        id: row.cliente_id,
        codigo: row.codigo_cliente,
        nombre: row.cliente_nombre
      } : null
    }));

    res.json(eventos);
  } catch (error) {
    console.error('Error al obtener eventos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los eventos', error: error.message });
  }
};

// 🟢 GET: Obtener resumen (KPIs)
exports.obtenerResumen = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT estado, COUNT(*) AS cantidad,
             COALESCE(SUM(monto_cobrado), 0) AS total
      FROM agenda
      GROUP BY estado
    `);

    const resumen = {
      pendiente: { cantidad: 0, total: 0 },
      confirmado: { cantidad: 0, total: 0 },
      en_curso: { cantidad: 0, total: 0 },
      completado: { cantidad: 0, total: 0 },
      cancelado: { cantidad: 0, total: 0 },
      total_general: 0,
      cantidad_general: 0,
      cobrados: { cantidad: 0, total: 0 },
      pendientes_cobro: { cantidad: 0, total: 0 }
    };

    result.rows.forEach(row => {
      const estado = row.estado.toLowerCase().replace(' ', '_');
      if (resumen[estado]) {
        resumen[estado].cantidad = parseInt(row.cantidad);
        resumen[estado].total = parseFloat(row.total);
      }
      resumen.cantidad_general += parseInt(row.cantidad);
      resumen.total_general += parseFloat(row.total);
    });

    const resultCobros = await pool.query(`
      SELECT cobrado, COUNT(*) AS cantidad,
             COALESCE(SUM(monto_cobrado), 0) AS total
      FROM agenda
      GROUP BY cobrado
    `);

    resultCobros.rows.forEach(row => {
      if (row.cobrado) {
        resumen.cobrados = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      } else {
        resumen.pendientes_cobro = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      }
    });

    // Eventos próximos (próximas 24 horas, no completados ni cancelados)
    const resultProximos = await pool.query(`
      SELECT COUNT(*) AS cantidad
      FROM agenda
      WHERE fecha_inicio >= NOW()
        AND fecha_inicio <= NOW() + INTERVAL '24 hours'
        AND estado NOT IN ('Completado', 'Cancelado')
    `);
    resumen.proximos_24hs = parseInt(resultProximos.rows[0].cantidad);

    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener resumen:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el resumen', error: error.message });
  }
};

// 🟢 GET: Obtener clientes para el dropdown
exports.obtenerClientes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, codigo_cliente, nombre_razon_social
      FROM clientes WHERE activo = true
      ORDER BY codigo_cliente ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los clientes', error: error.message });
  }
};

// 🟡 POST: Crear un nuevo evento
exports.crearEvento = async (req, res) => {
  try {
    const {
      titulo, cliente_id, fecha_inicio, fecha_fin,
      tipo_evento, estado, observaciones, monto_cobrado, metodo_pago
    } = req.body;

    if (!titulo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ success: false, message: 'Título, fecha de inicio y fin son obligatorios' });
    }

    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return res.status(400).json({ success: false, message: 'La fecha de fin debe ser posterior a la de inicio' });
    }

    const countResult = await pool.query('SELECT COUNT(*) FROM agenda');
    const nuevoNumero = parseInt(countResult.rows[0].count) + 1;
    const codigoEvento = `EVT-${String(nuevoNumero).padStart(4, '0')}`;

    const query = `
      INSERT INTO agenda
      (codigo_evento, titulo, cliente_id, fecha_inicio, fecha_fin, tipo_evento,
       estado, observaciones, monto_cobrado, metodo_pago, cobrado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
      RETURNING id, codigo_evento, titulo, estado
    `;
    const values = [
      codigoEvento, titulo, cliente_id || null,
      fecha_inicio, fecha_fin,
      tipo_evento || 'Visita Técnica',
      estado || 'Pendiente',
      observaciones || null,
      monto_cobrado || 0,
      metodo_pago || null
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: `Evento registrado correctamente con código: ${codigoEvento}`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear evento:', error);
    res.status(500).json({ success: false, message: 'Error al crear el evento', error: error.message });
  }
};

// 🟠 PUT: Editar un evento (con integración a Finanzas)
exports.editarEvento = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      titulo, cliente_id, fecha_inicio, fecha_fin,
      tipo_evento, estado, observaciones, monto_cobrado, metodo_pago
    } = req.body;

    const checkResult = await pool.query('SELECT id, estado, cobrado FROM agenda WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    }

    const estadoAnterior = checkResult.rows[0].estado;
    const cobradoAnterior = checkResult.rows[0].cobrado;

    const query = `
      UPDATE agenda
      SET titulo = $1, cliente_id = $2, fecha_inicio = $3, fecha_fin = $4,
          tipo_evento = $5, estado = $6, observaciones = $7,
          monto_cobrado = $8, metodo_pago = $9
      WHERE id = $10
      RETURNING id, codigo_evento, titulo, estado
    `;
    const values = [
      titulo, cliente_id || null, fecha_inicio, fecha_fin,
      tipo_evento, estado, observaciones || null,
      monto_cobrado || 0, metodo_pago || null, id
    ];
    const result = await pool.query(query, values);

    // ✅ INTEGRACIÓN: Si se completó y tiene monto, registrar en Finanzas (solo una vez)
    if (estado === 'Completado' && !cobradoAnterior && monto_cobrado > 0) {
      const catResult = await pool.query('SELECT id FROM categorias_finanzas WHERE nombre = $1', ['Cobro Servicios']);

      if (catResult.rows.length > 0) {
        let metodoId = null;
        if (metodo_pago) {
          const mpResult = await pool.query('SELECT id FROM metodos_pago WHERE nombre = $1', [metodo_pago]);
          if (mpResult.rows.length > 0) metodoId = mpResult.rows[0].id;
        }

        await pool.query(`
          INSERT INTO movimientos_finanzas
          (fecha_movimiento, tipo, categoria_id, metodo_pago_id, descripcion, monto)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          new Date().toISOString().split('T')[0],
          'Ingreso',
          catResult.rows[0].id,
          metodoId,
          `Cobro agenda ${result.rows[0].codigo_evento} - ${titulo}`,
          monto_cobrado
        ]);

        await pool.query('UPDATE agenda SET cobrado = true WHERE id = $1', [id]);
      }
    }

    res.json({ success: true, message: 'Evento actualizado correctamente', data: result.rows[0] });
  } catch (error) {
    console.error('Error al editar evento:', error);
    res.status(500).json({ success: false, message: 'Error al editar el evento', error: error.message });
  }
};

// 🔴 DELETE: Eliminar un evento
exports.eliminarEvento = async (req, res) => {
  try {
    const { id } = req.params;
    const checkResult = await pool.query('SELECT id, codigo_evento FROM agenda WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    }

    await pool.query('DELETE FROM agenda WHERE id = $1', [id]);
    res.json({ success: true, message: 'Evento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar evento:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el evento', error: error.message });
  }
};