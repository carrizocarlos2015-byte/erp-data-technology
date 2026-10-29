// src/controllers/finanzasController.js
const pool = require('../config/db');

// 🟢 GET: Obtener todos los movimientos de finanzas
exports.obtenerMovimientos = async (req, res) => {
  try {
    const query = `SELECT mf.id, mf.fecha_movimiento, mf.tipo, mf.descripcion, mf.monto, mf.comprobante, mf.id_origen, mf.created_at, mf.es_transferencia_interna, mf.es_gasto_caja_chica, cf.id AS categoria_id, cf.nombre AS categoria_nombre, cf.icono AS categoria_icono, cf.color_hex AS categoria_color, cf.ambito AS categoria_ambito, sf.id AS subcategoria_id, sf.nombre AS subcategoria_nombre, sf.icono AS subcategoria_icono, mp.id AS metodo_pago_id, mp.nombre AS metodo_pago_nombre, mp.icono AS metodo_pago_icono FROM movimientos_finanzas mf LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id LEFT JOIN subcategorias_finanzas sf ON mf.subcategoria_id = sf.id LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id ORDER BY mf.fecha_movimiento DESC, mf.created_at DESC`;
    const result = await pool.query(query);
    const movimientos = result.rows.map(row => ({
      id: row.id, fecha: row.fecha_movimiento, tipo: row.tipo, descripcion: row.descripcion,
      monto: parseFloat(row.monto), comprobante: row.comprobante, id_origen: row.id_origen,
      es_transferencia_interna: row.es_transferencia_interna || false,
      es_gasto_caja_chica: row.es_gasto_caja_chica || false,
      categoria: row.categoria_id ? { id: row.categoria_id, nombre: row.categoria_nombre, icono: row.categoria_icono, color: row.categoria_color, ambito: row.categoria_ambito } : null,
      subcategoria: row.subcategoria_id ? { id: row.subcategoria_id, nombre: row.subcategoria_nombre, icono: row.subcategoria_icono } : null,
      metodo_pago: row.metodo_pago_id ? { id: row.metodo_pago_id, nombre: row.metodo_pago_nombre, icono: row.metodo_pago_icono } : null
    }));
    res.json(movimientos);
  } catch (error) {
    console.error('Error al obtener movimientos de finanzas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los movimientos', error: error.message });
  }
};

//  GET: Obtener categorías con sus subcategorías
exports.obtenerCategorias = async (req, res) => {
  try {
    const query = `SELECT cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito, COALESCE(json_agg(json_build_object('id', sf.id, 'nombre', sf.nombre, 'icono', sf.icono) ORDER BY sf.nombre) FILTER (WHERE sf.id IS NOT NULL), '[]'::json) AS subcategorias FROM categorias_finanzas cf LEFT JOIN subcategorias_finanzas sf ON cf.id = sf.categoria_id GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito ORDER BY cf.nombre ASC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    res.status(500).json({ success: false, message: 'Error al obtener las categorías', error: error.message });
  }
};

//  GET: Obtener métodos de pago
exports.obtenerMetodosPago = async (req, res) => {
  try {
    const query = `SELECT id, nombre, icono, color_hex FROM metodos_pago ORDER BY nombre ASC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener métodos de pago:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los métodos de pago', error: error.message });
  }
};

//  GET: Obtener resumen
exports.obtenerResumen = async (req, res) => {
  try {
    const query = `SELECT tipo, COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM movimientos_finanzas GROUP BY tipo`;
    const result = await pool.query(query);
    const resumen = { ingresos: 0, egresos: 0, balance: 0, cantidad_ingresos: 0, cantidad_egresos: 0 };
    result.rows.forEach(row => {
      const total = parseFloat(row.total);
      const cantidad = parseInt(row.cantidad);
      if (row.tipo === 'Ingreso') { resumen.ingresos = total; resumen.cantidad_ingresos = cantidad; }
      else { resumen.egresos = total; resumen.cantidad_egresos = cantidad; }
    });
    resumen.balance = resumen.ingresos - resumen.egresos;
    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener resumen:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el resumen', error: error.message });
  }
};

//  POST: Crear un nuevo movimiento (con soporte para transferencias internas y caja chica)
exports.crearMovimiento = async (req, res) => {
  try {
    const { fecha, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, comprobante, es_transferencia_interna, es_gasto_caja_chica } = req.body;
    
    if (!fecha || !tipo || !descripcion || !monto || monto <= 0) return res.status(400).json({ success: false, message: 'Fecha, tipo, descripción y monto son obligatorios' });
    if (!['Ingreso', 'Egreso'].includes(tipo)) return res.status(400).json({ success: false, message: 'El tipo debe ser "Ingreso" o "Egreso"' });
    
    const query = `INSERT INTO movimientos_finanzas (fecha_movimiento, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, comprobante, es_transferencia_interna, es_gasto_caja_chica) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, fecha_movimiento, tipo, descripcion, monto, es_transferencia_interna, es_gasto_caja_chica`;
    const values = [fecha, tipo, categoria_id || null, subcategoria_id || null, metodo_pago_id || null, descripcion, monto, comprobante || null, es_transferencia_interna || false, es_gasto_caja_chica || false];
    const result = await pool.query(query, values);
    
    res.status(201).json({ success: true, message: `${tipo} registrado correctamente`, data: result.rows[0] });
  } catch (error) {
    console.error('Error al crear movimiento:', error);
    res.status(500).json({ success: false, message: 'Error al crear el movimiento', error: error.message });
  }
};

// 🟠 PUT: Editar un movimiento (con soporte para transferencias internas y caja chica)
exports.editarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, comprobante, es_transferencia_interna, es_gasto_caja_chica } = req.body;
    
    const checkQuery = 'SELECT id FROM movimientos_finanzas WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    if (checkResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
    
    const query = `UPDATE movimientos_finanzas SET fecha_movimiento = $1, tipo = $2, categoria_id = $3, subcategoria_id = $4, metodo_pago_id = $5, descripcion = $6, monto = $7, comprobante = $8, es_transferencia_interna = $9, es_gasto_caja_chica = $10 WHERE id = $11 RETURNING id, fecha_movimiento, tipo, descripcion, monto, es_transferencia_interna, es_gasto_caja_chica`;
    const values = [fecha, tipo, categoria_id || null, subcategoria_id || null, metodo_pago_id || null, descripcion, monto, comprobante || null, es_transferencia_interna || false, es_gasto_caja_chica || false, id];
    const result = await pool.query(query, values);
    
    res.json({ success: true, message: 'Movimiento actualizado correctamente', data: result.rows[0] });
  } catch (error) {
    console.error('Error al editar movimiento:', error);
    res.status(500).json({ success: false, message: 'Error al editar el movimiento', error: error.message });
  }
};

// 🔴 DELETE: Eliminar un movimiento
exports.eliminarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const checkQuery = 'SELECT id FROM movimientos_finanzas WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    if (checkResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
    
    await pool.query('DELETE FROM movimientos_finanzas WHERE id = $1', [id]);
    res.json({ success: true, message: 'Movimiento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar movimiento:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el movimiento', error: error.message });
  }
};