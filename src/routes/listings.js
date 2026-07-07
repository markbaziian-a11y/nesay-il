const express = require('express');
const db = require('../../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Получить все объявления
router.get('/', optionalAuth, async (req, res) => {
  const { deal_type, city_id, sort = 'new', page = 1, limit = 50 } = req.query;
  const conditions = ["l.status = 'active'"];
  const params = [];
  let p = 1;
  if (deal_type) { conditions.push(`l.deal_type = $${p++}`); params.push(deal_type); }
  if (city_id)   { conditions.push(`l.city_id = $${p++}`);   params.push(parseInt(city_id)); }
  const where = conditions.join(' AND ');
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const orderBy = sort === 'price_asc' ? 'l.promoted DESC, l.price ASC'
                : sort === 'price_desc' ? 'l.promoted DESC, l.price DESC'
                : 'l.promoted DESC, l.created_at DESC';
  try {
    const rows = await db.query(`
      SELECT l.*, c.name AS city_name,
        u.name AS agent_name, u.verified AS agent_verified, u.role AS agent_role,
        (SELECT url FROM listing_photos WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) AS cover_photo,
        (SELECT json_agg(url ORDER BY sort_order) FROM listing_photos WHERE listing_id = l.id) AS all_photos,
        (SELECT COUNT(*) FROM favorites WHERE listing_id = l.id) AS fav_count
      FROM listings l
      JOIN cities c ON c.id = l.city_id
      JOIN users  u ON u.id = l.user_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${p++} OFFSET $${p++}
    `, [...params, parseInt(limit), offset]);
    res.json({ listings: rows.rows, total: rows.rows.length });
  } catch (err) {
    console.error('Listings fetch error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Мои объявления
router.get('/my/all', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT l.*, c.name AS city_name,
        (SELECT url FROM listing_photos WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) AS cover_photo,
        (SELECT json_agg(url ORDER BY sort_order) FROM listing_photos WHERE listing_id = l.id) AS all_photos,
        (SELECT COUNT(*) FROM favorites WHERE listing_id = l.id) AS fav_count
      FROM listings l
      JOIN cities c ON c.id = l.city_id
      WHERE l.user_id = $1 AND l.status != 'removed'
      ORDER BY l.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создать объявление
router.post('/', requireAuth, async (req, res) => {
  const { deal_type, property_type, city_id, street, house_number, lat, lng, price, rooms, sqm, description } = req.body;
  if (!deal_type || !price) return res.status(400).json({ error: 'Укажите тип сделки и цену' });
  if (req.user.role === 'buyer') return res.status(403).json({ error: 'Покупатели не могут публиковать' });

  try {
    const userResult = await db.query('SELECT credits, verified FROM users WHERE id = $1', [req.user.id]);
    const credits = userResult.rows[0]?.credits || 0;
    if (req.user.role === 'agent' && !userResult.rows[0]?.verified) {
      return res.status(403).json({ error: 'Ваш профиль ещё проверяется модератором. Публикация станет доступна после верификации.' });
    }
    if (credits < 100) return res.status(402).json({ error: 'Недостаточно средств. Минимум ₪100 для публикации' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        INSERT INTO listings (user_id, city_id, deal_type, property_type, street, house_number, lat, lng, price, rooms, sqm, description)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [
        req.user.id, parseInt(city_id) || 1, deal_type, property_type || 'apartment',
        street || null, house_number || null,
        parseFloat(lat) || null, parseFloat(lng) || null,
        parseInt(price), parseFloat(rooms) || 1,
        sqm ? parseInt(sqm) : null,
        JSON.stringify(description || {})
      ]);
      // Снимаем 100 шекелей за публикацию
      await client.query('UPDATE users SET credits = credits - 100 WHERE id = $1', [req.user.id]);
      await client.query('COMMIT');
      console.log('✅ Listing created:', result.rows[0].id);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create listing error:', err);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// Загрузить фото
router.post('/:id/photos', requireAuth, async (req, res) => {
  const { photos } = req.body;
  if (!photos || !photos.length) return res.status(400).json({ error: 'Нет фото' });
  const check = await db.query('SELECT id FROM listings WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!check.rows.length) return res.status(404).json({ error: 'Не найдено' });

  try {
    const urls = [];
    for (let i = 0; i < photos.length; i++) {
      const base64 = photos[i];
      const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches) continue;
      const mimeType = matches[1];
      const data = Buffer.from(matches[2], 'base64');
      const ext = mimeType.includes('png') ? 'png' : 'jpg';
      const fileName = `${req.params.id}/${Date.now()}_${i}.${ext}`;
      const { error } = await supabase.storage.from('photos').upload(fileName, data, { contentType: mimeType, upsert: true });
      if (error) { console.error('Upload error:', error); continue; }
      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(fileName);
      urls.push(urlData.publicUrl);
      await db.query('INSERT INTO listing_photos (listing_id, url, sort_order) VALUES ($1, $2, $3)', [req.params.id, urlData.publicUrl, i]);
    }
    res.json({ urls });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки фото' });
  }
});

// Увеличить просмотры
router.post('/:id/view', async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE listings SET views = views + 1 WHERE id = $1 RETURNING views',
      [req.params.id]
    );
    res.json({ views: result.rows[0]?.views || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Лайк / снять лайк
router.post('/:id/favorite', requireAuth, async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT * FROM favorites WHERE user_id = $1 AND listing_id = $2',
      [req.user.id, req.params.id]
    );
    if (existing.rows.length) {
      await db.query('DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2', [req.user.id, req.params.id]);
      const count = await db.query('SELECT COUNT(*) FROM favorites WHERE listing_id = $1', [req.params.id]);
      res.json({ liked: false, count: parseInt(count.rows[0].count) });
    } else {
      await db.query('INSERT INTO favorites (user_id, listing_id) VALUES ($1, $2)', [req.user.id, req.params.id]);
      const count = await db.query('SELECT COUNT(*) FROM favorites WHERE listing_id = $1', [req.params.id]);
      res.json({ liked: true, count: parseInt(count.rows[0].count) });
    }
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Удалить объявление
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      "UPDATE listings SET status = 'removed' WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Продвинуть
router.post('/:id/boost', requireAuth, async (req, res) => {
  try {
    await db.query(`UPDATE listings SET promoted = true, promo_until = NOW() + INTERVAL '24 hours' WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
