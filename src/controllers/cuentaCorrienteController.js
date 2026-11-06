// src/controllers/cuentaCorrienteController.js
const pool = require('../config/db');

// ============================================================
// Migración (Fase 1 - Reparto asistido de cobros):
//  · aplicaciones_cc: vincula transferencias/créditos con facturas
//    sin borrar ni modificar el historial (todo es auditable)
//  · movimientos_cc.categoría: para gastos compartidos (Fase 3)
// ============================================================
const tablaLista = pool.query(`
  CREATE TABLE IF NOT EXISTS aplicaciones_cc (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    origen_id UUID NOT NULL REFERENCES movimientos_cc(id) ON DELETE CASCADE,
    factura_id UUID NOT NULL REFERENCES movimientos_cc(id) ON DELETE CASCADE,
    monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)
  .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_aplicaciones_factura ON aplicaciones_cc(factura_id)'))
  .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_aplicaciones_origen ON aplicaciones_cc(origen_id)'))
  .then(() => pool.query('ALTER TABLE movimientos_cc ADD COLUMN IF NOT EXISTS categoria VARCHAR(60)'))
  .then(() => console.log('✅ Tabla aplicaciones_cc y columna categoria listas'))
  .catch(err => console.error('❌ Error en migración de Cuenta Corriente:', err.message));

// Formato de dinero para mensajes de error (es-AR)
const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
//  (ahora incluye APLICACIONES: reparto de cobros contra facturas)
exports.obtenerMovimientosPorCliente = async (req, res) => {
  try {
    const { clienteId } = req.params;
    await tablaLista; // asegura que exista la tabla de aplicaciones

    // Todas las aplicaciones del cliente (crédito → factura)
    const apliResult = await pool.query(`
      SELECT a.id, a.fecha, a.monto, a.origen_id, a.factura_id,
             o.descripcion AS origen_descripcion, o.fecha_movimiento AS origen_fecha,
             f.descripcion AS factura_descripcion, f.fecha_movimiento AS factura_fecha
      FROM aplicaciones_cc a
      LEFT JOIN movimientos_cc o ON o.id = a.origen_id
      LEFT JOIN movimientos_cc f ON f.id = a.factura_id
      WHERE a.cliente_id = $1
      ORDER BY a.fecha ASC, a.created_at ASC
    `, [clienteId]);
    const apliPorFactura = {};
    const apliPorOrigen = {};
    apliResult.rows.forEach(a => {
      (apliPorFactura[a.factura_id] = apliPorFactura[a.factura_id] || []).push(a);
      (apliPorOrigen[a.origen_id] = apliPorOrigen[a.origen_id] || []).push(a);
    });

    // Obtener todas las facturas (debe > 0) del cliente
    const facturasQuery = `
      SELECT id, fecha_movimiento, descripcion, debe, categoria, created_at
      FROM movimientos_cc
      WHERE cliente_id = $1 AND debe > 0
      ORDER BY fecha_movimiento ASC, created_at ASC
    `;
    const facturasResult = await pool.query(facturasQuery, [clienteId]);
    
    // Para cada factura, calcular cuánto se ha pagado (pagos directos + aplicaciones)
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
      const totalPagosDirectos = pagosResult.rows.reduce((sum, p) => sum + parseFloat(p.haber), 0);

      // Aplicaciones (reparto de cobros) contra esta factura
      const aplicadas = apliPorFactura[factura.id] || [];
      const totalAplicado = aplicadas.reduce((s, a) => s + parseFloat(a.monto), 0);

      const totalPagado = totalPagosDirectos + totalAplicado;
      let saldoPendiente = montoOriginal - totalPagado;
      if (Math.abs(saldoPendiente) < 0.009) saldoPendiente = 0; // redondeo
      
      saldoAcumulado += saldoPendiente;
      
      movimientosConSaldo.push({
        id: factura.id,
        cliente_id: clienteId,
        fecha: factura.fecha_movimiento,
        descripcion: factura.descripcion,
        categoria: factura.categoria || null,
        debe: montoOriginal,
        haber: totalPagado,
        aplicado: totalAplicado,
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
        })),
        aplicaciones: aplicadas.map(a => ({
          id: a.id,
          fecha: a.fecha,
          monto: parseFloat(a.monto),
          origen_id: a.origen_id,
          origen_descripcion: a.origen_descripcion,
          origen_fecha: a.origen_fecha
        }))
      });
    }
    
    // Créditos: movimientos sin factura (transferencias/gastos que entraron)
    // Su saldo "disponible" es lo que queda SIN repartir todavía
    const otrosQuery = `
      SELECT mc.id, mc.cliente_id, mc.fecha_movimiento, mc.descripcion, mc.debe, mc.haber, mc.tipo_movimiento, mc.categoria, mc.id_origen, mc.id_factura_origen, mc.metodo_pago, mc.created_at
      FROM movimientos_cc mc
      WHERE mc.cliente_id = $1 AND mc.debe = 0 AND mc.haber > 0 AND mc.id_factura_origen IS NULL
      ORDER BY mc.fecha_movimiento ASC, mc.created_at ASC
    `;
    const otrosResult = await pool.query(otrosQuery, [clienteId]);
    
    let saldoACuenta = 0;
    otrosResult.rows.forEach(row => {
      const aplicadas = apliPorOrigen[row.id] || [];
      const totalAplicado = aplicadas.reduce((s, a) => s + parseFloat(a.monto), 0);
      let disponible = parseFloat(row.haber) - totalAplicado;
      if (Math.abs(disponible) < 0.009) disponible = 0; // redondeo
      saldoAcumulado -= disponible; // sólo descuenta lo que sigue sin repartir
      saldoACuenta += disponible;

      movimientosConSaldo.push({
        id: row.id,
        cliente_id: row.cliente_id,
        fecha: row.fecha_movimiento,
        descripcion: row.descripcion,
        categoria: row.categoria || null,
        debe: 0,
        haber: parseFloat(row.haber),
        aplicado: totalAplicado,
        disponible,
        saldo: 0,
        tipo: row.tipo_movimiento || 'Manual',
        estado: disponible > 0 ? 'A cuenta' : 'Repartida',
        clase: 'credito',
        id_factura_origen: row.id_factura_origen,
        metodo_pago: row.metodo_pago,
        pagos_realizados: [],
        aplicaciones: aplicadas.map(a => ({
          id: a.id,
          fecha: a.fecha,
          monto: parseFloat(a.monto),
          factura_id: a.factura_id,
          factura_descripcion: a.factura_descripcion,
          factura_fecha: a.factura_fecha
        }))
      });
    });
    
    // Ordenar por fecha descendente
    movimientosConSaldo.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    res.json({
      movimientos: movimientosConSaldo,
      saldo_total: saldoAcumulado,
      saldo_a_cuenta: saldoACuenta,
      facturas_abiertas: movimientosConSaldo.filter(m => m.saldo > 0).length
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
             COALESCE(NULLIF(TRIM(c.cuit_dni), ''), '-') AS cuit,
             COALESCE(SUM(mc.debe), 0) AS total_debe,
             COALESCE(SUM(mc.haber), 0) AS total_haber,
             COALESCE(SUM(mc.debe), 0) - COALESCE(SUM(mc.haber), 0) AS saldo
      FROM clientes c
      LEFT JOIN movimientos_cc mc ON c.id = mc.cliente_id
      WHERE c.activo = true
      GROUP BY c.id, c.codigo_cliente, c.nombre_razon_social, c.cuit_dni
      ORDER BY c.codigo_cliente ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(row => ({
      cliente_id: row.cliente_id,
      codigo_cliente: row.codigo_cliente,
      cliente_nombre: row.cliente_nombre,
      cuit: row.cuit,
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
    const { cliente_id, fecha, descripcion, debe, haber, tipo_movimiento, categoria, id_origen, id_factura_origen, metodo_pago } = req.body;
    
    if (!cliente_id || !fecha || !descripcion) {
      return res.status(400).json({ success: false, message: 'Campos obligatorios incompletos' });
    }
    if ((!debe || debe <= 0) && (!haber || haber <= 0)) {
      return res.status(400).json({ success: false, message: 'Debe ingresar un valor en Debe o Haber' });
    }
    
    const query = `
      INSERT INTO movimientos_cc 
      (cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, categoria, id_origen, id_factura_origen, metodo_pago)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, categoria, id_factura_origen, metodo_pago
    `;
    const values = [
      cliente_id, fecha, descripcion,
      debe || 0, haber || 0,
      tipo_movimiento || 'Manual',
      categoria || null,
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
    const { cliente_id, fecha, descripcion, debe, haber, tipo_movimiento, categoria, metodo_pago } = req.body;
    
    const checkResult = await pool.query('SELECT id FROM movimientos_cc WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
    }
    
    const query = `
      UPDATE movimientos_cc
      SET cliente_id = $1, fecha_movimiento = $2, descripcion = $3, debe = $4, haber = $5, tipo_movimiento = $6, categoria = $7, metodo_pago = $8
      WHERE id = $9
      RETURNING id, cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, categoria, metodo_pago
    `;
    const values = [
      cliente_id, fecha, descripcion,
      debe || 0, haber || 0,
      tipo_movimiento || 'Manual',
      categoria || null,
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

// ============================================================
// 💰 FASE 1: APLICAR COBROS (reparto asistido / regularización)
// Vincula créditos (transferencias/gastos) con facturas.
// Nunca borra ni modifica movimientos: sólo agrega vínculos.
// ============================================================
exports.aplicarCobros = async (req, res) => {
  const { cliente_id, fecha, items } = req.body;

  if (!cliente_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Debe indicar el cliente y al menos una aplicación' });
  }

  const client = await pool.connect();
  try {
    await tablaLista;
    await client.query('BEGIN');

    // 0) Validación básica de montos
    for (const it of items) {
      const monto = parseFloat(it.monto);
      if (!it.origen_id || !it.factura_id || !isFinite(monto) || monto <= 0) {
        throw new Error('Aplicaciones inválidas: faltan datos o montos');
      }
    }

    const idsOrigen = [...new Set(items.map(i => i.origen_id))];
    const idsFactura = [...new Set(items.map(i => i.factura_id))];

    // 1) Orígenes (créditos) y facturas deben existir y pertenecer al cliente
    const origenes = (await client.query(
      `SELECT id, haber, id_factura_origen, cliente_id FROM movimientos_cc WHERE id = ANY($1)`,
      [idsOrigen]
    )).rows;
    const facturas = (await client.query(
      `SELECT id, debe, cliente_id FROM movimientos_cc WHERE id = ANY($1) AND debe > 0`,
      [idsFactura]
    )).rows;

    if (origenes.length !== idsOrigen.length) throw new Error('Alguna transferencia/crédito no existe');
    if (facturas.length !== idsFactura.length) throw new Error('Alguna factura no existe');

    origenes.forEach(o => {
      if (o.cliente_id !== cliente_id) throw new Error('Un crédito no pertenece a este cliente');
      if (o.id_factura_origen) throw new Error('Sólo se pueden repartir créditos que no estén vinculados a una factura');
    });
    facturas.forEach(f => {
      if (f.cliente_id !== cliente_id) throw new Error('Una factura no pertenece a este cliente');
    });

    // 2) Sumatorias pedidas en esta operación
    const porOrigen = {}, porFactura = {};
    items.forEach(it => {
      const m = parseFloat(it.monto);
      porOrigen[it.origen_id] = (porOrigen[it.origen_id] || 0) + m;
      porFactura[it.factura_id] = (porFactura[it.factura_id] || 0) + m;
    });

    // 3) Lo ya aplicado antes (de esta u operaciones anteriores)
    const apliOrigen = (await client.query(
      `SELECT origen_id, COALESCE(SUM(monto), 0) AS s FROM aplicaciones_cc WHERE origen_id = ANY($1) GROUP BY origen_id`,
      [idsOrigen]
    )).rows;
    const apliFactura = (await client.query(
      `SELECT factura_id, COALESCE(SUM(monto), 0) AS s FROM aplicaciones_cc WHERE factura_id = ANY($1) GROUP BY factura_id`,
      [idsFactura]
    )).rows;
    const pagosFactura = (await client.query(
      `SELECT id_factura_origen AS factura_id, COALESCE(SUM(haber), 0) AS s FROM movimientos_cc WHERE id_factura_origen = ANY($1) GROUP BY id_factura_origen`,
      [idsFactura]
    )).rows;

    const yaOrigen = {}; apliOrigen.forEach(r => yaOrigen[r.origen_id] = parseFloat(r.s));
    const yaFactura = {}; apliFactura.forEach(r => yaFactura[r.factura_id] = parseFloat(r.s));
    const pagosDe = {}; pagosFactura.forEach(r => pagosDe[r.factura_id] = parseFloat(r.s));

    // 4) Validar que no se pase de lo disponible ni de lo pendiente
    const TOL = 0.01;
    origenes.forEach(o => {
      const disponible = parseFloat(o.haber) - (yaOrigen[o.id] || 0);
      if (porOrigen[o.id] > disponible + TOL) {
        throw new Error(`El crédito de ${fmt(disponible)} no alcanza para lo que querés aplicar`);
      }
    });
    facturas.forEach(f => {
      const pendiente = parseFloat(f.debe) - (pagosDe[f.id] || 0) - (yaFactura[f.id] || 0);
      if (porFactura[f.id] > pendiente + TOL) {
        throw new Error(`Se quiere aplicar más de lo pendiente (${fmt(pendiente)}) en una factura`);
      }
    });

    // 5) Insertar los vínculos
    let total = 0;
    const fFecha = fecha || new Date().toISOString().slice(0, 10);
    for (const it of items) {
      const monto = Math.round(parseFloat(it.monto) * 100) / 100;
      await client.query(
        `INSERT INTO aplicaciones_cc (cliente_id, fecha, origen_id, factura_id, monto) VALUES ($1, $2, $3, $4, $5)`,
        [cliente_id, fFecha, it.origen_id, it.factura_id, monto]
      );
      total += monto;
    }

    await client.query('COMMIT');
    const nFacturas = new Set(items.map(i => i.factura_id)).size;
    res.status(201).json({
      success: true,
      message: `Se aplicaron ${fmt(total)} contra ${nFacturas} factura${nFacturas > 1 ? 's' : ''}`,
      aplicado: Math.round(total * 100) / 100,
      vinculos: items.length
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al aplicar cobros:', error.message);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

// ↩️ DELETE: Deshacer una aplicación (el crédito vuelve a estar disponible)
exports.deshacerAplicacion = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM aplicaciones_cc WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Aplicación no encontrada' });
    }
    res.json({ success: true, message: 'Aplicación deshecha: el crédito vuelve a estar disponible' });
  } catch (error) {
    console.error('Error al deshacer aplicación:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};