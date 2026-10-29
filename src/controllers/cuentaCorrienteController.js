// src/controllers/cuentaCorrienteController.js
const pool = require('../config/db');

// ✅ FUNCIÓN AUXILIAR: Sincronizar cobros con Finanzas
async function sincronizarConFinanzas(pool, clienteId, monto, fecha, descripcion, metodoPago, idOrigenCc) {
  try {
    const subcatQuery = `
      SELECT sf.id as subcategoria_id, cf.id as categoria_id 
      FROM subcategorias_finanzas sf 
      JOIN categorias_finanzas cf ON sf.categoria_id = cf.id 
      WHERE LOWER(sf.nombre) = 'cuenta corriente' AND LOWER(cf.nombre) = 'cobro servicios'
      LIMIT 1
    `;
    const subcatResult = await pool.query(subcatQuery);
    
    if (subcatResult.rows.length === 0) {
      console.warn('⚠️ No se encontró subcategoría "Cuenta Corriente" en Finanzas.');
      return;
    }

    const { subcategoria_id, categoria_id } = subcatResult.rows[0];

    let mpId = null;
    if (metodoPago) {
      const mpRes = await pool.query("SELECT id FROM metodos_pago WHERE nombre ILIKE $1", [metodoPago]);
      mpId = mpRes.rows.length > 0 ? mpRes.rows[0].id : null;
    }

    await pool.query(
      `INSERT INTO movimientos_finanzas 
       (fecha_movimiento, tipo, categoria_id, subcategoria_id, metodo_pago_id, descripcion, monto, id_origen, es_transferencia_interna) 
       VALUES ($1, 'Ingreso', $2, $3, $4, $5, $6, $7, false)`,
      [fecha, categoria_id, subcategoria_id, mpId, `Cobro Cta. Cte. Cliente ID:${clienteId} - ${descripcion}`, monto, idOrigenCc]
    );
    
    console.log(`✅ Sincronizado con Finanzas: Ingreso de $${monto}`);
    
  } catch (err) {
    console.error('❌ Error al sincronizar con Finanzas:', err.message);
  }
}

