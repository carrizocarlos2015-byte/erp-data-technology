// src/controllers/cuentaCorrienteController.js
// Controlador del Módulo de Cuenta Corriente

const pool = require('../config/db');

// 🟢 GET: Obtener todos los movimientos de Cuenta Corriente
exports.obtenerMovimientos = async (req, res) => {
  try {
    const query = `
      SELECT 
        mc.id,
        mc.cliente_id,
        mc.fecha_movimiento,
        mc.descripcion,
        mc.debe,
        mc.haber,
        mc.tipo_movimiento,
        mc.id_origen,
        mc.id_factura_origen,
        mc.metodo_pago,
        mc.created_at,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre
      FROM movimientos_cc mc
      LEFT JOIN clientes c ON mc.cliente_id = c.id
      ORDER BY mc.fecha_movimiento DESC, mc.created_at DESC
    `;
    const result = await pool.query(query);
    
    const movimientos = result.rows.map(row => ({
      id: row.id,
      cliente_id: row.cliente_id,
      fecha: row.fecha_movimiento,
      descripcion: row.descripcion,
      debe: parseFloat(row.debe),
      haber: parseFloat(row.haber),
      tipo: row.tipo_movimiento,
      id_origen: row.id_origen,
      id_factura_origen: row.id_factura_origen,
      metodo_pago: row.metodo_pago,
      codigo_cliente: row.codigo_cliente,
      cliente_nombre: row.cliente_nombre
    }));

    res.json(movimientos);
  } catch (error) {
    console.error('Error al obtener movimientos:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener los movimientos',
      error: error.message 
    });
  }
};

// 🟢 GET: Obtener movimientos de un cliente específico
exports.obtenerMovimientosPorCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    
    const query = `
      SELECT 
        mc.id,
        mc.cliente_id,
        mc.fecha_movimiento,
        mc.descripcion,
        mc.debe,
        mc.haber,
        mc.tipo_movimiento,
        mc.id_origen,
        mc.id_factura_origen,
        mc.metodo_pago,
        mc.created_at,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre
      FROM movimientos_cc mc
      LEFT JOIN clientes c ON mc.cliente_id = c.id
      WHERE mc.cliente_id = $1
      ORDER BY mc.fecha_movimiento DESC, mc.created_at DESC
    `;
    const result = await pool.query(query, [clienteId]);
    
    const movimientos = result.rows.map(row => ({
      id: row.id,
      cliente_id: row.cliente_id,
      fecha: row.fecha_movimiento,
      descripcion: row.descripcion,
      debe: parseFloat(row.debe),
      haber: parseFloat(row.haber),
      tipo: row.tipo_movimiento,
      id_origen: row.id_origen,
      id_factura_origen: row.id_factura_origen,
      metodo_pago: row.metodo_pago,
      codigo_cliente: row.codigo_cliente,
      cliente_nombre: row.cliente_nombre
    }));

    res.json(movimientos);
  } catch (error) {
    console.error('Error al obtener movimientos del cliente:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener los movimientos del cliente',
      error: error.message 
    });
  }
};

// 🟢 GET: Obtener saldo de un cliente
exports.obtenerSaldoCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    
    const query = `
      SELECT 
        c.id AS cliente_id,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre,
        COALESCE(SUM(mc.debe), 0) AS total_debe,
        COALESCE(SUM(mc.haber), 0) AS total_haber,
        COALESCE(SUM(mc.debe), 0) - COALESCE(SUM(mc.haber), 0) AS saldo
      FROM clientes c
      LEFT JOIN movimientos_cc mc ON c.id = mc.cliente_id
      WHERE c.id = $1 AND c.activo = true
      GROUP BY c.id, c.codigo_cliente, c.nombre_razon_social
    `;
    const result = await pool.query(query, [clienteId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cliente no encontrado' 
      });
    }

    const saldo = {
      cliente_id: result.rows[0].cliente_id,
      codigo_cliente: result.rows[0].codigo_cliente,
      cliente_nombre: result.rows[0].cliente_nombre,
      total_debe: parseFloat(result.rows[0].total_debe),
      total_haber: parseFloat(result.rows[0].total_haber),
      saldo: parseFloat(result.rows[0].saldo)
    };

    res.json(saldo);
  } catch (error) {
    console.error('Error al obtener saldo:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener el saldo',
      error: error.message 
    });
  }
};

