const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, getTenantMerchantId } = require('../middleware/authMiddleware');

// Helper to get merchant ID
function resolveMerchantId(req) {
  return getTenantMerchantId(req) || req.query.merchant_id || 1;
}

// -------------------------------------------------------------
// 1. INGREDIENTS / RAW MATERIALS (BAHAN BAKU)
// -------------------------------------------------------------

// GET /api/inventory/ingredients
router.get('/ingredients', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const { category, status, search } = req.query;

    const whereConditions = ['merchant_id = $1'];
    const params = [merchantId];

    if (category && category !== 'all') {
      params.push(category);
      whereConditions.push(`category = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      whereConditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`);
    }

    const query = `
      SELECT 
        id, sku, name, category, unit,
        current_stock AS "currentStock",
        minimum_stock AS "minimumStock",
        cost_per_unit AS "costPerUnit",
        supplier, description, status,
        updated_at AS "updatedAt"
      FROM raw_materials
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY name ASC
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ingredients:', error.message);
    res.status(500).json({ message: 'Gagal mengambil data bahan baku.' });
  }
});

// POST /api/inventory/ingredients
router.post('/ingredients', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const { sku, name, category, unit, currentStock, minimumStock, costPerUnit, supplier, description } = req.body;

    const curr = Number(currentStock) || 0;
    const min = Number(minimumStock) || 0;
    const cost = Number(costPerUnit) || 0;
    const status = curr <= 0 ? 'Habis' : curr <= min ? 'Menipis' : 'Aman';

    const insertResult = await pool.query(
      `INSERT INTO raw_materials (merchant_id, sku, name, category, unit, current_stock, minimum_stock, cost_per_unit, supplier, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, sku, name, category, unit, current_stock AS "currentStock", minimum_stock AS "minimumStock", cost_per_unit AS "costPerUnit", supplier, description, status, updated_at AS "updatedAt"`,
      [merchantId, sku || null, name, category || 'Bahan Umum', unit || 'gram', curr, min, cost, supplier || '-', description || '', status]
    );

    const newItem = insertResult.rows[0];

    // Record initial mutation if stock > 0
    if (curr > 0) {
      await pool.query(
        `INSERT INTO stock_mutations (merchant_id, raw_material_id, raw_material_name, type, change_amount, current_stock, unit, cost_per_unit, reference, notes)
         VALUES ($1, $2, $3, 'initial_stock', $4, $5, $6, $7, 'INIT-INPUT', 'Stok awal bahan baku baru')`,
        [merchantId, newItem.id, newItem.name, curr, curr, newItem.unit, cost]
      );
    }

    res.status(201).json({ success: true, data: newItem });
  } catch (error) {
    console.error('Error creating ingredient:', error.message);
    res.status(500).json({ message: 'Gagal menambahkan bahan baku.' });
  }
});

// PUT /api/inventory/ingredients/:id
router.put('/ingredients/:id', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const { id } = req.params;
    const { sku, name, category, unit, currentStock, minimumStock, costPerUnit, supplier, description } = req.body;

    const curr = Number(currentStock) || 0;
    const min = Number(minimumStock) || 0;
    const cost = Number(costPerUnit) || 0;
    const status = curr <= 0 ? 'Habis' : curr <= min ? 'Menipis' : 'Aman';

    const updateResult = await pool.query(
      `UPDATE raw_materials
       SET sku = COALESCE($1, sku),
           name = COALESCE($2, name),
           category = COALESCE($3, category),
           unit = COALESCE($4, unit),
           current_stock = $5,
           minimum_stock = $6,
           cost_per_unit = $7,
           supplier = COALESCE($8, supplier),
           description = COALESCE($9, description),
           status = $10,
           updated_at = NOW()
       WHERE id = $11 AND merchant_id = $12
       RETURNING id, sku, name, category, unit, current_stock AS "currentStock", minimum_stock AS "minimumStock", cost_per_unit AS "costPerUnit", supplier, description, status, updated_at AS "updatedAt"`,
      [sku, name, category, unit, curr, min, cost, supplier, description, status, id, merchantId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    }

    res.json({ success: true, data: updateResult.rows[0] });
  } catch (error) {
    console.error('Error updating ingredient:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui bahan baku.' });
  }
});

// DELETE /api/inventory/ingredients/:id
router.delete('/ingredients/:id', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const { id } = req.params;

    const delResult = await pool.query(
      'DELETE FROM raw_materials WHERE id = $1 AND merchant_id = $2 RETURNING id',
      [id, merchantId]
    );

    if (delResult.rowCount === 0) {
      return res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ingredient:', error.message);
    res.status(500).json({ message: 'Gagal menghapus bahan baku.' });
  }
});

// -------------------------------------------------------------
// 2. RECIPES (RESEP PRODUK & BOM)
// -------------------------------------------------------------

// GET /api/inventory/recipes
router.get('/recipes', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const query = `
      SELECT 
        pr.id, pr.product_id, pr.product_name, pr.raw_material_id AS "ingredientId",
        pr.quantity, pr.unit, pr.custom_note AS "customNote",
        rm.name AS "ingredientName", rm.cost_per_unit AS "costPerUnit"
      FROM product_recipes pr
      JOIN raw_materials rm ON pr.raw_material_id = rm.id
      WHERE pr.merchant_id = $1
      ORDER BY pr.product_name ASC, pr.id ASC
    `;
    const result = await pool.query(query, [merchantId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recipes:', error.message);
    res.status(500).json({ message: 'Gagal mengambil resep produk.' });
  }
});

// PUT /api/inventory/recipes/:productKey
router.put('/recipes/:productKey', optionalToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const merchantId = resolveMerchantId(req);
    const { productKey } = req.params;
    const { items = [] } = req.body;

    await client.query('BEGIN');

    // Delete existing recipe for this product
    await client.query(
      'DELETE FROM product_recipes WHERE merchant_id = $1 AND (product_name = $2 OR product_id::text = $2)',
      [merchantId, decodeURIComponent(productKey)]
    );

    // Insert new items
    for (const it of items) {
      if (it.ingredientId && Number(it.quantity) > 0) {
        await client.query(
          `INSERT INTO product_recipes (merchant_id, product_name, raw_material_id, quantity, unit, custom_note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [merchantId, decodeURIComponent(productKey), it.ingredientId, Number(it.quantity), it.unit || 'gram', it.customNote || '']
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Resep produk berhasil disimpan.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving recipe:', error.message);
    res.status(500).json({ message: 'Gagal menyimpan resep produk.' });
  } finally {
    client.release();
  }
});

