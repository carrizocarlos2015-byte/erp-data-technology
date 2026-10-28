// src/controllers/chequesController.js
// Controlador del Módulo de Cheques

const pool = require('../config/db');

// 🟢 GET: Obtener todos los cheques
exports.obtenerCheques = async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id,
        c.numero_cheque,
        c.banco,
        c.monto,
        c.fecha_emision,
        c.fecha_vencimiento,
        c.librador,
        c.estado,
        c.id_trabajo_origen,
        c.created_at,
        t.codigo_orden AS trabajo_codigo
      FROM cheques c
      LEFT JOIN trabajos t ON c.id_trabajo_origen = t.id
      ORDER BY c.fecha_vencimiento ASC, c.created_at DESC
    `;
    const result = await pool.query(query);

    const cheques = result.rows.map(row => ({
      id: row.id,
      numero_cheque: row.numero_cheque,
      banco: row.banco,
      monto: parseFloat(row.monto),
      fecha_emision: row.fecha_emision,
      fecha_vencimiento: row.fecha_vencimiento,
      librador: row.librador,
      estado: row.estado,
      id_trabajo_origen: row.id_trabajo_origen,
      trabajo_codigo: row.trabajo_codigo
    }));

    res.json(cheques);
  } catch (error) {
    console.error('Error al obtener cheques:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los cheques', error: error.message });
  }
};

// 🟢 GET: Obtener resumen (KPIs)
exports.obtenerResumen = async (req, res) => {
  try {
    const query = `
      SELECT
        estado,
        COUNT(*) AS cantidad,
        COALESCE(SUM(monto), 0) AS total
      FROM cheques
      GROUP BY estado
    `;
    const result = await pool.query(query);

    const resumen = {
      en_cartera: { cantidad: 0, total: 0 },
      depositado: { cantidad: 0, total: 0 },
      cobrado: { cantidad: 0, total: 0 },
      rechazado: { cantidad: 0, total: 0 },
      total_general: 0,
      cantidad_general: 0,
      proximos_a_vencer: { cantidad: 0, total: 0 },
      vencidos: { cantidad: 0, total: 0 }
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

    // Calcular próximos a vencer (dentro de 7 días) y vencidos
    const hoy = new Date().toISOString().split('T')[0];
    const en7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const queryVencimientos = `
      SELECT
        CASE
          WHEN fecha_vencimiento < $1 THEN 'vencidos'
          WHEN fecha_vencimiento BETWEEN $1 AND $2 THEN 'proximos'
          ELSE 'futuros'
        END AS categoria,
        COUNT(*) AS cantidad,
        COALESCE(SUM(monto), 0) AS total
      FROM cheques
      WHERE estado IN ('En Cartera', 'Depositado')
      GROUP BY categoria
    `;
    const resultVenc = await pool.query(queryVencimientos, [hoy, en7dias]);

    resultVenc.rows.forEach(row => {
      if (row.categoria === 'vencidos') {
        resumen.vencidos = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      } else if (row.categoria === 'proximos') {
        resumen.proximos_a_vencer = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      }
    });

    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener resumen:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el resumen', error: error.message });
  }
};

// 🟡 POST: Crear un nuevo cheque
exports.crearCheque = async (req, res) => {
  try {
    const { numero_cheque, banco, monto, fecha_emision, fecha_vencimiento, librador, estado, id_trabajo_origen } = req.body;

    if (!numero_cheque || !banco || !monto || !fecha_emision || !fecha_vencimiento || !librador) {
      return res.status(400).json({ success: false, message: 'Todos los campos obligatorios deben estar completos' });
    }

    const query = `
      INSERT INTO cheques (numero_cheque, banco, monto, fecha_emision, fecha_vencimiento, librador, estado, id_trabajo_origen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, numero_cheque, banco, monto, estado
    `;
    const values = [
      numero_cheque,
      banco,
      monto,
      fecha_emision,
      fecha_vencimiento,
      librador,
      estado || 'En Cartera',
      id_trabajo_origen || null
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Cheque registrado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear cheque:', error);
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'Ya existe un cheque con ese número en ese banco' });
    }
    res.status(500).json({ success: false, message: 'Error al crear el cheque', error: error.message });
  }
};

// 🟠 PUT: Editar un cheque (con integración automática a Finanzas)
exports.editarCheque = async (req, res) => {
  try {
    const { id } = req.params;
    const { numero_cheque, banco, monto, fecha_emision, fecha_vencimiento, librador, estado, id_trabajo_origen } = req.body;

    // Verificar que el cheque existe y obtener el estado anterior
    const checkQuery = 'SELECT id, estado FROM cheques WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cheque no encontrado' });
    }

    const estadoAnterior = checkResult.rows[0].estado;

    // Actualizar el cheque
    const query = `
      UPDATE cheques
      SET numero_cheque = $1, banco = $2, monto = $3, fecha_emision = $4,
          fecha_vencimiento = $5, librador = $6, estado = $7, id_trabajo_origen = $8
      WHERE id = $9
      RETURNING id, numero_cheque, banco, monto, estado
    `;
    const values = [
      numero_cheque, banco, monto, fecha_emision,
      fecha_vencimiento, librador, estado,
      id_trabajo_origen || null,
      id
    ];
    const result = await pool.query(query, values);

    // ✅ INTEGRACIÓN: Si el estado cambió a "Cobrado", registrar en Finanzas
    if (estado === 'Cobrado' && estadoAnterior !== 'Cobrado') {
      // Buscar categoría "Cobro Servicios"
      const catQuery = 'SELECT id FROM categorias_finanzas WHERE nombre = $1';
      const catResult = await pool.query(catQuery, ['Cobro Servicios']);
      
      // Buscar método de pago "Cheque"
      const mpQuery = 'SELECT id FROM metodos_pago WHERE nombre = $1';
      const mpResult = await pool.query(mpQuery, ['Cheque']);

      if (catResult.rows.length > 0 && mpResult.rows.length > 0) {
        const insertFinanzas = `
          INSERT INTO movimientos_finanzas 
          (fecha_movimiento, tipo, categoria_id, metodo_pago_id, descripcion, monto)
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const valoresFinanzas = [
          new Date().toISOString().split('T')[0], // Fecha de hoy
          'Ingreso',
          catResult.rows[0].id,
          mpResult.rows[0].id,
          `Cobro de cheque N° ${numero_cheque} - ${banco} - ${librador}`,
          monto
        ];
        await pool.query(insertFinanzas, valoresFinanzas);
      }
    }

    res.json({ success: true, message: 'Cheque actualizado correctamente', data: result.rows[0] });
  } catch (error) {
    console.error('Error al editar cheque:', error);
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'Ya existe un cheque con ese número en ese banco' });
    }
    res.status(500).json({ success: false, message: 'Error al editar el cheque', error: error.message });
  }
};

// 🔴 DELETE: Eliminar un cheque
exports.eliminarCheque = async (req, res) => {
  try {
    const { id } = req.params;

    const checkQuery = 'SELECT id, numero_cheque FROM cheques WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cheque no encontrado' });
    }

    await pool.query('DELETE FROM cheques WHERE id = $1', [id]);

    res.json({ success: true, message: 'Cheque eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar cheque:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el cheque', error: error.message });
  }
};