// 🟢 GET: Obtener saldo de todos los clientes
exports.obtenerSaldosTodos = async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id AS cliente_id,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre,
        COALESCE(SUM(mc.debe), 0) AS total_debe,
        COALESCE(SUM(mc.haber), 0) AS total_haber,
        COALESCE(SUM(mc.debe), 0) - COALESCE(SUM(mc.haber), 0) AS saldo
      FROM clientes c
      LEFT JOIN movimientos_cc mc ON c.id = mc.cliente_id
      WHERE c.activo = true
      GROUP BY c.id, c.codigo_cliente, c.nombre_razon_social
      ORDER BY c.codigo_cliente ASC
    `;
    const result = await pool.query(query);
    
    const saldos = result.rows.map(row => ({
      cliente_id: row.cliente_id,
      codigo_cliente: row.codigo_cliente,
      cliente_nombre: row.cliente_nombre,
      total_debe: parseFloat(row.total_debe),
      total_haber: parseFloat(row.total_haber),
      saldo: parseFloat(row.saldo)
    }));

    res.json(saldos);
  } catch (error) {
    console.error('Error al obtener saldos:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener los saldos',
      error: error.message 
    });
  }
};

// 🟢 GET: Calcular saldo pendiente de una factura específica
exports.obtenerSaldoFactura = async (req, res) => {
  try {
    const { facturaId } = req.params;
    
    // Obtener la factura original
    const facturaQuery = `
      SELECT id, debe, descripcion, fecha_movimiento
      FROM movimientos_cc
      WHERE id = $1 AND debe > 0
    `;
    const facturaResult = await pool.query(facturaQuery, [facturaId]);
    
    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Factura no encontrada o no tiene saldo pendiente' 
      });
    }
    
    const factura = facturaResult.rows[0];
    const montoOriginal = parseFloat(factura.debe);
    
    // Calcular total pagado (sumar todos los haberes vinculados a esta factura)
    const pagosQuery = `
      SELECT COALESCE(SUM(haber), 0) as total_pagado
      FROM movimientos_cc
      WHERE id_factura_origen = $1
    `;
    const pagosResult = await pool.query(pagosQuery, [facturaId]);
    const totalPagado = parseFloat(pagosResult.rows[0].total_pagado);
    
    // Calcular saldo pendiente
    const saldoPendiente = montoOriginal - totalPagado;
    
    // Obtener lista de pagos realizados
    const detallePagosQuery = `
      SELECT id, fecha_movimiento, haber, metodo_pago, descripcion
      FROM movimientos_cc
      WHERE id_factura_origen = $1
      ORDER BY fecha_movimiento ASC
    `;
    const detallePagosResult = await pool.query(detallePagosQuery, [facturaId]);
    
    res.json({
      success: true,
      factura_id: facturaId,
      descripcion: factura.descripcion,
      fecha_factura: factura.fecha_movimiento,
      monto_original: montoOriginal,
      total_pagado: totalPagado,
      saldo_pendiente: saldoPendiente,
      estado: saldoPendiente <= 0 ? 'Pagada' : (totalPagado > 0 ? 'Pagada parcialmente' : 'Pendiente'),
      pagos_realizados: detallePagosResult.rows.map(p => ({
        id: p.id,
        fecha: p.fecha_movimiento,
        monto: parseFloat(p.haber),
        metodo_pago: p.metodo_pago,
        descripcion: p.descripcion
      }))
    });
  } catch (error) {
    console.error('Error al calcular saldo de factura:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al calcular el saldo',
      error: error.message 
    });
  }
};

//  POST: Crear un nuevo movimiento (con soporte para pagos parciales)
exports.crearMovimiento = async (req, res) => {
  try {
    const { 
      cliente_id, 
      fecha, 
      descripcion, 
      debe, 
      haber, 
      tipo_movimiento, 
      id_origen,
      id_factura_origen,
      metodo_pago
    } = req.body;

    // Validar campos obligatorios
    if (!cliente_id || !fecha || !descripcion) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cliente, fecha y descripción son obligatorios' 
      });
    }

    // Validar que al menos uno de debe/haber tenga valor
    if ((!debe || debe <= 0) && (!haber || haber <= 0)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Debe ingresar un valor en Debe o Haber' 
      });
    }

    // Insertar el movimiento con los nuevos campos
    const query = `
      INSERT INTO movimientos_cc 
      (cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, id_origen, id_factura_origen, metodo_pago)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, id_factura_origen, metodo_pago
    `;
    const values = [
      cliente_id,
      fecha,
      descripcion,
      debe || 0,
      haber || 0,
      tipo_movimiento || 'Manual',
      id_origen || null,
      id_factura_origen || null,
      metodo_pago || 'Efectivo'
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Movimiento registrado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear movimiento:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al crear el movimiento',
      error: error.message 
    });
  }
};

//  PUT: Editar un movimiento existente
exports.editarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const { cliente_id, fecha, descripcion, debe, haber, tipo_movimiento } = req.body;

    // Validar que el movimiento existe
    const checkQuery = 'SELECT id FROM movimientos_cc WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Movimiento no encontrado' 
      });
    }

    // Actualizar el movimiento
    const query = `
      UPDATE movimientos_cc
      SET cliente_id = $1, fecha_movimiento = $2, descripcion = $3, debe = $4, haber = $5, tipo_movimiento = $6
      WHERE id = $7
      RETURNING id, cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento
    `;
    const values = [
      cliente_id,
      fecha,
      descripcion,
      debe || 0,
      haber || 0,
      tipo_movimiento || 'Manual',
      id
    ];
    const result = await pool.query(query, values);

    res.json({
      success: true,
      message: 'Movimiento actualizado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al editar movimiento:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al editar el movimiento',
      error: error.message 
    });
  }
};

// 🔴 DELETE: Eliminar un movimiento
exports.eliminarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el movimiento existe
    const checkQuery = 'SELECT id FROM movimientos_cc WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Movimiento no encontrado' 
      });
    }

    // Eliminar el movimiento
    const query = 'DELETE FROM movimientos_cc WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);

    res.json({
      success: true,
      message: 'Movimiento eliminado correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar movimiento:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al eliminar el movimiento',
      error: error.message 
    });
  }
};