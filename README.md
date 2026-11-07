# ✈️ Flight Price Tracker (FlightFinder)

Веб-сервис автоматического мониторинга цен на авиабилеты: пользователь один раз настраивает
поездку, система каждое утро проверяет цены, хранит историю, считает тренды и присылает сводку.

> *Configure once. Track automatically. Buy at the right price.*

## Структура

```
FlightFinder/
├─ apps/api/             NestJS + Prisma + BullMQ (TypeScript)
│  ├─ prisma/            схема БД, миграции, seed
│  ├─ src/
│  │  ├─ auth/           регистрация, вход, JWT в httpOnly-cookie, Google OAuth
│  │  ├─ trackers/       CRUD мониторингов, пауза, результаты, история, тренды
│  │  ├─ search/         Flight Search Engine: даты, планировщик запросов, кэш, очередь
│  │  ├─ providers/      FlightProvider + адаптеры: mock, travelpayouts, duffel, skyscanner
│  │  ├─ analysis/       анализ цен (изменение, минимумы 7/30/all, новые минимумы, цель)
│  │  ├─ notifications/  ежедневная сводка, алерты, Email (Resend) и WhatsApp Cloud API
│  │  ├─ scheduler/      ежедневный планировщик (в процессе worker)
│  │  ├─ airports/       справочник стран и аэропортов (IATA)
│  │  ├─ main.ts         HTTP API
│  │  └─ worker.ts       фоновый процесс: планировщик + обработчики очередей
│  └─ test/              тесты по критериям приёмки (раздел 15 ТЗ)
├─ apps/web/             Next.js 14 (App Router) + Recharts, RU/EN, адаптивная вёрстка
├─ docs/                 архитектура и оценка поставщиков авиаданных
└─ docker-compose.yml    postgres, redis, api, worker, web
```

## Быстрый старт (Docker)

```bash
cp .env.example .env
docker compose up --build
```

Откройте http://localhost:3000. По умолчанию работает **mock-поставщик** (демо-цены, не настоящие).

## Локальная разработка

Нужны Node.js 20+, PostgreSQL 14+ и Redis 6+ (можно поднять только их: `docker compose up postgres redis`).

```bash
npm install
cp .env.example .env
npm run db:migrate          # создать схему БД
npm run db:seed             # демо-пользователь demo@example.com / demo12345
npm run dev:api             # API  → http://localhost:4000/api
npm run dev:worker          # планировщик + очереди
npm run dev:web             # сайт → http://localhost:3000
```

Заполнить демо-историю цен за N дней (только mock, **удаляет** текущую историю активных мониторингов):

```bash
npm run demo:history -w apps/api -- 21
```

Тесты:

```bash
npm test
```

## Как это работает

1. **Планировщик** (worker, каждые 5 минут) находит пользователей, у которых до времени отчёта
   (по умолчанию 07:00 Asia/Jerusalem) остался час, и ставит в очередь один пакет поиска.
2. **Поисковый движок** для каждого мониторинга строит комбинации дат (10.05 +2 / 20.05 −2 → 9)
   × все аэропорты страны и выполняет **двухэтапный поиск**:
   - этап 1 — предварительные цены (indicative) по всем комбинациям;
   - этап 2 — актуальная проверка (live) только top-N самых дешёвых + по одной комбинации
     на каждый аэропорт (контроль неполноты кэша).
   Одинаковые запросы разных пользователей **группируются** и **кэшируются** в Redis.
3. Результаты фильтруются (пересадки — **в каждую сторону**, self-transfer исключены),
   сохраняются (`FlightOffer`, `PriceSnapshot`) и анализируются.
4. Когда поиски пользователя завершены (или прошло 45 мин после времени отчёта) — отправляется
   **одно письмо** со сводкой по всем активным мониторингам. При значительном снижении цены
   или достижении цели — дополнительный алерт.

### Важные правила данных
- Статусы запуска: `SUCCESS`, `PARTIAL`, `NO_RESULTS` (поставщик ответил, рейсов нет) и `FAILED`
  (поставщик недоступен). При `FAILED` пользователю **не** сообщается ни «цена выросла», ни «рейсов нет».
