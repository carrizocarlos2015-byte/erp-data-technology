// src/controllers/agendaController.js
// Controlador del Módulo de Agenda

const pool = require('../config/db');

// Nombre corto de categoría usada para cobros de agenda
const CAT_COBRO_SERVICIOS = 'Cobro Servicios';

// ============================================================
// Migración: columna para el cobro por Cuenta Corriente
// ============================================================
pool.query(`ALTER TABLE agenda ADD COLUMN IF NOT EXISTS a_cuenta_corriente BOOLEAN DEFAULT false`)
  .then(() => console.log('✅ Columna a_cuenta_corriente lista en agenda'))
  .catch(err => console.error('❌ Error en migración de agenda:', err.message));

// ============================================================
// Helpers: vincular eventos con Cuenta Corriente
// ============================================================
const origenAgenda = id => `agenda:${id}`;

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

function descripcionAgenda(evento, titulo) {
  const t = titulo || evento.titulo || '';
  return `Agenda ${evento.codigo_evento || ''}${t ? ` - ${String(t).slice(0, 120)}` : ''}`.trim();
}

// Fecha/hora fin = inicio + 1 hora, sin conversiones UTC
function sumarUnaHora(fecha, hora) {
  const [y, m, d] = String(fecha).split('-').map(Number);
  const [hh, mm] = String(hora).split(':').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  dt.setHours(dt.getHours() + 1);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// Crea, actualiza o elimina la factura de Cuenta Corriente asociada a un evento.
async function sincronizarCcAgenda({ eventoId, clienteId, descripcion, monto, fecha, activa }) {
  const origen = origenAgenda(eventoId);
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
       VALUES ($1, $2, $3, $4, 0, 'Factura', 'Servicios', $5, 'Cuenta Corriente')`,
      [clienteId, fecha, descripcion, monto, origen]
    );
    return { accion: 'creada' };
  }

  const tienePagos = await facturaCcTienePagos(factura.id);
  if (tienePagos) {
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

// 🟢 GET: Obtener todos los eventos
exports.obtenerEventos = async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id,
        a.codigo_evento,
        a.titulo,
        a.cliente_id,
        to_char(a.fecha_inicio, 'YYYY-MM-DD"T"HH24:MI') AS fecha_inicio,
        to_char(a.fecha_fin, 'YYYY-MM-DD"T"HH24:MI') AS fecha_fin,
        a.tipo_evento,
        a.estado,
        a.observaciones,
        a.monto_cobrado,
        a.metodo_pago,
        a.cobrado,
        a.a_cuenta_corriente,
        a.created_at,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre
      FROM agenda a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      ORDER BY a.fecha_inicio DESC
    `;
    const result = await pool.query(query);

    const eventos = result.rows.map(row => ({
      id: row.id,
      codigo_evento: row.codigo_evento,
      titulo: row.titulo,
      cliente_id: row.cliente_id,
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin,
      hora_inicio: row.fecha_inicio ? String(row.fecha_inicio).split('T')[1] || null : null,
      hora_fin: row.fecha_fin ? String(row.fecha_fin).split('T')[1] || null : null,
      tipo_evento: row.tipo_evento,
      estado: row.estado,
      observaciones: row.observaciones,
      monto_cobrado: parseFloat(row.monto_cobrado),
      metodo_pago: row.metodo_pago,
      cobrado: row.cobrado,
      a_cuenta_corriente: row.a_cuenta_corriente === true,
      cliente: row.cliente_id ? {
        id: row.cliente_id,
        codigo: row.codigo_cliente,
        nombre: row.cliente_nombre
      } : null
    }));

    res.json(eventos);
  } catch (error) {
    console.error('Error al obtener eventos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los eventos', error: error.message });
  }
};

