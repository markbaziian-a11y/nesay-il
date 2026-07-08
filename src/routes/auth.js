const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db      = require('../../config/db');
const { requireAuth } = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Загружает base64-файл в Supabase Storage (лицензия агента, фото
// профиля/лого), тем же способом, что и фото объявлений в listings.js
async function uploadBase64File(base64, fileName, emailForPath, subfolder) {
  const matches = base64.match(/^data:([A-Za-z0-9\-+/]+);base64,(.+)$/);
  if (!matches) return null;
  const mimeType = matches[1];
  const data = Buffer.from(matches[2], 'base64');
  const safeEmail = (emailForPath || 'user').replace(/[^a-z0-9]/gi, '_');
  const ext = (fileName && fileName.split('.').pop()) || (mimeType.includes('pdf') ? 'pdf' : 'jpg');
  const path = `${subfolder}/${Date.now()}_${safeEmail}.${ext}`;
  const { error } = await supabase.storage.from('photos').upload(path, data, { contentType: mimeType, upsert: true });
  if (error) { console.error(`${subfolder} upload error:`, error); return null; }
  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
  return urlData.publicUrl;
}
async function uploadLicenseFile(base64, fileName, emailForPath) {
  return uploadBase64File(base64, fileName, emailForPath, 'licenses');
}
async function uploadAvatarFile(base64, fileName, emailForPath) {
  return uploadBase64File(base64, fileName, emailForPath, 'avatars');
}

// Регистрация
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  body('phone').trim().notEmpty().withMessage('Укажите номер телефона'),
  body('role').isIn(['owner', 'agent', 'buyer']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, name, surname, phone, role, agency_data, client, agent, owner, avatarBase64, avatarFileName } = req.body;

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }

    // Доп. валидация обязательных полей под конкретную роль
    if (role === 'agent') {
      if (!agent || !agent.agencyName || !agent.workPhone || !agent.workEmail) {
        return res.status(400).json({ error: 'Заполните название агентства, рабочий телефон и email' });
      }
    }
    if (role === 'buyer') {
      if (!client || !Array.isArray(client.targetCities) || client.targetCities.length === 0) {
        return res.status(400).json({ error: 'Выберите хотя бы один целевой город' });
      }
    }

    const hash = await bcrypt.hash(password, 12);

    // Собираем JSON-данные под роль (agency_data колонка уже существует,
    // client_data/owner_data — добавляются миграцией migration_roles.sql)
    let agencyDataJson = agency_data ? JSON.stringify(agency_data) : null;
    let clientDataJson = null;
    let ownerDataJson = null;

    if (role === 'agent' && agent) {
      let licenseFileUrl = null;
      if (agent.licenseFileBase64) {
        licenseFileUrl = await uploadLicenseFile(agent.licenseFileBase64, agent.licenseFileName, email);
      }
      agencyDataJson = JSON.stringify({
        agencyName: agent.agencyName,
        agentType: agent.agentType || 'agency',
        workPhone: agent.workPhone,
        workEmail: agent.workEmail,
        licenseNumber: agent.licenseNumber || null,
        licenseFileUrl
      });
    }

    if (role === 'buyer' && client) {
      clientDataJson = JSON.stringify({
        interests: client.interests || [],
        preferredMessenger: client.preferredMessenger || null,
        messengerHandle: client.messengerHandle || null,
        budgetMin: client.budgetMin ? parseInt(client.budgetMin) : null,
        budgetMax: client.budgetMax ? parseInt(client.budgetMax) : null
      });
    }

    if (role === 'owner' && owner) {
      ownerDataJson = JSON.stringify({
        city: owner.city || null,
        worksWithAgents: owner.worksWithAgents !== false
      });
    }

    // Фото профиля (лицо для клиента/собственника/частного риелтора,
    // логотип для агентства)
    let avatarUrl = null;
    if (avatarBase64) {
      avatarUrl = await uploadAvatarFile(avatarBase64, avatarFileName, email);
    }

    const result = await db.query(
      `INSERT INTO users (email, password_hash, name, surname, phone, role, agency_data, client_data, owner_data, avatar_url, credits, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, email, name, role, credits`,
      [email, hash, name, surname || null, phone, role,
       agencyDataJson, clientDataJson, ownerDataJson, avatarUrl,
       role === 'agent' ? 3 : 0,
       role === 'agent' ? false : true] // агент — не верифицирован до проверки модератором
    );

    const user = result.rows[0];

    // Целевые города клиента — пытаемся сопоставить названия с cities.name.
    // Несовпавшие названия просто пропускаем, не блокируя регистрацию.
    if (role === 'buyer' && client && Array.isArray(client.targetCities) && client.targetCities.length) {
      try {
        await db.query(
          `INSERT INTO client_target_cities (user_id, city_id)
           SELECT $1, id FROM cities WHERE name = ANY($2::text[])
           ON CONFLICT DO NOTHING`,
          [user.id, client.targetCities]
        );
      } catch (e) {
        console.warn('client_target_cities insert warning:', e.message);
      }
    }

    const refCode = 'NSY' + Math.random().toString(36).substr(2,6).toUpperCase();
    await db.query('UPDATE users SET ref_code=$1 WHERE id=$2', [refCode, user.id]);
    user.ref_code = refCode;
    const refFrom = req.body.ref_code;
    console.log('REGISTER ref_code:', refFrom);
    if(refFrom){
      try{
        const referrer=await db.query('SELECT id FROM users WHERE ref_code=$1',[refFrom]);
        if(referrer.rows.length && referrer.rows[0].id!==user.id){
          await db.query('INSERT INTO referrals (referrer_id,referred_id,ref_code) VALUES ($1,$2,$3)',[referrer.rows[0].id,user.id,refFrom]);
          await db.query('UPDATE users SET credits=credits+50 WHERE id=$1',[referrer.rows[0].id]);
          await db.query('UPDATE users SET credits=credits+20,referred_by=$1 WHERE id=$2',[referrer.rows[0].id,user.id]);
          await db.query('UPDATE referrals SET bonus_credited=true WHERE referred_id=$1',[user.id]);
          console.log('referral recorded!');
        }
      }catch(e){console.log('ref error',e.message);}
    }
    res.status(201).json({ token: makeToken(user), user });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;

  try {
    const result = await db.query(
      'SELECT id, email, name, role, credits, verified, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный email или пароль' });

    delete user.password_hash;
    console.log('LOGIN: user credits from DB:', user.credits, 'email:', user.email);
    res.json({ token: makeToken(user), user });

  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить данные текущего пользователя
