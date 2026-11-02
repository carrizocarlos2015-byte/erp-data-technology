// src/controllers/categoriasController.js
const pool = require('../config/db');

// GET: Obtener todas las categorías (AHORA INCLUYE AMBITO)
exports.obtenerCategorias = async (req, res) => {
    try {
        const query = `
            SELECT 
                cf.id, 
                cf.nombre, 
                cf.icono, 
                cf.color_hex, 
                cf.ambito, 
                COUNT(DISTINCT mf.id) AS cantidad_movimientos, 
                COALESCE( 
                    json_agg( 
                        json_build_object( 
                            'id', sf.id, 
                            'nombre', sf.nombre, 
                            'icono', sf.icono, 
                            'cantidad_movimientos', (SELECT COUNT(*) FROM movimientos_finanzas mf2 WHERE mf2.subcategoria_id = sf.id) 
                        ) ORDER BY sf.nombre 
                    ) FILTER (WHERE sf.id IS NOT NULL), '[]'::json 
                ) AS subcategorias 
            FROM categorias_finanzas cf 
            LEFT JOIN subcategorias_finanzas sf ON cf.id = sf.categoria_id 
            LEFT JOIN movimientos_finanzas mf ON mf.categoria_id = cf.id 
            GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito 
            ORDER BY cf.nombre ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST: Crear nueva categoría (CON ÁMBITO)
exports.crearCategoria = async (req, res) => {
    try {
        const { nombre, icono, color_hex, ambito } = req.body;
        if (!nombre || nombre.trim() === '') return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
        
        // Validar y normalizar ámbito
        const ambitoValido = ['INGRESO', 'EGRESO', 'GENERAL'].includes(ambito?.toUpperCase()) ? ambito.toUpperCase() : 'EGRESO';
        
        const query = `INSERT INTO categorias_finanzas (nombre, icono, color_hex, ambito) VALUES ($1, $2, $3, $4) RETURNING id, nombre, icono, color_hex, ambito`;
        const result = await pool.query(query, [nombre.trim(), icono || '', color_hex || '#6c757d', ambitoValido]);
        
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
        const { nombre, icono, color_hex, ambito } = req.body;
        if (!nombre || nombre.trim() === '') return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
        
        const ambitoValido = ['INGRESO', 'EGRESO', 'GENERAL'].includes(ambito?.toUpperCase()) ? ambito.toUpperCase() : undefined;
        
        const query = ambitoValido
            ? `UPDATE categorias_finanzas SET nombre = $1, icono = $2, color_hex = $3, ambito = $4 WHERE id = $5 RETURNING id, nombre, icono, color_hex, ambito`
            : `UPDATE categorias_finanzas SET nombre = $1, icono = $2, color_hex = $3 WHERE id = $4 RETURNING id, nombre, icono, color_hex`;
            
        const values = ambitoValido 
            ? [nombre.trim(), icono || '', color_hex || '', ambitoValido, id] 
            : [nombre.trim(), icono || '', color_hex || '', id];
            
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