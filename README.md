# Nesay.il Backend — Пошаговый гайд по запуску

## Шаг 1: Supabase (база данных в облаке — бесплатно)

1. Зайди на https://supabase.com → Sign Up
2. New Project → имя: `nesay`, придумай пароль БД, регион: Frankfurt (ближайший к Израилю)
3. Подожди ~2 минуты пока создаётся проект
4. Зайди: Settings → Database → Connection string (URI)
   Скопируй строку вида: `postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres`

## Шаг 2: Создать таблицы

1. В Supabase: SQL Editor → New Query
2. Вставь весь код из файла `nesay_schema.sql`
3. Нажми Run (зелёная кнопка)
4. Слева в Table Editor появятся таблицы: users, listings, cities...

## Шаг 3: Node.js на компьютере

```bash
# Проверить что Node.js установлен (нужна версия 18+)
node --version

# Если нет — скачать с https://nodejs.org (LTS версия)
```

## Шаг 4: Установить зависимости

```bash
# Открой терминал в папке nesay-backend/
cd nesay-backend
npm install
```

## Шаг 5: Настроить .env

```bash
# Скопировать шаблон
cp .env.example .env
```

Открой `.env` в любом редакторе и заполни:
```
DATABASE_URL=postgresql://postgres:ТВОЙпароль@db.ТВОЙПРОЕКТ.supabase.co:5432/postgres
JWT_SECRET=любая_длинная_случайная_строка_минимум_32_символа
PORT=3001
FRONTEND_URL=http://localhost:5500
```

## Шаг 6: Запустить сервер

```bash
npm run dev
```

Ты должен увидеть:
```
🚀 Nesay API running on http://localhost:3001
✅ PostgreSQL connected at 2024-01-15T...
```

## Шаг 7: Проверить что всё работает

Открой браузер: http://localhost:3001/api/health
Должно вернуть: `{"status":"ok","time":"..."}`

Проверить города: http://localhost:3001/api/cities

---

## API Endpoints — полный список

### Авторизация
| Метод | URL | Описание | Авторизация |
|-------|-----|----------|-------------|
| POST | /api/auth/register | Регистрация | Нет |
| POST | /api/auth/login | Вход | Нет |
| GET  | /api/auth/me | Текущий пользователь | JWT |

### Объявления
| Метод | URL | Описание | Авторизация |
|-------|-----|----------|-------------|
| GET  | /api/listings | Список с фильтрами | Нет |
| GET  | /api/listings/:id | Одно объявление | Нет |
| POST | /api/listings | Создать | JWT (owner/agent) |
| DELETE | /api/listings/:id | Удалить | JWT (владелец) |
| POST | /api/listings/:id/boost | Продвинуть на 24ч | JWT |
| GET  | /api/listings/my/all | Мои объявления | JWT |

### Справочники
| Метод | URL | Описание |
|-------|-----|----------|
| GET  | /api/cities | Список городов |
| GET  | /api/health | Статус сервера |

---

## Параметры фильтрации /api/listings

```
GET /api/listings?deal_type=rent&city_id=1&rooms_min=2&price_max=8000&sort=price_asc&page=1&limit=20
```

---

## Как подключить фронтенд (nesay_v7.html)

В JS фронтенда добавить константу:
```js
const API = 'http://localhost:3001/api';
```

Пример: регистрация
```js
const res = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, name, role })
});
const { token, user } = await res.json();
localStorage.setItem('nesay_token', token);
```

Пример: получить объявления
```js
const res = await fetch(`${API}/listings?deal_type=rent&city_id=3`);
const { listings, total } = await res.json();
```

Пример: защищённый запрос (с токеном)
```js
const token = localStorage.getItem('nesay_token');
const res = await fetch(`${API}/listings/my/all`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

---

## Следующие шаги (этап 2)

1. **Фото** — Supabase Storage (бесплатно 1ГБ): загрузка через `/api/listings/:id/photos`
2. **Чат** — WebSocket (socket.io) для real-time сообщений
3. **Оплата** — интеграция Tranzila (израильский платёжный шлюз)
4. **Деплой** — Railway.app или Render.com (бесплатный хостинг Node.js)
