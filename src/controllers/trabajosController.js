// src/controllers/trabajosController.js
// Controlador del Módulo de Trabajos (Servicio Técnico)

const pool = require('../config/db');

// ============================================================
// Migración: columnas para el cobro por Cuenta Corriente
// ============================================================
pool.query(`ALTER TABLE trabajos ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(60)`)
  .then(() => pool.query(`ALTER TABLE trabajos ADD COLUMN IF NOT EXISTS a_cuenta_corriente BOOLEAN DEFAULT false`))
  .then(() => console.log('✅ Columnas metodo_pago / a_cuenta_corriente listas en trabajos'))
  .catch(err => console.error('❌ Error en migración de trabajos:', err.message));

// ============================================================
// Helpers: vincular trabajos con Cuenta Corriente
// ============================================================
const origenTrabajo = id => `trabajo:${id}`;

async function buscarFacturaCc(origen) {
  try {
    const r = await pool.query(
      "SELECT id, debe FROM movimientos_cc WHERE id_origen = $1 AND debe > 0 ORDER BY created_at ASC LIMIT 1",
      [origen]
    );
    return r.rows[0] || null;
  } catch (e) {
    return null;
  }
}

async function facturaCcTienePagos(facturaId) {
  if (!facturaId) return false;
  try {
    const r = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(haber), 0) FROM movimientos_cc WHERE id_factura_origen = $1) AS pagos,
         (SELECT COALESCE(SUM(monto), 0) FROM aplicaciones_cc WHERE factura_id = $1) AS aplicados`,
      [facturaId]
    );
    const pagos = parseFloat(r.rows[0].pagos) || 0;
    const aplicados = parseFloat(r.rows[0].aplicados) || 0;
    return (pagos + aplicados) > 0.009;
  } catch (e) {
    return false;
  }
}

function descripcionTrabajo(trabajo) {
  const equipo = [trabajo.tipo_equipo, trabajo.marca_modelo].filter(Boolean).join(' ');
  const falla = trabajo.falla ? ` - ${String(trabajo.falla).slice(0, 120)}` : '';
  return `Trabajo ${trabajo.codigo_orden}${equipo ? ` (${equipo})` : ''}${falla}`;
}

// Crea, actualiza o elimina la factura de Cuenta Corriente asociada a un trabajo.
async function sincronizarCcTrabajo({ trabajoId, clienteId, descripcion, monto, fecha, activa }) {
  const origen = origenTrabajo(trabajoId);
  const factura = await buscarFacturaCc(origen);

  if (!activa) {
    if (factura && !(await facturaCcTienePagos(factura.id))) {
      await pool.query('DELETE FROM movimientos_cc WHERE id = $1', [factura.id]);
      return { accion: 'eliminada' };
    }
    return { accion: 'sin_cambios' };
  }

  if (!factura) {
    await pool.query(
      `INSERT INTO movimientos_cc
         (cliente_id, fecha_movimiento, descripcion, debe, haber, tipo_movimiento, categoria, id_origen, metodo_pago)
       VALUES ($1, $2, $3, $4, 0, 'Factura', 'Trabajos', $5, 'Cuenta Corriente')`,
      [clienteId, fecha, descripcion, monto, origen]
    );
    return { accion: 'creada' };
  }

  const tienePagos = await facturaCcTienePagos(factura.id);
  if (tienePagos) {
    // Ya hay pagos: no se toca el monto para no descuadrar la cuenta.
    await pool.query(
      'UPDATE movimientos_cc SET descripcion = $1, cliente_id = $2 WHERE id = $3',
      [descripcion, clienteId, factura.id]
    );
    return { accion: 'actualizada_sin_monto' };
  }

  await pool.query(
    'UPDATE movimientos_cc SET descripcion = $1, cliente_id = $2, fecha_movimiento = $3, debe = $4 WHERE id = $5',
    [descripcion, clienteId, fecha, monto, factura.id]
  );
  return { accion: 'actualizada' };
}

// 🟢 GET: Obtener todos los trabajos
exports.obtenerTrabajos = async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.codigo_orden,
        t.cliente_id,
        t.fecha_ingreso,
        t.tipo_equipo,
        t.marca_modelo,
        t.numero_serie,
        t.falla,
        t.monto_diagnostico,
        t.monto_reparacion,
        t.estado,
        t.fecha_estimada_entrega,
        t.observaciones,
        t.pagado,
        t.metodo_pago,
        t.a_cuenta_corriente,
        t.created_at,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre
      FROM trabajos t
      LEFT JOIN clientes c ON t.cliente_id = c.id
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(query);

    const trabajos = result.rows.map(row => ({
      id: row.id,
      codigo_orden: row.codigo_orden,
      cliente_id: row.cliente_id,
      fecha_ingreso: row.fecha_ingreso,
      tipo_equipo: row.tipo_equipo,
      marca_modelo: row.marca_modelo,
      numero_serie: row.numero_serie,
      falla: row.falla,
      monto_diagnostico: parseFloat(row.monto_diagnostico),
      monto_reparacion: parseFloat(row.monto_reparacion),
      monto_total: parseFloat(row.monto_diagnostico) + parseFloat(row.monto_reparacion),
      estado: row.estado,
      fecha_estimada_entrega: row.fecha_estimada_entrega,
      observaciones: row.observaciones,
      pagado: row.pagado,
      metodo_pago: row.metodo_pago,
      a_cuenta_corriente: row.a_cuenta_corriente === true,
      cliente: row.cliente_id ? {
        id: row.cliente_id,
        codigo: row.codigo_cliente,
        nombre: row.cliente_nombre
      } : null
    }));

    res.json(trabajos);
  } catch (error) {
    console.error('Error al obtener trabajos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los trabajos', error: error.message });
  }
};

//  GET: Obtener resumen (KPIs)
exports.obtenerResumen = async (req, res) => {
  try {
    const query = `
      SELECT
        estado,
        COUNT(*) AS cantidad,
        COALESCE(SUM(monto_diagnostico + monto_reparacion), 0) AS total
      FROM trabajos
      GROUP BY estado
    `;
    const result = await pool.query(query);

    const resumen = {
      pendiente: { cantidad: 0, total: 0 },
      en_diagnostico: { cantidad: 0, total: 0 },
      en_reparacion: { cantidad: 0, total: 0 },
      terminado: { cantidad: 0, total: 0 },
      entregado: { cantidad: 0, total: 0 },
      total_general: 0,
      cantidad_general: 0,
      pagados: { cantidad: 0, total: 0 },
      pendientes_cobro: { cantidad: 0, total: 0 }
    };

    result.rows.forEach(row => {
      const estado = String(row.estado || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_');
      if (resumen[estado]) {
        resumen[estado].cantidad = parseInt(row.cantidad);
        resumen[estado].total = parseFloat(row.total);
      }
      resumen.cantidad_general += parseInt(row.cantidad);
      resumen.total_general += parseFloat(row.total);
    });
    resumen.total_facturado = resumen.total_general;

    // Calcular pagados y pendientes de cobro
    const queryPagados = `
      SELECT
        pagado,
        COUNT(*) AS cantidad,
        COALESCE(SUM(monto_diagnostico + monto_reparacion), 0) AS total
      FROM trabajos
      GROUP BY pagado
    `;
    const resultPagados = await pool.query(queryPagados);

    resultPagados.rows.forEach(row => {
      if (row.pagado) {
        resumen.pagados = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      } else {
        resumen.pendientes_cobro = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      }
    });

    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener resumen:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el resumen', error: error.message });
  }
};

// 🟢 GET: Obtener clientes para el dropdown
exports.obtenerClientes = async (req, res) => {
  try {
    const query = `
      SELECT id, codigo_cliente, nombre_razon_social
      FROM clientes
      WHERE activo = true
      ORDER BY codigo_cliente ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los clientes', error: error.message });
  }
};

