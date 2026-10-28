// src/controllers/finanzasController.js
const pool = require('../config/db');

// 🟢 GET: Obtener todos los movimientos
exports.obtenerMovimientos = async (req, res) => {
  try {
    const query = `
      SELECT mf.id, mf.fecha_movimiento, mf.tipo, mf.descripcion, mf.monto, mf.comprobante, mf.id_origen, mf.created_at, 
             mf.es_transferencia_interna, mf.es_gasto_caja_chica,
             cf.id AS categoria_id, cf.nombre AS categoria_nombre, cf.icono AS categoria_icono, cf.color_hex AS categoria_color, cf.ambito AS categoria_ambito,
             sf.id AS subcategoria_id, sf.nombre AS subcategoria_nombre, sf.icono AS subcategoria_icono,
             mp.id AS metodo_pago_id, mp.nombre AS metodo_pago_nombre, mp.icono AS metodo_pago_icono
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      LEFT JOIN subcategorias_finanzas sf ON mf.subcategoria_id = sf.id
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      ORDER BY mf.fecha_movimiento DESC, mf.created_at DESC
    `;
    const result = await pool.query(query);
    
    const movimientos = result.rows.map(row => ({
      id: row.id,
      fecha: row.fecha_movimiento,
      tipo: row.tipo,
      descripcion: row.descripcion,
      monto: parseFloat(row.monto),
      comprobante: row.comprobante,
      id_origen: row.id_origen,
      es_transferencia_interna: row.es_transferencia_interna || false,
      es_gasto_caja_chica: row.es_gasto_caja_chica || false,
      categoria: row.categoria_id ? {
        id: row.categoria_id, nombre: row.categoria_nombre, icono: row.categoria_icono, color: row.categoria_color, ambito: row.categoria_ambito
      } : null,
      subcategoria: row.subcategoria_id ? {
        id: row.subcategoria_id, nombre: row.subcategoria_nombre, icono: row.subcategoria_icono
      } : null,
      metodo_pago: row.metodo_pago_id ? {
        id: row.metodo_pago_id, nombre: row.metodo_pago_nombre, icono: row.metodo_pago_icono
      } : null
    }));
    res.json(movimientos);
  } catch (error) {
    console.error('Error al obtener movimientos:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 GET: Obtener categorías
exports.obtenerCategorias = async (req, res) => {
  try {
    const query = `
      SELECT cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito,
        COALESCE(json_agg(json_build_object('id', sf.id, 'nombre', sf.nombre, 'icono', sf.icono) ORDER BY sf.nombre) FILTER (WHERE sf.id IS NOT NULL), '[]'::json) AS subcategorias
      FROM categorias_finanzas cf
      LEFT JOIN subcategorias_finanzas sf ON cf.id = sf.categoria_id
      GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito
      ORDER BY cf.nombre ASC
    `;
    res.json((await pool.query(query)).rows);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

//  GET: Métodos de pago
exports.obtenerMetodosPago = async (req, res) => {
  try {
    res.json((await pool.query('SELECT id, nombre, icono, color_hex FROM metodos_pago ORDER BY nombre ASC')).rows);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 GET: Resumen
exports.obtenerResumen = async (req, res) => {
  try {
    const result = await pool.query('SELECT tipo, COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM movimientos_finanzas GROUP BY tipo');
    const resumen = { ingresos: 0, egresos: 0, balance: 0 };
    result.rows.forEach(r => {
      if (r.tipo === 'Ingreso') resumen.ingresos = parseFloat(r.total);
      else resumen.egresos = parseFloat(r.total);
    });
    resumen.balance = resumen.ingresos - resumen.egresos;
    res.json(resumen);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟡 POST: Crear movimiento
exports.crearMovimiento = async (req, res) => {
  try {
    const { fecha, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, comprobante, es_transferencia_interna, es_gasto_caja_chica } = req.body;
    if (!fecha || !tipo || !descripcion || !monto || monto <= 0) return res.status(400).json({ success: false, message: 'Campos obligatorios incompletos' });
    
    const query = `
      INSERT INTO movimientos_finanzas (fecha_movimiento, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, comprobante, es_transferencia_interna, es_gasto_caja_chica)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `;
    const result = await pool.query(query, [fecha, tipo, categoria_id||null, subcategoria_id||null, metodo_pago_id||null, descripcion, monto, comprobante||null, es_transferencia_interna||false, es_gasto_caja_chica||false]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟡 PUT: Editar movimiento
exports.editarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, comprobante, es_transferencia_interna, es_gasto_caja_chica } = req.body;
    
    const query = `
      UPDATE movimientos_finanzas SET fecha_movimiento=$1,tipo=$2,categoria_id=$3,subcategoria_id=$4,metodo_pago_id=$5,descripcion=$6,monto=$7,comprobante=$8,es_transferencia_interna=$9,es_gasto_caja_chica=$10 WHERE id=$11 RETURNING id
    `;
    const result = await pool.query(query, [fecha, tipo, categoria_id||null, subcategoria_id||null, metodo_pago_id||null, descripcion, monto, comprobante||null, es_transferencia_interna||false, es_gasto_caja_chica||false, id]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'No encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔴 DELETE: Eliminar movimiento
exports.eliminarMovimiento = async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM movimientos_finanzas WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'No encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};