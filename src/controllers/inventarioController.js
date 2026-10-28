// src/controllers/inventarioController.js
// Controlador del Módulo de Inventario PC Builder

const pool = require('../config/db');

// 🟢 GET: Obtener todo el inventario
exports.obtenerInventario = async (req, res) => {
  try {
    const query = `
      SELECT id, categoria, detalle, marca, costo_base_usd, 
             margen_ganancia, iva_aplicable, precio_final_usd, created_at
      FROM inventario_pc
      ORDER BY categoria ASC, detalle ASC
    `;
    const result = await pool.query(query);

    const inventario = result.rows.map(row => ({
      id: row.id,
      categoria: row.categoria,
      detalle: row.detalle,
      marca: row.marca,
      costo: parseFloat(row.costo_base_usd),
      ganancia: parseFloat(row.margen_ganancia),
      iva: parseFloat(row.iva_aplicable),
      precioFinal: parseFloat(row.precio_final_usd)
    }));

    res.json(inventario);
  } catch (error) {
    console.error('Error al obtener inventario:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el inventario', error: error.message });
  }
};

//  GET: Obtener categorías únicas
exports.obtenerCategorias = async (req, res) => {
  try {
    const query = `SELECT DISTINCT categoria FROM inventario_pc ORDER BY categoria ASC`;
    const result = await pool.query(query);
    res.json(result.rows.map(r => r.categoria));
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    res.status(500).json({ success: false, message: 'Error al obtener categorías', error: error.message });
  }
};

//  POST: Agregar artículo al inventario
exports.agregarArticulo = async (req, res) => {
  try {
    const { categoria, detalle, marca, costo, ganancia, iva } = req.body;

    if (!categoria || !detalle || !costo || costo <= 0) {
      return res.status(400).json({ success: false, message: 'Categoría, detalle y costo son obligatorios' });
    }

    const costoNum = parseFloat(costo);
    const gananciaNum = parseFloat(ganancia) || 30;
    const ivaNum = parseFloat(iva) || 10.5;

    const precioSinIva = costoNum * (1 + gananciaNum / 100);
    const precioFinal = precioSinIva * (1 + ivaNum / 100);

    const query = `
      INSERT INTO inventario_pc (categoria, detalle, marca, costo_base_usd, margen_ganancia, iva_aplicable, precio_final_usd)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, categoria, detalle, precio_final_usd
    `;
    const values = [categoria, detalle, marca || '', costoNum, gananciaNum, ivaNum, precioFinal];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Artículo agregado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al agregar artículo:', error);
    res.status(500).json({ success: false, message: 'Error al agregar el artículo', error: error.message });
  }
};

//  PUT: Editar artículo
exports.editarArticulo = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoria, detalle, marca, costo, ganancia, iva } = req.body;

    const checkResult = await pool.query('SELECT id FROM inventario_pc WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
    }

    const costoNum = parseFloat(costo);
    const gananciaNum = parseFloat(ganancia) || 30;
    const ivaNum = parseFloat(iva) || 10.5;
    const precioSinIva = costoNum * (1 + gananciaNum / 100);
    const precioFinal = precioSinIva * (1 + ivaNum / 100);

    const query = `
      UPDATE inventario_pc
      SET categoria = $1, detalle = $2, marca = $3, costo_base_usd = $4,
          margen_ganancia = $5, iva_aplicable = $6, precio_final_usd = $7
      WHERE id = $8
      RETURNING id, detalle, precio_final_usd
    `;
    const values = [categoria, detalle, marca || '', costoNum, gananciaNum, ivaNum, precioFinal, id];
    const result = await pool.query(query, values);

    res.json({ success: true, message: 'Artículo actualizado', data: result.rows[0] });
  } catch (error) {
    console.error('Error al editar artículo:', error);
    res.status(500).json({ success: false, message: 'Error al editar el artículo', error: error.message });
  }
};

// 🔴 DELETE: Eliminar artículo
exports.eliminarArticulo = async (req, res) => {
  try {
    const { id } = req.params;
    const checkResult = await pool.query('SELECT id FROM inventario_pc WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
    }
    await pool.query('DELETE FROM inventario_pc WHERE id = $1', [id]);
    res.json({ success: true, message: 'Artículo eliminado' });
  } catch (error) {
    console.error('Error al eliminar artículo:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el artículo', error: error.message });
  }
};