router.get('/me', requireAuth, async (req, res) => {
  try {
    console.log('ME: looking up user id:', req.user.id);
    const result = await db.query(
      'SELECT id, email, name, surname, phone, role, credits, verified, agency_data, client_data, owner_data, avatar_url FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    console.log('ME: found credits:', result.rows[0].credits);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Запрос на сброс пароля — генерируем токен, "отправляем" ссылку.
// ВАЖНО: реальная отправка письма требует почтового провайдера
// (например Resend/SendGrid) — сейчас ссылка только логируется
// в консоль сервера (видно в Railway → Deploy Logs), пока не
// подключён провайдер. Ответ одинаковый независимо от того,
// существует ли email в базе — так безопаснее.
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const { email } = req.body;
  try {
    const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length) {
      const resetToken = require('crypto').randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час
      await db.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [resetToken, expiresAt, result.rows[0].id]
      );
      const resetLink = `${process.env.FRONTEND_URL || ''}/?reset_token=${resetToken}`;
      console.log('🔑 Ссылка для сброса пароля (пока без email-провайдера):', resetLink);
      // TODO: подключить реальную отправку письма через email-провайдера
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.json({ success: true }); // не раскрываем ошибку клиенту
  }
});

// Подтверждение сброса — пароль меняется по токену из письма
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { token, password } = req.body;
  try {
    const result = await db.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Ссылка недействительна или устарела' });
    }
    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, result.rows[0].id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