// 🟢 GET: Obtener resumen (KPIs)
exports.obtenerResumen = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT estado, COUNT(*) AS cantidad,
             COALESCE(SUM(monto_cobrado), 0) AS total
      FROM agenda
      GROUP BY estado
    `);

    const resumen = {
      pendiente: { cantidad: 0, total: 0 },
      confirmado: { cantidad: 0, total: 0 },
      en_curso: { cantidad: 0, total: 0 },
      completado: { cantidad: 0, total: 0 },
      cancelado: { cantidad: 0, total: 0 },
      total_general: 0,
      cantidad_general: 0,
      cobrados: { cantidad: 0, total: 0 },
      pendientes_cobro: { cantidad: 0, total: 0 }
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

    const resultCobros = await pool.query(`
      SELECT cobrado, COUNT(*) AS cantidad,
             COALESCE(SUM(monto_cobrado), 0) AS total
      FROM agenda
      GROUP BY cobrado
    `);

    resultCobros.rows.forEach(row => {
      if (row.cobrado) {
        resumen.cobrados = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      } else {
        resumen.pendientes_cobro = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      }
    });

    // Eventos próximos (próximas 24 horas, no completados ni cancelados)
    const resultProximos = await pool.query(`
      SELECT COUNT(*) AS cantidad
      FROM agenda
      WHERE fecha_inicio >= NOW()
        AND fecha_inicio <= NOW() + INTERVAL '24 hours'
        AND estado NOT IN ('Completado', 'Cancelado')
    `);
    resumen.proximos_24hs = parseInt(resultProximos.rows[0].cantidad);

    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener resumen:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el resumen', error: error.message });
  }
};

// 🟢 GET: Obtener clientes para el dropdown
exports.obtenerClientes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, codigo_cliente, nombre_razon_social
      FROM clientes WHERE activo = true
      ORDER BY codigo_cliente ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los clientes', error: error.message });
  }
};

// 🟡 POST: Crear un nuevo evento
exports.crearEvento = async (req, res) => {
  try {
    const {
      titulo, cliente_id, fecha_inicio, hora_inicio,
      tipo_evento, estado, observaciones, monto_cobrado, metodo_pago, cobrado,
      a_cuenta_corriente
    } = req.body;

    if (!titulo || !fecha_inicio || !hora_inicio) {
      return res.status(400).json({ success: false, message: 'Título, fecha de inicio y hora de inicio son obligatorios' });
    }

    const enCuentaCorriente = a_cuenta_corriente === true || metodo_pago === 'Cuenta Corriente';
    const monto = parseFloat(monto_cobrado) || 0;

    if (enCuentaCorriente && !cliente_id) {
      return res.status(400).json({
        success: false,
        message: 'Para enviar el evento a Cuenta Corriente tenés que asignarle un cliente'
      });
    }
    if (enCuentaCorriente && monto <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Para enviar el evento a Cuenta Corriente, el monto debe ser mayor a 0'
      });
    }

    // Fecha fin = inicio + 1 hora (hora local, sin conversión UTC)
    const inicioStr = `${fecha_inicio}T${hora_inicio}`;
    const fechaFinStr = sumarUnaHora(fecha_inicio, hora_inicio);

    const countResult = await pool.query('SELECT COUNT(*) FROM agenda');
    const nuevoNumero = parseInt(countResult.rows[0].count) + 1;
    const codigoEvento = `EVT-${String(nuevoNumero).padStart(4, '0')}`;

    const cobradoFlag = enCuentaCorriente ? false : cobrado === true;

    const query = `
      INSERT INTO agenda
      (codigo_evento, titulo, cliente_id, fecha_inicio, fecha_fin, tipo_evento,
       estado, observaciones, monto_cobrado, metodo_pago, cobrado, a_cuenta_corriente)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, codigo_evento, titulo, estado, cobrado, monto_cobrado, metodo_pago, a_cuenta_corriente
    `;
    const values = [
      codigoEvento, titulo, cliente_id || null,
      inicioStr,
      fechaFinStr,
      tipo_evento || 'Visita Técnica',
      estado || 'Pendiente',
      observaciones || null,
      monto,
      enCuentaCorriente ? 'Cuenta Corriente' : (metodo_pago || null),
      cobradoFlag,
      enCuentaCorriente
    ];
    const result = await pool.query(query, values);
    const evento = result.rows[0];

    let registradoFinanzas = false;
    let registradoCuentaCorriente = false;

    if (enCuentaCorriente) {
      // 🧾 Se registra como deuda del cliente en Cuenta Corriente.
      await sincronizarCcAgenda({
        eventoId: evento.id,
        clienteId: cliente_id,
        descripcion: descripcionAgenda(evento, titulo),
        monto,
        fecha: fecha_inicio,
        activa: true
      });
      registradoCuentaCorriente = true;
    } else if (cobradoFlag && monto > 0) {
      // ✅ INTEGRACIÓN A FINANZAS: si se crea ya cobrado con monto > 0
      const yaRegistrada = await pool.query(
        "SELECT id FROM movimientos_finanzas WHERE id_origen = $1",
        ['agenda:' + evento.id]
      );
      if (yaRegistrada.rows.length === 0) {
        const catResult = await pool.query(
          'SELECT id FROM categorias_finanzas WHERE nombre = $1', [CAT_COBRO_SERVICIOS]
        );
        if (catResult.rows.length > 0) {
          let metodoId = null;
          if (metodo_pago) {
            const mpResult = await pool.query('SELECT id FROM metodos_pago WHERE nombre = $1', [metodo_pago]);
            if (mpResult.rows.length > 0) metodoId = mpResult.rows[0].id;
          }
          const fechaMov = fecha_inicio ? new Date(fecha_inicio).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
          await pool.query(`
            INSERT INTO movimientos_finanzas
            (fecha_movimiento, tipo, categoria_id, metodo_pago_id, descripcion, monto, id_origen)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            fechaMov,
            'Ingreso',
            catResult.rows[0].id,
            metodoId,
            `Cobro agenda ${evento.codigo_evento} - ${evento.titulo}`,
            monto,
            'agenda:' + evento.id
          ]);
          registradoFinanzas = true;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: enCuentaCorriente
        ? `Evento ${codigoEvento} registrado y enviado a Cuenta Corriente del cliente`
        : `Evento registrado correctamente con código: ${codigoEvento}`,
      data: evento,
      registradoFinanzas,
      registradoCuentaCorriente
    });
  } catch (error) {
    console.error('Error al crear evento:', error);
    res.status(500).json({ success: false, message: 'Error al crear el evento', error: error.message });
  }
};

