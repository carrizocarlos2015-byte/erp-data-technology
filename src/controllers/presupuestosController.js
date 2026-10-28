// src/controllers/presupuestosController.js
// Controlador del Módulo de Presupuestos (Historial)

const pool = require('../config/db');

//  GET: Obtener historial de presupuestos
exports.obtenerHistorial = async (req, res) => {
  try {
    const query = `
      SELECT id, numero, fecha, cliente_id, cliente_nombre, cliente_cuit,
             cliente_telefono, detalle, detalle_legible, moneda,
             subtotal_usd, descuento_porcentaje, motivo_descuento,
             total_usd, cotizacion_dolar, estado, observaciones
      FROM presupuestos
      ORDER BY fecha DESC
    `;
    const result = await pool.query(query);

    const presupuestos = result.rows.map(row => ({
      id: row.id,
      numero: row.numero,
      fecha: row.fecha ? new Date(row.fecha).toLocaleString('es-AR') : '',
      cliente_id: row.cliente_id,
      cliente: row.cliente_nombre,
      cuit: row.cliente_cuit,
      telefono: row.cliente_telefono,
      detalle: typeof row.detalle === 'string' ? JSON.parse(row.detalle) : row.detalle,
      detalleLegible: row.detalle_legible,
      moneda: row.moneda,
      subtotalUsd: parseFloat(row.subtotal_usd),
      descuentoPorcentaje: parseFloat(row.descuento_porcentaje),
      motivoDescuento: row.motivo_descuento,
      totalUsd: parseFloat(row.total_usd),
      cotizacionDolar: parseFloat(row.cotizacion_dolar),
      estado: row.estado,
      observaciones: row.observaciones
    }));

    res.json(presupuestos);
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el historial', error: error.message });
  }
};

// 🟢 GET: Obtener un presupuesto específico
exports.obtenerPresupuesto = async (req, res) => {
  try {
    const { numero } = req.params;
    const query = `
      SELECT * FROM presupuestos WHERE numero = $1
    `;
    const result = await pool.query(query, [numero]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      numero: row.numero,
      fecha: row.fecha ? new Date(row.fecha).toLocaleString('es-AR') : '',
      cliente_id: row.cliente_id,
      cliente: row.cliente_nombre,
      cuit: row.cliente_cuit,
      telefono: row.cliente_telefono,
      detalle: typeof row.detalle === 'string' ? JSON.parse(row.detalle) : row.detalle,
      detalleLegible: row.detalle_legible,
      moneda: row.moneda,
      subtotalUsd: parseFloat(row.subtotal_usd),
      descuentoPorcentaje: parseFloat(row.descuento_porcentaje),
      motivoDescuento: row.motivo_descuento,
      totalUsd: parseFloat(row.total_usd),
      cotizacionDolar: parseFloat(row.cotizacion_dolar),
      estado: row.estado,
      observaciones: row.observaciones
    });
  } catch (error) {
    console.error('Error al obtener presupuesto:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el presupuesto', error: error.message });
  }
};

// 🟡 POST: Guardar nuevo presupuesto
exports.guardarPresupuesto = async (req, res) => {
  try {
    const {
      cliente_id, cliente_nombre, cliente_cuit, cliente_telefono,
      detalle, moneda, subtotal_usd, descuento_porcentaje,
      motivo_descuento, total_usd, cotizacion_dolar, estado, observaciones
    } = req.body;

    if (!detalle || !Array.isArray(detalle) || detalle.length === 0) {
      return res.status(400).json({ success: false, message: 'El presupuesto debe tener al menos un artículo' });
    }

    // Generar número automático
    const countResult = await pool.query('SELECT COUNT(*) FROM presupuestos');
    const nuevoNumero = parseInt(countResult.rows[0].count) + 1;
    const numero = `PRE-${String(nuevoNumero).padStart(4, '0')}`;

    const detalleLegible = detalle.map(d => (d.cantidad > 1 ? d.cantidad + 'x ' : '') + d.nombre).join(' | ');

    const query = `
      INSERT INTO presupuestos 
      (numero, cliente_id, cliente_nombre, cliente_cuit, cliente_telefono,
       detalle, detalle_legible, moneda, subtotal_usd, descuento_porcentaje,
       motivo_descuento, total_usd, cotizacion_dolar, estado, observaciones)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING numero, fecha
    `;
    const values = [
      numero,
      cliente_id || null,
      cliente_nombre || 'Cliente General',
      cliente_cuit || '',
      cliente_telefono || '',
      JSON.stringify(detalle),
      detalleLegible,
      moneda || 'USD',
      parseFloat(subtotal_usd) || 0,
      parseFloat(descuento_porcentaje) || 0,
      motivo_descuento || '',
      parseFloat(total_usd) || 0,
      parseFloat(cotizacion_dolar) || 0,
      estado || 'Pendiente',
      observaciones || ''
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: `Presupuesto ${numero} guardado correctamente`,
      numeroPresupuesto: numero,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al guardar presupuesto:', error);
    res.status(500).json({ success: false, message: 'Error al guardar el presupuesto', error: error.message });
  }
};

// 🟠 PUT: Actualizar estado de presupuesto
exports.actualizarEstado = async (req, res) => {
  try {
    const { numero } = req.params;
    const { estado, observaciones } = req.body;

    const query = `
      UPDATE presupuestos
      SET estado = $1, observaciones = $2
      WHERE numero = $3
      RETURNING numero, estado
    `;
    const result = await pool.query(query, [estado, observaciones || '', numero]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
    }

    res.json({ success: true, message: 'Estado actualizado', data: result.rows[0] });
  } catch (error) {
    console.error('Error al actualizar estado:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el estado', error: error.message });
  }
};

// 🔴 DELETE: Eliminar presupuesto
exports.eliminarPresupuesto = async (req, res) => {
  try {
    const { numero } = req.params;
    const checkResult = await pool.query('SELECT numero FROM presupuestos WHERE numero = $1', [numero]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
    }
    await pool.query('DELETE FROM presupuestos WHERE numero = $1', [numero]);
    res.json({ success: true, message: 'Presupuesto eliminado' });
  } catch (error) {
    console.error('Error al eliminar presupuesto:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el presupuesto', error: error.message });
  }
};