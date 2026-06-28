const express = require('express');
const db = require('../../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Пополнить баланс — шекели напрямую
router.post('/topup', requireAuth, async (req, res) => {
  const { amount } = req.body;
  const shekelAmount = parseInt(amount);
  if (!shekelAmount || shekelAmount < 1) return res.status(400).json({ error: 'Укажите сумму' });

  try {
    await db.query(
      `INSERT INTO payments (user_id, amount, currency, type, status, payload)
       VALUES ($1, $2, 'ILS', 'credits_purchase', 'completed', $3)`,
      [req.user.id, shekelAmount * 100, JSON.stringify({ amount: shekelAmount })]
    );

    // Добавляем шекели на баланс (credits = шекели)
    const result = await db.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING credits',
      [shekelAmount, req.user.id]
    );

    console.log(`✅ Topup: ${req.user.email} +₪${shekelAmount} → баланс: ₪${result.rows[0].credits}`);
    res.json({ success: true, credits: result.rows[0].credits });
  } catch (err) {
    console.error('Topup error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// История платежей
router.get('/history', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
