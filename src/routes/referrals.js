const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { requireAuth: auth } = require('../middleware/auth');

router.get('/my', auth, async (req, res) => {
  try {
    const user = await db.query('SELECT ref_code, credits FROM users WHERE id=$1', [req.user.id]);
    const stats = await db.query('SELECT COUNT(*) as total FROM referrals WHERE referrer_id=$1', [req.user.id]);
    const referred = await db.query(
      'SELECT u.name, r.created_at, r.bonus_credited FROM referrals r JOIN users u ON u.id=r.referred_id WHERE r.referrer_id=$1 ORDER BY r.created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ ref_code: user.rows[0]?.ref_code, credits: user.rows[0]?.credits||0, total_referrals: parseInt(stats.rows[0]?.total)||0, referrals: referred.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/apply', auth, async (req, res) => {
  const { ref_code } = req.body;
  try {
    const referrer = await db.query('SELECT id FROM users WHERE ref_code=$1', [ref_code]);
    if (!referrer.rows.length) return res.status(404).json({ error: 'Код не найден' });
    if (referrer.rows[0].id === req.user.id) return res.status(400).json({ error: 'Нельзя свой код' });
    const already = await db.query('SELECT id FROM referrals WHERE referred_id=$1', [req.user.id]);
    if (already.rows.length) return res.status(400).json({ error: 'Уже применён' });
    await db.query('INSERT INTO referrals (referrer_id, referred_id, ref_code) VALUES ($1,$2,$3)', [referrer.rows[0].id, req.user.id, ref_code]);
    await db.query('UPDATE users SET credits=credits+50 WHERE id=$1', [referrer.rows[0].id]);
    await db.query('UPDATE users SET credits=credits+20, referred_by=$1 WHERE id=$2', [referrer.rows[0].id, req.user.id]);
    await db.query('UPDATE referrals SET bonus_credited=true WHERE referred_id=$1', [req.user.id]);
    res.json({ success: true, message: '+20 кредитов начислено!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
