# Бесплатный деплой: доступ с любого телефона

| Часть | Где | Бесплатно |
|---|---|---|
| Сайт (Next.js) | **Vercel** — проект `flight-finder` уже есть | да |
| API + фоновый worker | **Render**, один web-сервис (`RUN_WORKER=true`) | да, засыпает без запросов |
| Redis (очереди, кэш) | **Render Key Value** | да, 25 МБ |
| PostgreSQL | **Neon** | да, 0.5 ГБ, без срока |
| «Будильник» для API | **cron-job.org** | да |
| Домен | `имя.vercel.app` | да |

Всё входит через аккаунт GitHub. На всё уходит около 30 минут.

---

## Шаг 1. База данных — Neon

1. Откройте https://neon.tech → **Sign up** → **Continue with GitHub**.
2. Создайте проект: название `llb`, регион **AWS Europe Central (Frankfurt)**, Postgres по умолчанию.
3. На главной странице проекта нажмите **Connect**.
   - Выключите переключатель **Connection pooling**: нужна прямая строка, без `-pooler` в адресе.
   - Скопируйте строку вида
     `postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. Сохраните её где-нибудь у себя. В чат и в git её не отправляйте.

## Шаг 2. API и Redis — Render

1. Откройте https://render.com → **Get Started** → **GitHub**.
2. **New +** → **Blueprint** → выберите репозиторий **FlightFinder** → **Connect**.
   Render прочитает `render.yaml` и покажет два ресурса: `llb-api` и `llb-redis`.
3. Он попросит два значения:
   - `DATABASE_URL` — строка из шага 1;
   - `WEB_URL` — адрес сайта из шага 3, например `https://llb-flights.vercel.app`.
     Если имя ещё не выбрано, впишите любое — потом поменяете.
4. Нажмите **Apply**. Сборка занимает 5–10 минут. При первом запуске создаются таблицы в базе.
5. Откройте `llb-api` и скопируйте адрес сверху, например `https://llb-api.onrender.com`.
   Проверьте в браузере `https://llb-api.onrender.com/api/health`: должно быть `{"ok":true,…}`.

## Шаг 3. Сайт — Vercel

Откройте https://vercel.com → проект **flight-finder** → **Settings**.

1. **Domains** → **Add** → введите бесплатное имя, например `llb-flights.vercel.app` → **Add**.
   Если имя занято, выберите другое. Тогда в шаге 4 впишите его в `WEB_URL`.
2. **Environment Variables** → **Add**:
   - Key: `API_INTERNAL_URL`
   - Value: адрес из шага 2.5, без `/api` в конце: `https://llb-api.onrender.com`
   - Environments: **Production** и **Preview** → **Save**.
3. **Deployment Protection** → **Vercel Authentication** → **Disabled**, или **Standard Protection** (закрыты только preview).
   Иначе с чужого телефона откроется вход в Vercel вместо сайта.
4. **Deployments** → последний деплой → **⋯** → **Redeploy**.
   Адрес API подставляется при сборке, поэтому без пересборки новая переменная не заработает.

## Шаг 4. Вернуть адрес сайта в Render

Render → `llb-api` → **Environment** → `WEB_URL` = ваш адрес из шага 3.1 → **Save Changes** (сервис перезапустится).
Этот адрес нужен для ссылок в письмах и для входа через Google.

## Шаг 5. «Будильник» — cron-job.org

Бесплатный сервис Render засыпает через 15 минут без запросов. Спящий сервер не запустит утренний поиск цен,
а первый вход после сна ждёт около минуты.

1. https://cron-job.org → **Sign up** (бесплатно).
2. **Create cronjob**:
   - Title: `llb-api keep-alive`
   - URL: `https://llb-api.onrender.com/api/health`
   - Schedule: **Every 10 minutes**
   - **Create**.

Бесплатных 750 часов в месяц на Render хватает, чтобы один сервис работал круглосуточно.

## Шаг 6. Телефон

1. Откройте `https://llb-flights.vercel.app` → **Создать аккаунт**.
   Демо-пользователя `demo@example.com` в новой базе нет.
2. Добавьте сайт на главный экран:
   - **iPhone (Safari):** «Поделиться» → «На экран „Домой“».
   - **Android (Chrome):** ⋮ → «Добавить на главный экран».

## Шаг 7 (по желанию). Реальные цены

Render → `llb-api` → **Environment**:

```
INDICATIVE_PROVIDER=travelpayouts
LIVE_PROVIDER=ignav
CONTROL_PROVIDER=serpapi
TRAVELPAYOUTS_TOKEN=…
IGNAV_API_KEY=…
SERPAPI_KEY=…
```

Пока `INDICATIVE_PROVIDER=mock`, цены демонстрационные.
**Не включайте mock-источник предварительных цен вместе с реальными:** выдуманные цены попадут в результаты рядом с настоящими.

## Ограничения бесплатного варианта

- **Письма** (`EMAIL_TRANSPORT=console`) только пишутся в лог Render.
  Для настоящей отправки нужен ключ Resend и подтверждённый домен.
- **Redis на бесплатном тарифе не сохраняется** при перезапуске. Теряются только кэш и очередь текущего поиска,
  история цен лежит в Postgres.
- **Если «будильник» не работает,** первый запрос после сна API отвечает около минуты.

## Если что-то не работает

| Симптом | Причина |
|---|---|
| Сайт открывается, но вход не работает | Не задан `API_INTERNAL_URL` в Vercel, или после него не было Redeploy |
| Вместо сайта страница входа Vercel | Включена Vercel Authentication (шаг 3.3) |
| `/api/health` у Render не отвечает | Сборка ещё идёт или упала: Render → `llb-api` → **Logs** |
| Ошибка базы в логах Render | В `DATABASE_URL` строка с `-pooler` или без `?sslmode=require` |