// 🟠 PUT: Editar un evento (con integración a Finanzas)
exports.editarEvento = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      titulo, cliente_id, fecha_inicio, hora_inicio,
      tipo_evento, estado, observaciones, monto_cobrado, metodo_pago, cobrado,
      a_cuenta_corriente
    } = req.body;

    if (!fecha_inicio || !hora_inicio) {
      return res.status(400).json({ success: false, message: 'Fecha de inicio y hora de inicio son obligatorias' });
    }

    const enCuentaCorriente = a_cuenta_corriente === true || metodo_pago === 'Cuenta Corriente';
    const monto = parseFloat(monto_cobrado) || 0;

    if (enCuentaCorriente && !cliente_id) {
      return res.status(400).json({
        success: false,
        message: 'Para enviar el evento a Cuenta Corriente tenés que asignarle un cliente'
      });
    }
    if (enCuentaCorriente && monto <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Para enviar el evento a Cuenta Corriente, el monto debe ser mayor a 0'
      });
    }

    // Fecha fin = inicio + 1 hora (hora local, sin conversión UTC)
    const inicioStr = `${fecha_inicio}T${hora_inicio}`;
    const fechaFinStr = sumarUnaHora(fecha_inicio, hora_inicio);

    const checkResult = await pool.query(`
      SELECT a.id, a.estado, a.cobrado, a.monto_cobrado,
             c.codigo_cliente, c.nombre_razon_social AS cliente_nombre
      FROM agenda a
      LEFT JOIN clientes c ON c.id = a.cliente_id
      WHERE a.id = $1
    `, [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    }

    const previa = checkResult.rows[0];
    const cobradoAnterior = previa.cobrado === true;
    const clienteTxt = previa.codigo_cliente && previa.cliente_nombre
      ? ` · ${previa.codigo_cliente} ${previa.cliente_nombre}`
      : '';

    const cobradoNuevo = enCuentaCorriente ? false : cobrado === true;

    const query = `
      UPDATE agenda
      SET titulo = $1, cliente_id = $2, fecha_inicio = $3, fecha_fin = $4,
          tipo_evento = $5, estado = $6, observaciones = $7,
          monto_cobrado = $8, metodo_pago = $9, cobrado = $10, a_cuenta_corriente = $11
      WHERE id = $12
      RETURNING id, codigo_evento, titulo, estado, cobrado, monto_cobrado, metodo_pago, a_cuenta_corriente
    `;
    const values = [
      titulo, cliente_id || null, inicioStr, fechaFinStr,
      tipo_evento, estado, observaciones || null,
      monto, enCuentaCorriente ? 'Cuenta Corriente' : (metodo_pago || null), cobradoNuevo,
      enCuentaCorriente,
      id
    ];
    const result = await pool.query(query, values);
    const evento = result.rows[0];

    // 🧾 Sincronizar Cuenta Corriente (crea, actualiza o elimina la deuda)
    const cc = await sincronizarCcAgenda({
      eventoId: id,
      clienteId: cliente_id,
      descripcion: descripcionAgenda(evento, titulo),
      monto,
      fecha: fecha_inicio,
      activa: enCuentaCorriente
    });
    const registradoCuentaCorriente = ['creada', 'actualizada'].includes(cc.accion);

    // Si la deuda de CC ya tiene pagos, los ingresos ya se registraron en Finanzas:
    // no volvemos a registrar el cobro para no duplicar.
    const facturaCc = await buscarFacturaCc(origenAgenda(id));
    const ccConPagos = facturaCc ? await facturaCcTienePagos(facturaCc.id) : false;

    // ✅ INTEGRACIÓN A FINANZAS:
    // Al pasar de "no cobrado" a "cobrado" con monto > 0, registrar un Ingreso en Finanzas
    // (una sola vez por evento, controlado por id_origen = 'agenda:<id>')
    let registradoFinanzas = false;
    if (!enCuentaCorriente && evento.cobrado && !cobradoAnterior && monto > 0 && !ccConPagos) {
      const yaRegistrada = await pool.query(
        "SELECT id FROM movimientos_finanzas WHERE id_origen = $1",
        ['agenda:' + id]
      );
      if (yaRegistrada.rows.length === 0) {
        const catResult = await pool.query(
          'SELECT id FROM categorias_finanzas WHERE nombre = $1', [CAT_COBRO_SERVICIOS]
        );
        if (catResult.rows.length > 0) {
          let metodoId = null;
          if (metodo_pago) {
            const mpResult = await pool.query('SELECT id FROM metodos_pago WHERE nombre = $1', [metodo_pago]);
            if (mpResult.rows.length > 0) metodoId = mpResult.rows[0].id;
          }
          const fechaMov = fecha_inicio ? new Date(fecha_inicio).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
          await pool.query(`
            INSERT INTO movimientos_finanzas
            (fecha_movimiento, tipo, categoria_id, metodo_pago_id, descripcion, monto, id_origen)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            fechaMov,
            'Ingreso',
            catResult.rows[0].id,
            metodoId,
            `Cobro agenda ${evento.codigo_evento} - ${evento.titulo}${clienteTxt}`,
            monto,
            'agenda:' + id
          ]);
          registradoFinanzas = true;
        }
      }
    }

    res.json({
      success: true,
      message: enCuentaCorriente
        ? 'Evento actualizado y sincronizado con Cuenta Corriente'
        : 'Evento actualizado correctamente',
      data: evento,
      registradoFinanzas,
      registradoCuentaCorriente
    });
  } catch (error) {
    console.error('Error al editar evento:', error);
    res.status(500).json({ success: false, message: 'Error al editar el evento', error: error.message });
  }
};

// 🔴 DELETE: Eliminar un evento
exports.eliminarEvento = async (req, res) => {
  try {
    const { id } = req.params;
    const checkResult = await pool.query('SELECT id, codigo_evento FROM agenda WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    }

    // Si tenía una deuda en Cuenta Corriente sin pagos, la eliminamos también.
    const facturaCc = await buscarFacturaCc(origenAgenda(id));
    if (facturaCc && !(await facturaCcTienePagos(facturaCc.id))) {
      await pool.query('DELETE FROM movimientos_cc WHERE id = $1', [facturaCc.id]);
    }

    await pool.query('DELETE FROM agenda WHERE id = $1', [id]);
    res.json({ success: true, message: 'Evento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar evento:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el evento', error: error.message });
  }
};