// src/controllers/categoriasController.js
const pool = require('../config/db');

// GET: Obtener todas las categorías (AHORA INCLUYE AMBITO)
exports.obtenerCategorias = async (req, res) => {
    try {
        // Primero: categorías con conteo de movimientos
        const catQuery = `
            SELECT 
                cf.id, 
                cf.nombre, 
                cf.icono, 
                cf.color_hex, 
                cf.ambito, 
                cf.ambito_negocio,
                COUNT(DISTINCT mf.id) AS cantidad_movimientos
            FROM categorias_finanzas cf
            LEFT JOIN movimientos_finanzas mf ON mf.categoria_id = cf.id
            GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito, cf.ambito_negocio
            ORDER BY cf.nombre ASC
        `;
        const catResult = await pool.query(catQuery);

        const cats = catResult.rows.map(row => ({
            id: row.id,
            nombre: row.nombre,
            icono: row.icono,
            color_hex: row.color_hex,
            ambito: row.ambito,
            ambito_negocio: row.ambito_negocio,
            cantidad_movimientos: parseInt(row.cantidad_movimientos || 0),
            subcategorias: []
        }));

        // Segundo: subcategorías (sin joins que multipliquen filas)
        const subQuery = `
            SELECT 
                sf.id, 
                sf.nombre, 
                sf.icono, 
                sf.categoria_id,
                (SELECT COUNT(*) FROM movimientos_finanzas mf2 WHERE mf2.subcategoria_id = sf.id) AS cantidad_movimientos
            FROM subcategorias_finanzas sf
            ORDER BY sf.categoria_id, sf.nombre
        `;
        const subResult = await pool.query(subQuery);
        const subMap = {};
        subResult.rows.forEach(s => {
            if (!subMap[s.categoria_id]) subMap[s.categoria_id] = [];
            subMap[s.categoria_id].push({
                id: s.id,
                nombre: s.nombre,
                icono: s.icono,
                cantidad_movimientos: parseInt(s.cantidad_movimientos || 0)
            });
        });
        cats.forEach(c => { c.subcategorias = subMap[c.id] || []; });

        res.json(cats);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST: Crear nueva categoría (CON ÁMBITO)
exports.crearCategoria = async (req, res) => {
    try {
        const { nombre, icono, color_hex, ambito, ambito_negocio } = req.body;
        if (!nombre || nombre.trim() === '') return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
        
        // Validar y normalizar tipo (Ingreso/Egreso/General)
        const ambitoValido = ['INGRESO', 'EGRESO', 'GENERAL'].includes(ambito?.toUpperCase()) ? ambito.toUpperCase() : 'EGRESO';
        // Validar y normalizar ámbito (Casa/Empresa/General)
        const ambitoNegocioValido = ['CASA', 'EMPRESA', 'GENERAL'].includes(ambito_negocio?.toUpperCase()) ? ambito_negocio.toUpperCase() : 'GENERAL';

        // Evitar duplicados (la tabla tiene índice único por nombre)
        const existe = await pool.query('SELECT id FROM categorias_finanzas WHERE LOWER(nombre) = LOWER($1)', [nombre.trim()]);
        if (existe.rows.length > 0) {
            return res.status(409).json({ success: false, message: `Ya existe una categoría llamada "${nombre.trim()}"` });
        }

        const query = `INSERT INTO categorias_finanzas (nombre, icono, color_hex, ambito, ambito_negocio) VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, icono, color_hex, ambito, ambito_negocio`;
        const result = await pool.query(query, [nombre.trim(), icono || '', color_hex || '#6c757d', ambitoValido, ambitoNegocioValido]);
        
        res.status(201).json({ success: true, message: 'Categoría creada correctamente', data: result.rows[0] });
    } catch (error) {
        console.error('Error al crear categoría:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT: Editar categoría (CON ÁMBITO)
exports.editarCategoria = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, icono, color_hex, ambito, ambito_negocio } = req.body;
        if (!nombre || nombre.trim() === '') return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });

        // Evitar duplicados al renombrar
        const existe = await pool.query(
            'SELECT id FROM categorias_finanzas WHERE LOWER(nombre) = LOWER($1) AND id <> $2',
            [nombre.trim(), id]
        );
        if (existe.rows.length > 0) {
            return res.status(409).json({ success: false, message: `Ya existe una categoría llamada "${nombre.trim()}"` });
        }
        
        const sets = ['nombre = $1', 'icono = $2', 'color_hex = $3'];
        const values = [nombre.trim(), icono || '', color_hex || ''];
        let pos = 4;
        
        if (ambito && ['INGRESO', 'EGRESO', 'GENERAL'].includes(ambito.toUpperCase())) {
            sets.push(`ambito = $${pos++}`);
            values.push(ambito.toUpperCase());
        }
        if (ambito_negocio && ['CASA', 'EMPRESA', 'GENERAL'].includes(ambito_negocio.toUpperCase())) {
            sets.push(`ambito_negocio = $${pos++}`);
            values.push(ambito_negocio.toUpperCase());
        }
        
        values.push(id);
        const query = `UPDATE categorias_finanzas SET ${sets.join(', ')} WHERE id = $${pos} RETURNING id, nombre, icono, color_hex, ambito, ambito_negocio`;
        const result = await pool.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Categoría no encontrada' });
        
        res.json({ success: true, message: 'Categoría actualizada correctamente', data: result.rows[0] });
    } catch (error) {
        console.error('Error al editar categoría:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE: Eliminar categoría
exports.eliminarCategoria = async (req, res) => {
    try {
        const { id } = req.params;
        const checkResult = await pool.query(`SELECT COUNT(*) AS total FROM movimientos_finanzas WHERE categoria_id = $1`, [id]);
        if (parseInt(checkResult.rows[0].total) > 0) return res.status(400).json({ success: false, message: 'No se puede eliminar: tiene movimientos asociados' });
        
        await pool.query('DELETE FROM subcategorias_finanzas WHERE categoria_id = $1', [id]);
        const result = await pool.query('DELETE FROM categorias_finanzas WHERE id = $1 RETURNING nombre', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Categoría no encontrada' });
        
        res.json({ success: true, message: 'Categoría eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST: Crear subcategoría
exports.crearSubcategoria = async (req, res) => {
    try {
        const { nombre, categoria_id, icono } = req.body;
        if (!nombre || !categoria_id) return res.status(400).json({ success: false, message: 'Nombre y categoría obligatorios' });
        const result = await pool.query(`INSERT INTO subcategorias_finanzas (nombre, categoria_id, icono) VALUES ($1, $2, $3) RETURNING id, nombre, categoria_id, icono`, [nombre.trim(), categoria_id, icono || '']);
        res.status(201).json({ success: true, message: 'Subcategoría creada', data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT: Editar subcategoría
exports.editarSubcategoria = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, icono } = req.body;
        if (!nombre) return res.status(400).json({ success: false, message: 'Nombre obligatorio' });
        const result = await pool.query(`UPDATE subcategorias_finanzas SET nombre = $1, icono = $2 WHERE id = $3 RETURNING id, nombre, icono`, [nombre.trim(), icono || '', id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'No encontrada' });
        res.json({ success: true, message: 'Actualizada', data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE: Eliminar subcategoría
exports.eliminarSubcategoria = async (req, res) => {
    try {
        const { id } = req.params;
        const checkResult = await pool.query(`SELECT COUNT(*) AS total FROM movimientos_finanzas WHERE subcategoria_id = $1`, [id]);
        if (parseInt(checkResult.rows[0].total) > 0) return res.status(400).json({ success: false, message: 'Tiene movimientos asociados' });
        const result = await pool.query('DELETE FROM subcategorias_finanzas WHERE id = $1 RETURNING nombre', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'No encontrada' });
        res.json({ success: true, message: 'Eliminada' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};