- Каждая цена имеет статус `LIVE` (подтверждена) или `INDICATIVE` (предварительная) и время проверки;
  предварительные цены явно помечаются в интерфейсе и письмах.
- Сравниваются два показателя: изменение самого дешёвого варианта по стране и изменение
  **того же** маршрута/дат. Смена города (Милан → Рим) показывается отдельно.
- Отсутствующие у поставщика функции бросают `ProviderNotSupportedError`, а не имитируются.
- Circuit breaker: при серии отказов поставщика оставшиеся запросы прекращаются.

## Подключение реальных источников

В `.env`:

| Переменная | Значения |
|---|---|
| `INDICATIVE_PROVIDER` | `mock` \| `travelpayouts` |
| `LIVE_PROVIDER` | `mock` \| `duffel` |
| `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER` | Aviasales Data API |
| `DUFFEL_ACCESS_TOKEN` | Duffel Air API |

Skyscanner — заготовка адаптера до получения партнёрского доступа. Перед выбором поставщика
пройдите чек-лист в [docs/PROVIDER_EVALUATION.md](docs/PROVIDER_EVALUATION.md).

## Уведомления

- Email: `EMAIL_TRANSPORT=console` (письма в лог worker'а) или `resend` + `RESEND_API_KEY`.
- WhatsApp (версия 1.1): `WHATSAPP_ENABLED=true`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`
  и одобренный Meta шаблон `WHATSAPP_TEMPLATE_NAME` с одной переменной `{{1}}`. Отправка — только
  при указанном телефоне и явном согласии пользователя.

## REST API

Все пути с префиксом `/api`. Авторизация — httpOnly-cookie `ff_token` (или `Authorization: Bearer`).

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | авторизация |
| GET | `/auth/me`, `/auth/google` | профиль, вход через Google |
| GET/POST | `/trackers` | список / создание (сразу запускает первую проверку) |
| GET/PUT/DELETE | `/trackers/:id` | мониторинг |
| POST | `/trackers/:id/pause`, `/trackers/:id/resume` | пауза |
| GET | `/trackers/:id/results` | самые дешёвые варианты последней проверки |
| GET | `/trackers/:id/history?range=7\|30\|all` | точки графика + история запусков |
| GET | `/trackers/:id/trends` | анализ последней проверки |
| POST | `/trackers/:id/search` | внеочередной поиск (ограничение частоты) |
| GET/PUT | `/notifications/settings` | настройки уведомлений |
| POST | `/notifications/test` | тестовый отчёт |
| GET/PUT | `/user/profile` | профиль, телефон, согласие на WhatsApp |
| DELETE | `/user/account` | удаление аккаунта и всех данных |
| GET | `/airports/countries` | справочник стран/аэропортов |
| GET | `/health`, `/admin/status` | здоровье, мониторинг (для `ADMIN_EMAILS`) |

## Критерии приёмки (раздел 15 ТЗ)

| № | Проверка | Где |
|---|---|---|
| 1 | 9 комбинаций дат | `test/acceptance.spec.ts` |
| 2 | Несколько аэропортов страны | тест + справочник |
| 3 | Пересадки в каждую сторону | тест `filterOffers` |
| 4 | История после нескольких запусков | экран мониторинга, `demo:history` |
| 5 | ₪1000 → ₪900 = −10% | тест `analyzePrices` |
| 6 | Одно письмо со всеми мониторингами | тест `buildDailyReport`, `NotificationService` |
| 7 | Пауза останавливает поиск и уведомления | фильтр `status: ACTIVE` в планировщике/движке/отчёте |
| 8 | Сбой API ≠ «цена выросла»/«рейсов нет» | тест + статус `FAILED` |
| 9 | Изоляция пользователей | все запросы с `userId` (чужой id → 404) |
| 10 | Время проверки и статус достоверности | `observedAt`, `priceStatus` |

## Справочник аэропортов

`apps/api/src/airports/data/countries.json` содержит ~150 аэропортов 38 популярных стран.
Для полного справочника его можно сгенерировать из открытого набора OurAirports
(аэропорты типа large/medium с регулярными рейсами и кодом IATA).

## Ограничение

Система показывает минимальную цену среди доступных ей предложений, но не гарантирует
абсолютную минимальную цену на всём рынке.