// Nombre corto de categoría usada para cobros de trabajos
const CAT_COBRO_SERVICIOS = 'Cobro Servicios';

// 🟡 POST: Crear un nuevo trabajo
exports.crearTrabajo = async (req, res) => {
  try {
    const {
      cliente_id, fecha_ingreso, tipo_equipo, marca_modelo,
      numero_serie, falla, monto_diagnostico, monto_reparacion,
      estado, fecha_estimada_entrega, observaciones, pagado,
      metodo_pago, a_cuenta_corriente
    } = req.body;

    if (!cliente_id || !fecha_ingreso || !tipo_equipo || !falla) {
      return res.status(400).json({ success: false, message: 'Cliente, fecha de ingreso, tipo de equipo y falla son obligatorios' });
    }

    // Generar código automático de orden (OT-0001, OT-0002...)
    const countResult = await pool.query('SELECT COUNT(*) FROM trabajos');
    const nuevoNumero = parseInt(countResult.rows[0].count) + 1;
    const codigoOrden = `OT-${String(nuevoNumero).padStart(4, '0')}`;

    const enCuentaCorriente = a_cuenta_corriente === true || metodo_pago === 'Cuenta Corriente';
    const pagadoFlag = enCuentaCorriente ? false : pagado === true;
    const montoTotal = (parseFloat(monto_diagnostico) || 0) + (parseFloat(monto_reparacion) || 0);

    if (enCuentaCorriente && montoTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Para enviar el trabajo a Cuenta Corriente, el monto total debe ser mayor a 0'
      });
    }

    const query = `
      INSERT INTO trabajos 
      (codigo_orden, cliente_id, fecha_ingreso, tipo_equipo, marca_modelo, numero_serie, falla, 
       monto_diagnostico, monto_reparacion, estado, fecha_estimada_entrega, observaciones, pagado,
       metodo_pago, a_cuenta_corriente)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, codigo_orden, cliente_id, estado, pagado, metodo_pago, a_cuenta_corriente
    `;
    const values = [
      codigoOrden,
      cliente_id,
      fecha_ingreso,
      tipo_equipo,
      marca_modelo || null,
      numero_serie || null,
      falla,
      monto_diagnostico || 0,
      monto_reparacion || 0,
      estado || 'Pendiente',
      fecha_estimada_entrega || null,
      observaciones || null,
      pagadoFlag,
      enCuentaCorriente ? 'Cuenta Corriente' : (metodo_pago || null),
      enCuentaCorriente
    ];
    const result = await pool.query(query, values);
    const trabajo = result.rows[0];

    let registradoFinanzas = false;
    let registradoCuentaCorriente = false;

    if (enCuentaCorriente) {
      // 🧾 Se registra como deuda del cliente en Cuenta Corriente.
      // No se suma a Finanzas hasta que el cliente pague.
      await sincronizarCcTrabajo({
        trabajoId: trabajo.id,
        clienteId: cliente_id,
        descripcion: descripcionTrabajo({ codigo_orden: trabajo.codigo_orden, tipo_equipo, marca_modelo, falla }),
        monto: montoTotal,
        fecha: fecha_ingreso,
        activa: true
      });
      registradoCuentaCorriente = true;
    } else if (pagadoFlag && montoTotal > 0) {
      // ✅ INTEGRACIÓN A FINANZAS: si se crea ya pagado con monto > 0
      const yaRegistrada = await pool.query(
        "SELECT id FROM movimientos_finanzas WHERE id_origen = $1",
        ['trabajo:' + trabajo.id]
      );
      if (yaRegistrada.rows.length === 0) {
        const catResult = await pool.query(
          'SELECT id FROM categorias_finanzas WHERE nombre = $1', [CAT_COBRO_SERVICIOS]
        );
        if (catResult.rows.length > 0) {
          const fechaMov = fecha_ingreso ? new Date(fecha_ingreso).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
          await pool.query(`
            INSERT INTO movimientos_finanzas
            (fecha_movimiento, tipo, categoria_id, descripcion, monto, id_origen)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            fechaMov,
            'Ingreso',
            catResult.rows[0].id,
            `Cobro de trabajo ${trabajo.codigo_orden}`,
            montoTotal,
            'trabajo:' + trabajo.id
          ]);
          registradoFinanzas = true;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: enCuentaCorriente
        ? `Trabajo ${codigoOrden} registrado y enviado a Cuenta Corriente del cliente`
        : `Trabajo registrado correctamente con código: ${codigoOrden}`,
      data: trabajo,
      registradoFinanzas,
      registradoCuentaCorriente
    });
  } catch (error) {
    console.error('Error al crear trabajo:', error);
    res.status(500).json({ success: false, message: 'Error al crear el trabajo', error: error.message });
  }
};

// 🟠 PUT: Editar un trabajo
exports.editarTrabajo = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      cliente_id, fecha_ingreso, tipo_equipo, marca_modelo,
      numero_serie, falla, monto_diagnostico, monto_reparacion,
      estado, fecha_estimada_entrega, observaciones, pagado,
      metodo_pago, a_cuenta_corriente
    } = req.body;

    // Verificar que el trabajo existe y obtener datos anteriores
    const checkQuery = `
      SELECT t.id, t.estado, t.pagado, t.codigo_orden, t.cliente_id,
             c.codigo_cliente, c.nombre_razon_social AS cliente_nombre
      FROM trabajos t
      LEFT JOIN clientes c ON c.id = t.cliente_id
      WHERE t.id = $1
    `;
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trabajo no encontrado' });
    }

    const previa = checkResult.rows[0];
    const pagadoAnterior = previa.pagado === true;
    const clienteTxt = previa.codigo_cliente && previa.cliente_nombre
      ? ` · ${previa.codigo_cliente} ${previa.cliente_nombre}`
      : '';

    const enCuentaCorriente = a_cuenta_corriente === true || metodo_pago === 'Cuenta Corriente';
    const pagadoNuevo = enCuentaCorriente ? false : pagado === true;
    const montoTotal = (parseFloat(monto_diagnostico) || 0) + (parseFloat(monto_reparacion) || 0);

    if (enCuentaCorriente && montoTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Para enviar el trabajo a Cuenta Corriente, el monto total debe ser mayor a 0'
      });
    }

    const query = `
      UPDATE trabajos
      SET cliente_id = $1, fecha_ingreso = $2, tipo_equipo = $3, marca_modelo = $4,
          numero_serie = $5, falla = $6, monto_diagnostico = $7, monto_reparacion = $8,
          estado = $9, fecha_estimada_entrega = $10, observaciones = $11, pagado = $12,
          metodo_pago = $13, a_cuenta_corriente = $14
      WHERE id = $15
      RETURNING id, codigo_orden, estado, pagado, metodo_pago, a_cuenta_corriente
    `;
    const values = [
      cliente_id, fecha_ingreso, tipo_equipo, marca_modelo,
      numero_serie, falla, monto_diagnostico || 0, monto_reparacion || 0,
      estado, fecha_estimada_entrega, observaciones, pagadoNuevo,
      enCuentaCorriente ? 'Cuenta Corriente' : (metodo_pago || null),
      enCuentaCorriente,
      id
    ];
    const result = await pool.query(query, values);
    const trabajo = result.rows[0];

    // 🧾 Sincronizar Cuenta Corriente (crea, actualiza o elimina la deuda)
    const cc = await sincronizarCcTrabajo({
      trabajoId: id,
      clienteId: cliente_id,
      descripcion: descripcionTrabajo({ codigo_orden: trabajo.codigo_orden, tipo_equipo, marca_modelo, falla }),
      monto: montoTotal,
      fecha: fecha_ingreso,
      activa: enCuentaCorriente
    });
    const registradoCuentaCorriente = ['creada', 'actualizada'].includes(cc.accion);

    // Si la deuda de CC ya tiene pagos, los ingresos ya se registraron en Finanzas:
    // no volvemos a registrar el cobro para no duplicar.
    const facturaCc = await buscarFacturaCc(origenTrabajo(id));
    const ccConPagos = facturaCc ? await facturaCcTienePagos(facturaCc.id) : false;

    // ✅ INTEGRACIÓN A FINANZAS:
    // Al pasar de "no pagado" a "pagado" con monto > 0, registrar un Ingreso en Finanzas
    // (una sola vez por trabajo, controlado por id_origen = 'trabajo:<id>')
    let registradoFinanzas = false;
    if (!enCuentaCorriente && trabajo.pagado && !pagadoAnterior && montoTotal > 0 && !ccConPagos) {
      const yaRegistrada = await pool.query(
        "SELECT id FROM movimientos_finanzas WHERE id_origen = $1",
        ['trabajo:' + id]
      );
      if (yaRegistrada.rows.length === 0) {
        const catResult = await pool.query(
          'SELECT id FROM categorias_finanzas WHERE nombre = $1', [CAT_COBRO_SERVICIOS]
        );
        if (catResult.rows.length > 0) {
          const fechaMov = fecha_ingreso ? new Date(fecha_ingreso).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
          await pool.query(`
            INSERT INTO movimientos_finanzas
            (fecha_movimiento, tipo, categoria_id, descripcion, monto, id_origen)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            fechaMov,
            'Ingreso',
            catResult.rows[0].id,
            `Cobro de trabajo ${trabajo.codigo_orden}${clienteTxt}`,
            montoTotal,
            'trabajo:' + id
          ]);
          registradoFinanzas = true;
        }
      }
    }

    res.json({
      success: true,
      message: enCuentaCorriente
        ? 'Trabajo actualizado y sincronizado con Cuenta Corriente'
        : 'Trabajo actualizado correctamente',
      data: trabajo,
      registradoFinanzas,
      registradoCuentaCorriente
    });
  } catch (error) {
    console.error('Error al editar trabajo:', error);
    res.status(500).json({ success: false, message: 'Error al editar el trabajo', error: error.message });
  }
};

// 🔴 DELETE: Eliminar un trabajo
exports.eliminarTrabajo = async (req, res) => {
  try {
    const { id } = req.params;

    const checkQuery = 'SELECT id, codigo_orden FROM trabajos WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trabajo no encontrado' });
    }

    // Si tenía una deuda en Cuenta Corriente sin pagos, la eliminamos también.
    const facturaCc = await buscarFacturaCc(origenTrabajo(id));
    if (facturaCc && !(await facturaCcTienePagos(facturaCc.id))) {
      await pool.query('DELETE FROM movimientos_cc WHERE id = $1', [facturaCc.id]);
    }

    await pool.query('DELETE FROM trabajos WHERE id = $1', [id]);

    res.json({ success: true, message: 'Trabajo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar trabajo:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el trabajo', error: error.message });
  }
};