// -------------------------------------------------------------
// 3. STOCK OPNAME SESSIONS
// -------------------------------------------------------------

// GET /api/inventory/opname
router.get('/opname', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const sessionsRes = await pool.query(
      `SELECT id, code, date, checker, notes,
              total_items_checked AS "totalItemsChecked",
              items_with_diff AS "itemsWithDiff",
              total_loss_value AS "totalLossValue",
              status
       FROM stock_opname_sessions
       WHERE merchant_id = $1
       ORDER BY date DESC
       LIMIT 50`,
      [merchantId]
    );

    res.json(sessionsRes.rows);
  } catch (error) {
    console.error('Error fetching stock opnames:', error.message);
    res.status(500).json({ message: 'Gagal mengambil riwayat stock opname.' });
  }
});

// POST /api/inventory/opname
router.post('/opname', optionalToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const merchantId = resolveMerchantId(req);
    const { checker, notes, opnameItems = [] } = req.body;

    const now = new Date();
    const code = `SO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Date.now()).slice(-4)}`;

    await client.query('BEGIN');

    let totalLoss = 0;
    let withDiff = 0;

    // 1. Create session header
    const sessResult = await client.query(
      `INSERT INTO stock_opname_sessions (merchant_id, code, date, checker, notes, total_items_checked, items_with_diff, total_loss_value, status)
       VALUES ($1, $2, NOW(), $3, $4, $5, 0, 0, 'Selesai & Disesuaikan')
       RETURNING id, code, date, checker, notes`,
      [merchantId, code, checker || 'Admin Bertugas', notes || 'Stock Opname reguler', opnameItems.length]
    );

    const sessionId = sessResult.rows[0].id;

    // 2. Process items
    for (const it of opnameItems) {
      const diff = Number(it.physicalStock) - Number(it.systemStock);
      const cost = Number(it.costPerUnit) || 0;
      const loss = diff < 0 ? Math.abs(diff) * cost : 0;

      if (diff !== 0) {
        withDiff += 1;
        totalLoss += loss;
      }

      await client.query(
        `INSERT INTO stock_opname_items (session_id, raw_material_id, raw_material_name, unit, cost_per_unit, system_stock, physical_stock, difference, loss_value, beban_category, reason_label, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [sessionId, it.ingredientId, it.name, it.unit, cost, it.systemStock, it.physicalStock, diff, loss, it.bebanCategory || 'cocok', it.reasonLabel || '', it.notes || '']
      );

      // Update physical stock in raw_materials
      const newStock = Number(it.physicalStock) || 0;
      const status = newStock <= 0 ? 'Habis' : newStock <= 200 ? 'Menipis' : 'Aman';

      await client.query(
        `UPDATE raw_materials
         SET current_stock = $1, status = $2, updated_at = NOW()
         WHERE id = $3 AND merchant_id = $4`,
        [newStock, status, it.ingredientId, merchantId]
      );

      // Record mutation
      if (diff !== 0) {
        await client.query(
          `INSERT INTO stock_mutations (merchant_id, raw_material_id, raw_material_name, type, change_amount, current_stock, unit, cost_per_unit, beban_category, beban_amount, reference, notes)
           VALUES ($1, $2, $3, 'stock_opname', $4, $5, $6, $7, $8, $9, $10, $11)`,
          [merchantId, it.ingredientId, it.name, diff, newStock, it.unit, cost, it.bebanCategory || 'beban_kehilangan', loss, code, it.notes || `Stock Opname selisih ${diff}`]
        );
      }
    }

    // 3. Update summary in session header
    await client.query(
      `UPDATE stock_opname_sessions
       SET items_with_diff = $1, total_loss_value = $2
       WHERE id = $3`,
      [withDiff, totalLoss, sessionId]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, code, sessionId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting stock opname:', error.message);
    res.status(500).json({ message: 'Gagal memproses stock opname.' });
  } finally {
    client.release();
  }
});

// -------------------------------------------------------------
// 4. STOCK MUTATIONS (KARTU STOK)
// -------------------------------------------------------------

// GET /api/inventory/mutations
router.get('/mutations', optionalToken, async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const { ingredientId, type, limit = 100 } = req.query;

    const whereConditions = ['merchant_id = $1'];
    const params = [merchantId];

    if (ingredientId) {
      params.push(ingredientId);
      whereConditions.push(`raw_material_id = $${params.length}`);
    }

    if (type) {
      params.push(type);
      whereConditions.push(`type = $${params.length}`);
    }

    params.push(Number(limit) || 100);

    const query = `
      SELECT 
        id, raw_material_id AS "ingredientId", raw_material_name AS "ingredientName",
        type, change_amount AS "changeAmount", current_stock AS "currentStock",
        unit, cost_per_unit AS "costPerUnit", beban_category AS "bebanCategory",
        beban_amount AS "bebanAmount", reference, notes, created_at AS "date"
      FROM stock_mutations
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stock mutations:', error.message);
    res.status(500).json({ message: 'Gagal mengambil riwayat mutasi stok.' });
  }
});

module.exports = router;