// 🟢 GET: Obtener todos los movimientos
exports.obtenerMovimientos = async (req, res) => {
  try {
    const query = `SELECT mc.id, mc.cliente_id, mc.fecha_movimiento, mc.descripcion, mc.debe, mc.haber, mc.tipo_movimiento, mc.id_origen, mc.id_factura_origen, mc.metodo_pago, mc.created_at, c.codigo_cliente, c.nombre_razon_social AS cliente_nombre FROM movimientos_cc mc LEFT JOIN clientes c ON mc.cliente_id = c.id ORDER BY mc.fecha_movimiento DESC, mc.created_at DESC`;
    const result = await pool.query(query);
    const movimientos = result.rows.map(row => ({
      id: row.id, cliente_id: row.cliente_id, fecha: row.fecha_movimiento, descripcion: row.descripcion,
      debe: parseFloat(row.debe), haber: parseFloat(row.haber), tipo: row.tipo_movimiento,
      id_origen: row.id_origen, id_factura_origen: row.id_factura_origen, metodo_pago: row.metodo_pago,
      codigo_cliente: row.codigo_cliente, cliente_nombre: row.cliente_nombre
    }));
    res.json(movimientos);
  } catch (error) {
    console.error('Error al obtener movimientos:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

//  GET: Movimientos por cliente CON SALDO POR FACTURA
exports.obtenerMovimientosPorCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    
    // Obtener todas las facturas (debe > 0) del cliente
    const facturasQuery = `
      SELECT id, fecha_movimiento, descripcion, debe, created_at
      FROM movimientos_cc
      WHERE cliente_id = $1 AND debe > 0
      ORDER BY fecha_movimiento ASC, created_at ASC
    `;
    const facturasResult = await pool.query(facturasQuery, [clienteId]);
    
    // Para cada factura, calcular cuánto se ha pagado
    const movimientosConSaldo = [];
    let saldoAcumulado = 0;
    
    for (const factura of facturasResult.rows) {
      const montoOriginal = parseFloat(factura.debe);
      
      // Buscar todos los pagos vinculados a esta factura
      const pagosQuery = `
        SELECT id, fecha_movimiento, haber, metodo_pago, descripcion
        FROM movimientos_cc
        WHERE id_factura_origen = $1
        ORDER BY fecha_movimiento ASC
      `;
      const pagosResult = await pool.query(pagosQuery, [factura.id]);
      const totalPagado = pagosResult.rows.reduce((sum, p) => sum + parseFloat(p.haber), 0);
      const saldoPendiente = montoOriginal - totalPagado;
      
      saldoAcumulado += saldoPendiente;
      
      movimientosConSaldo.push({
        id: factura.id,
        cliente_id: clienteId,
        fecha: factura.fecha_movimiento,
        descripcion: factura.descripcion,
        debe: montoOriginal,
        haber: totalPagado,
        saldo: saldoPendiente,
        tipo: 'Factura',
        estado: saldoPendiente <= 0 ? 'Pagada' : (totalPagado > 0 ? 'Parcial' : 'Pendiente'),
        id_factura_origen: null,
        metodo_pago: null,
        pagos_realizados: pagosResult.rows.map(p => ({
          id: p.id,
          fecha: p.fecha_movimiento,
          monto: parseFloat(p.haber),
          metodo_pago: p.metodo_pago,
          descripcion: p.descripcion
        }))
      });
    }
    
    // También incluir movimientos que no son facturas (ajustes manuales, etc.)
    const otrosQuery = `
      SELECT mc.id, mc.cliente_id, mc.fecha_movimiento, mc.descripcion, mc.debe, mc.haber, mc.tipo_movimiento, mc.id_origen, mc.id_factura_origen, mc.metodo_pago, mc.created_at
      FROM movimientos_cc mc
      WHERE mc.cliente_id = $1 AND mc.debe = 0 AND mc.haber > 0 AND mc.id_factura_origen IS NULL
      ORDER BY mc.fecha_movimiento DESC
    `;
    const otrosResult = await pool.query(otrosQuery, [clienteId]);
    
    otrosResult.rows.forEach(row => {
      saldoAcumulado -= parseFloat(row.haber);
      movimientosConSaldo.push({
        id: row.id,
        cliente_id: row.cliente_id,
        fecha: row.fecha_movimiento,
        descripcion: row.descripcion,
        debe: 0,
        haber: parseFloat(row.haber),
        saldo: 0,
        tipo: row.tipo_movimiento || 'Manual',
        estado: 'Aplicado',
        id_factura_origen: row.id_factura_origen,
        metodo_pago: row.metodo_pago,
        pagos_realizados: []
      });
    });
    
    // Ordenar por fecha descendente
    movimientosConSaldo.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    res.json({
      movimientos: movimientosConSaldo,
      saldo_total: saldoAcumulado
    });
    
  } catch (error) {
    console.error('Error al obtener movimientos del cliente:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 GET: Saldo de un cliente
exports.obtenerSaldoCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const query = `
      SELECT c.id AS cliente_id, c.codigo_cliente, c.nombre_razon_social AS cliente_nombre,
             COALESCE(SUM(mc.debe), 0) AS total_debe,
             COALESCE(SUM(mc.haber), 0) AS total_haber,
             COALESCE(SUM(mc.debe), 0) - COALESCE(SUM(mc.haber), 0) AS saldo
      FROM clientes c
      LEFT JOIN movimientos_cc mc ON c.id = mc.cliente_id
      WHERE c.id = $1 AND c.activo = true
      GROUP BY c.id, c.codigo_cliente, c.nombre_razon_social
    `;
    const result = await pool.query(query, [clienteId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    
    res.json({
      cliente_id: result.rows[0].cliente_id,
      codigo_cliente: result.rows[0].codigo_cliente,
      cliente_nombre: result.rows[0].cliente_nombre,
      total_debe: parseFloat(result.rows[0].total_debe),
      total_haber: parseFloat(result.rows[0].total_haber),
      saldo: parseFloat(result.rows[0].saldo)
    });
  } catch (error) {
    console.error('Error al obtener saldo:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 GET: Saldos de todos los clientes
exports.obtenerSaldosTodos = async (req, res) => {
  try {
    const query = `
      SELECT c.id AS cliente_id, c.codigo_cliente, c.nombre_razon_social AS cliente_nombre,
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
    res.json(result.rows.map(row => ({
      cliente_id: row.cliente_id,
      codigo_cliente: row.codigo_cliente,
      cliente_nombre: row.cliente_nombre,
      total_debe: parseFloat(row.total_debe),
      total_haber: parseFloat(row.total_haber),
      saldo: parseFloat(row.saldo)
    })));
  } catch (error) {
    console.error('Error al obtener saldos:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 GET: Saldo pendiente de factura específica
exports.obtenerSaldoFactura = async (req, res) => {
  try {
    const { facturaId } = req.params;
    const facturaResult = await pool.query(
      `SELECT id, debe, descripcion, fecha_movimiento FROM movimientos_cc WHERE id = $1 AND debe > 0`,
      [facturaId]
    );
    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Factura no encontrada' });
    }
    
    const factura = facturaResult.rows[0];
    const pagosResult = await pool.query(
      `SELECT COALESCE(SUM(haber), 0) as total_pagado FROM movimientos_cc WHERE id_factura_origen = $1`,
      [facturaId]
    );
    const totalPagado = parseFloat(pagosResult.rows[0].total_pagado);
    const saldoPendiente = parseFloat(factura.debe) - totalPagado;
    
    const detallePagosResult = await pool.query(
      `SELECT id, fecha_movimiento, haber, metodo_pago, descripcion FROM movimientos_cc WHERE id_factura_origen = $1 ORDER BY fecha_movimiento ASC`,
      [facturaId]
    );
    
    res.json({
      success: true,
      factura_id: facturaId,
      descripcion: factura.descripcion,
      fecha_factura: factura.fecha_movimiento,
      monto_original: parseFloat(factura.debe),
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟡 POST: Crear movimiento (CON SINCRONIZACIÓN)
exports.crearMovimiento = async (req, res) => {
  try {
    const { cliente_id, fecha, descripcion, debe, haber, tipo_movimiento, id_origen, id_factura_origen, metodo_pago } = req.body;
    
    if (!cliente_id || !fecha || !descripcion) {
      return res.status(400).json({ success: false, message: 'Campos obligatorios incompletos' });
    }
    if ((!debe || debe <= 0) && (!haber || haber <= 0)) {
      return res.status(400).json({ success: false, message: 'Debe ingresar un valor en Debe o Haber' });
    }
    
    const query = `
      INSERT INTO movimientos_cc 
      (cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, id_origen, id_factura_origen, metodo_pago)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, id_factura_origen, metodo_pago
    `;
    const values = [
      cliente_id, fecha, descripcion,
      debe || 0, haber || 0,
      tipo_movimiento || 'Manual',
      id_origen || null, id_factura_origen || null,
      metodo_pago || 'Efectivo'
    ];
    const result = await pool.query(query, values);
    
    // ✅ SINCRONIZAR SI ES UN COBRO (HABER > 0)
    if (haber && parseFloat(haber) > 0) {
      await sincronizarConFinanzas(pool, cliente_id, parseFloat(haber), fecha, descripcion, metodo_pago, result.rows[0].id);
    }
    
    res.status(201).json({
      success: true,
      message: 'Movimiento registrado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear movimiento:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟠 PUT: Editar movimiento (CON SINCRONIZACIÓN)
exports.editarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const { cliente_id, fecha, descripcion, debe, haber, tipo_movimiento, metodo_pago } = req.body;
    
    const checkResult = await pool.query('SELECT id FROM movimientos_cc WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
    }
    
    const query = `
      UPDATE movimientos_cc
      SET cliente_id = $1, fecha_movimiento = $2, descripcion = $3, debe = $4, haber = $5, tipo_movimiento = $6, metodo_pago = $7
      WHERE id = $8
      RETURNING id, cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, metodo_pago
    `;
    const values = [
      cliente_id, fecha, descripcion,
      debe || 0, haber || 0,
      tipo_movimiento || 'Manual',
      metodo_pago || 'Efectivo',
      id
    ];
    const result = await pool.query(query, values);
    
    // ✅ SINCRONIZAR SI SE MODIFICÓ EL HABER
    if (haber && parseFloat(haber) > 0) {
      await sincronizarConFinanzas(pool, cliente_id, parseFloat(haber), fecha, descripcion, metodo_pago, id);
    }
    
    res.json({
      success: true,
      message: 'Movimiento actualizado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al editar movimiento:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

//  DELETE: Eliminar movimiento
exports.eliminarMovimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const checkResult = await pool.query('SELECT id FROM movimientos_cc WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
    }
    
    await pool.query('DELETE FROM movimientos_cc WHERE id = $1', [id]);
    res.json({ success: true, message: 'Movimiento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar movimiento:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 💰 NUEVO ENDPOINT: Registrar Pago Específico (Para el botón de pago)
exports.registrarPago = async (req, res) => {
  try {
    const { cliente_id, fecha, descripcion, monto, metodo_pago, id_factura_origen } = req.body;
    
    if (!cliente_id || !fecha || !monto || monto <= 0) {
      return res.status(400).json({ success: false, message: 'Cliente, fecha y monto son obligatorios' });
    }

    // 1. Registrar el movimiento en Cuenta Corriente (Haber) VINCULADO A LA FACTURA
    const queryCC = `
      INSERT INTO movimientos_cc (cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, id_factura_origen, metodo_pago)
      VALUES ($1, $2, $3, 0, $4, 'Cobro', $5, $6)
      RETURNING id, cliente_id, fecha_movimiento, descripcion, haber, metodo_pago, id_factura_origen
    `;
    const resultCC = await pool.query(queryCC, [
      cliente_id, 
      fecha, 
      descripcion || 'Pago recibido', 
      monto, 
      id_factura_origen || null, 
      metodo_pago || 'Efectivo'
    ]);

    // 2. Sincronizar automáticamente con Finanzas
    await sincronizarConFinanzas(
      pool, 
      cliente_id, 
      monto, 
      fecha, 
      descripcion || 'Pago recibido', 
      metodo_pago, 
      resultCC.rows[0].id
    );

    res.status(201).json({
      success: true,
      message: 'Pago registrado y sincronizado con Finanzas',
      data: resultCC.rows[0]
    });
  } catch (error) {
    console.error('Error al registrar pago:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};