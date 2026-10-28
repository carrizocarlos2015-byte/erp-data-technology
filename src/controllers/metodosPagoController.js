// src/controllers/metodosPagoController.js
// Controlador de Gestión de Métodos de Pago
const pool = require('../config/db');

// GET: Obtener métodos de pago con conteo de movimientos
exports.obtenerMetodosPagoGestion = async (req, res) => {
  try {
    const query = `
      SELECT 
        mp.id, 
        mp.nombre, 
        mp.icono, 
        mp.color_hex,
        COUNT(mf.id) AS cantidad_movimientos
      FROM metodos_pago mp
      LEFT JOIN movimientos_finanzas mf ON mf.metodo_pago_id = mp.id
      GROUP BY mp.id, mp.nombre, mp.icono, mp.color_hex
      ORDER BY mp.nombre ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener métodos de pago:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST: Crear nuevo método de pago
exports.crearMetodoPago = async (req, res) => {
  try {
    const { nombre, icono, color_hex } = req.body;
    
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
    }
    
    const query = `
      INSERT INTO metodos_pago (nombre, icono, color_hex)
      VALUES ($1, $2, $3)
      RETURNING id, nombre, icono, color_hex
    `;
    const result = await pool.query(query, [nombre.trim(), icono || '', color_hex || '#6c757d']);
    
    res.status(201).json({
      success: true,
      message: 'Método de pago creado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear método de pago:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT: Editar método de pago
exports.editarMetodoPago = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, icono, color_hex } = req.body;
    
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
    }
    
    const query = `
      UPDATE metodos_pago
      SET nombre = $1, icono = $2, color_hex = $3
      WHERE id = $4
      RETURNING id, nombre, icono, color_hex
    `;
    const result = await pool.query(query, [nombre.trim(), icono || '', color_hex || '#6c757d', id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Método de pago no encontrado' });
    }
    
    res.json({
      success: true,
      message: 'Método de pago actualizado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al editar método de pago:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE: Eliminar método de pago (solo si no tiene movimientos)
exports.eliminarMetodoPago = async (req, res) => {
  try {
    const { id } = req.params;
    
    const checkQuery = `SELECT COUNT(*) AS total FROM movimientos_finanzas WHERE metodo_pago_id = $1`;
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (parseInt(checkResult.rows[0].total) > 0) {
      return res.status(400).json({
        success: false,
        message: 'No se puede eliminar: el método de pago tiene movimientos asociados'
      });
    }
    
    const result = await pool.query('DELETE FROM metodos_pago WHERE id = $1 RETURNING nombre', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Método de pago no encontrado' });
    }
    
    res.json({ success: true, message: 'Método de pago eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar método de pago:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};