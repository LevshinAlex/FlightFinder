'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Locale = 'ru' | 'en';

const dict = {
  en: {
    appName: 'Flight Price Tracker',
    tagline: 'Configure once. Track automatically. Buy at the right price.',
    login: 'Log in', register: 'Create account', logout: 'Log out', email: 'Email', password: 'Password',
    name: 'Name (optional)', haveAccount: 'Already have an account?', noAccount: 'No account yet?', google: 'Continue with Google',
    passwordHint: 'At least 8 characters',
    dashboard: 'My Flight Trackers', addTracker: '+ Add New Tracker', settings: 'Settings',
    direction: 'Direction', dates: 'Dates', minPrice: 'Min price', trend: 'Trend', status: 'Status', actions: 'Actions',
    view: 'View', edit: 'Edit', pause: 'Pause', resume: 'Resume', delete: 'Delete', confirmDelete: 'Delete this tracker and its whole price history?',
    active: 'Active', paused: 'Paused', noTrackers: 'No trackers yet. Create the first one – we will check prices every morning.',
    lastCheck: 'Last check', never: 'never', searching: 'Searching…', checkFailed: 'Check failed',
    // form
    newTracker: 'New tracker', editTracker: 'Edit tracker', trackerName: 'Tracker name (optional)',
    originCountry: 'Departure country', originAirport: 'Departure airport', destCountry: 'Destination country',
    destAirports: 'Destination airports', allAirports: 'All airports of the country', chooseCountry: 'Choose a country…',
    searchCountry: 'Search country…',
    departureDate: 'Departure date', returnDate: 'Return date', depFlex: 'Departure flexibility', retFlex: 'Return flexibility',
    exact: 'Exact date', maxStops: 'Max stops (each way)', direct: 'Direct only', upTo1: 'Up to 1 stop', upTo2: 'Up to 2 stops',
    adults: 'Passengers (adults)', cabin: 'Cabin class', currency: 'Currency', targetPrice: 'Target price (optional)',
    threshold: 'Ignore changes below, %', combos: (n: number) => `${n} date combinations will be checked`,
    save: 'Save & Start Monitoring', saveChanges: 'Save changes', cancel: 'Cancel',
    ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business', FIRST: 'First',
    // details
    cheapest: 'Cheapest Flights', destination: 'Destination', airline: 'Airline', stops: 'Stops', price: 'Price',
    viewFlight: 'View Flight', priceHistory: 'Price History', d7: '7 Days', d30: '30 Days', all: 'All Time',
    dailyHistory: 'Daily Search History', checkedAt: 'Checked', searchNow: 'Search now', searchQueued: 'Search started – results will appear in a moment.',
    live: 'Confirmed', indicative: 'Approximate', indicativeHint: 'Approximate cached price, not confirmed by a live check',
    baggage: 'Baggage', bagIncluded: 'included', bagExtra: (p: string) => `+${p}`, noOffers: 'No flights matching your criteria were found.',
    failedRun: 'The flight data provider was unavailable during the last check. No price change is reported.',
    notYet: 'No results yet – the first check is running.',
    current: 'Current minimum', previous: 'Previous', change: 'Change', min7: '7-day min', min30: '30-day min', histMin: 'Historical min',
    newLow: '⭐ New historical low', target: '🔥 Target price reached',
    routeChanged: (a: string, b: string) => `Cheapest destination changed: ${a} → ${b}. This is a different flight, not the same ticket getting cheaper.`,
    sameRoute: (p: string) => `Same flight & dates vs previous check: ${p}`,
    leaveConfirm: (t: string) => `Price was last checked ${t}. Prices may have changed. Continue to the provider?`,
    out: 'out', back: 'back', combinationsChecked: 'combinations', trigger: 'Trigger',
    SUCCESS: 'Success', PARTIAL: 'Partial', NO_RESULTS: 'No results', FAILED: 'Failed', RUNNING: 'Running', QUEUED: 'Queued',
    SCHEDULED: 'Daily', MANUAL: 'Manual', INITIAL: 'Initial',
    PRICE_DROPPED: 'Price dropped', PRICE_INCREASED: 'Price increased', NO_SIGNIFICANT_CHANGE: 'No significant change', FIRST_CHECK: 'First check', NOT_COMPARABLE: 'Not comparable',
    disclaimer: 'The service shows the lowest price among offers available to it and does not guarantee the absolute lowest market price.',
    // settings
    notifications: 'Notifications', emailCh: 'Email', whatsappCh: 'WhatsApp', dailySummary: 'Daily summary report',
    dropAlert: 'Extra alert on significant price drop', dropPct: 'Significant drop, %', reportTime: 'Report time', timezone: 'Time zone',
    sendTest: 'Send test report', testSent: 'Test report sent', saved: 'Saved', profile: 'Profile', phone: 'WhatsApp phone (E.164, e.g. +972501234567)',
    waConsent: 'I agree to receive daily flight price messages on WhatsApp', waNeedsConsent: 'WhatsApp requires a phone number and your consent',
    language: 'Interface language', deleteAccount: 'Delete account and all data', confirmDeleteAccount: 'This permanently deletes your account, trackers and history. Continue?',
    recentNotifications: 'Recent notifications',
    // shell & dashboard
    brand: 'LLB', brandSub: 'Flight ticket search', workspace: 'Workspace', overview: 'Overview', trackersNav: 'Trackers',
    serviceActive: 'Service active', menu: 'Menu', close: 'Close', account: 'Account', more: 'More actions',
    dreamTitle: 'Dream about trips', dreamText: 'We watch prices every day so you don’t miss a good fare.',
    pageSub: 'All your routes and the best prices found — in one place.',
    heroKicker: 'Smart flight search', heroTitle1: 'You plan the trip.', heroTitle2: 'We track the prices.',
    heroText: 'Daily checks of flights and good deals.',
    statTotal: 'Total trackers', statTotalSub: 'Routes under watch', statActive: 'Active', statActiveSub: 'Checked every day',
    statLowest: 'Lowest price', statLowestSub: 'Across all routes', statLowestSubCur: (c: string) => `Across routes in ${c}`,
    statUpdate: 'Updates', daily: 'Daily', statUpdateSub: 'Morning search', statUpdateSubAt: (h: string) => `Morning search at ${h}`,
    tracked: 'Tracked routes', trackedSub: 'Lowest round-trip price for all passengers',
    searchDirection: 'Search route', allStatuses: 'All statuses', tripDates: 'Trip dates', check: 'Check',
    lastSearch: 'Last search', roundTrip: 'Round trip', allAirportsShort: 'All airports', notEnoughData: 'Not enough data',
    perPax: (n: number) => (n === 1 ? 'per passenger' : `for ${n} passengers`),
    lastResults: 'Results of the last check', noMatches: 'Nothing matches the filter.', confirmDeleteShort: 'Delete with history?',
    directionsCount: (n: number) => `${n} ${n === 1 ? 'route' : 'routes'}`,
    // notifications page
    notificationsSub: 'Daily reports and price alerts we have sent you.', notificationSettings: 'Notification settings',
    noNotifications: 'No notifications yet. The first daily report arrives after the morning check.',
    when: 'When', kind: 'Type', channel: 'Channel',
    KIND_DAILY_SUMMARY: 'Daily report', KIND_PRICE_DROP: 'Price drop', KIND_TEST: 'Test',
    NS_SENT: 'Sent', NS_FAILED: 'Failed', NS_SKIPPED: 'Skipped',
  },
  ru: {
    appName: 'Flight Price Tracker',
    tagline: 'Настройте один раз. Отслеживайте автоматически. Покупайте по правильной цене.',
    login: 'Войти', register: 'Создать аккаунт', logout: 'Выйти', email: 'Email', password: 'Пароль',
    name: 'Имя (необязательно)', haveAccount: 'Уже есть аккаунт?', noAccount: 'Ещё нет аккаунта?', google: 'Войти через Google',
    passwordHint: 'Не менее 8 символов',
    dashboard: 'Мои мониторинги', addTracker: '+ Новый мониторинг', settings: 'Настройки',
    direction: 'Направление', dates: 'Даты', minPrice: 'Мин. цена', trend: 'Тренд', status: 'Статус', actions: 'Действия',
    view: 'Открыть', edit: 'Изменить', pause: 'Пауза', resume: 'Возобновить', delete: 'Удалить', confirmDelete: 'Удалить мониторинг и всю историю цен?',
    active: 'Активен', paused: 'Приостановлен', noTrackers: 'Пока нет мониторингов. Создайте первый — мы будем проверять цены каждое утро.',
    lastCheck: 'Последняя проверка', never: 'ещё не было', searching: 'Идёт поиск…', checkFailed: 'Ошибка проверки',
    newTracker: 'Новый мониторинг', editTracker: 'Изменить мониторинг', trackerName: 'Название (необязательно)',
    originCountry: 'Страна вылета', originAirport: 'Аэропорт вылета', destCountry: 'Страна назначения',
    destAirports: 'Аэропорты назначения', allAirports: 'Все аэропорты страны', chooseCountry: 'Выберите страну…',
    searchCountry: 'Поиск страны…',
    departureDate: 'Дата вылета', returnDate: 'Дата возвращения', depFlex: 'Гибкость вылета', retFlex: 'Гибкость возвращения',
    exact: 'Точная дата', maxStops: 'Макс. пересадок (в каждую сторону)', direct: 'Только прямые', upTo1: 'Не более 1', upTo2: 'Не более 2',
    adults: 'Пассажиры (взрослые)', cabin: 'Класс', currency: 'Валюта', targetPrice: 'Желаемая цена (необязательно)',
    threshold: 'Игнорировать изменения менее, %', combos: (n: number) => `Будет проверено комбинаций дат: ${n}`,
    save: 'Сохранить и начать мониторинг', saveChanges: 'Сохранить', cancel: 'Отмена',
    ECONOMY: 'Эконом', PREMIUM_ECONOMY: 'Премиум-эконом', BUSINESS: 'Бизнес', FIRST: 'Первый',
    cheapest: 'Самые дешёвые рейсы', destination: 'Город', airline: 'Авиакомпания', stops: 'Пересадки', price: 'Цена',
    viewFlight: 'Смотреть рейс', priceHistory: 'История цен', d7: '7 дней', d30: '30 дней', all: 'Всё время',
    dailyHistory: 'История ежедневных проверок', checkedAt: 'Проверено', searchNow: 'Проверить сейчас', searchQueued: 'Поиск запущен — результаты появятся через несколько секунд.',
    live: 'Подтверждена', indicative: 'Предварительная', indicativeHint: 'Предварительная цена из кэша, не подтверждена актуальной проверкой',
    baggage: 'Багаж', bagIncluded: 'включён', bagExtra: (p: string) => `+${p}`, noOffers: 'Рейсов, подходящих под условия, не найдено.',
    failedRun: 'Во время последней проверки поставщик авиаданных был недоступен. Изменение цены не сообщается.',
    notYet: 'Результатов пока нет — идёт первая проверка.',
    current: 'Текущий минимум', previous: 'Предыдущая', change: 'Изменение', min7: 'Мин. за 7 дней', min30: 'Мин. за 30 дней', histMin: 'Исторический мин.',
    newLow: '⭐ Новый исторический минимум', target: '🔥 Достигнута желаемая цена',
    routeChanged: (a: string, b: string) => `Самое дешёвое направление сменилось: ${a} → ${b}. Это другой рейс, а не подешевевший тот же билет.`,
    sameRoute: (p: string) => `Тот же рейс и даты по сравнению с прошлой проверкой: ${p}`,
    leaveConfirm: (t: string) => `Цена проверена ${t}. Она могла измениться. Перейти на сайт поставщика?`,
    out: 'туда', back: 'обратно', combinationsChecked: 'комбинаций', trigger: 'Запуск',
    SUCCESS: 'Успешно', PARTIAL: 'Частично', NO_RESULTS: 'Нет рейсов', FAILED: 'Ошибка API', RUNNING: 'Выполняется', QUEUED: 'В очереди',
    SCHEDULED: 'Ежедневный', MANUAL: 'Вручную', INITIAL: 'Первый',
    PRICE_DROPPED: 'Цена снизилась', PRICE_INCREASED: 'Цена выросла', NO_SIGNIFICANT_CHANGE: 'Без изменений', FIRST_CHECK: 'Первая проверка', NOT_COMPARABLE: 'Нет сравнения',
    disclaimer: 'Сервис показывает минимальную цену среди доступных ему предложений и не гарантирует абсолютный минимум на рынке.',
    notifications: 'Уведомления', emailCh: 'Email', whatsappCh: 'WhatsApp', dailySummary: 'Ежедневный отчёт',
    dropAlert: 'Доп. уведомление при значительном снижении цены', dropPct: 'Значительное снижение, %', reportTime: 'Время отчёта', timezone: 'Часовой пояс',
    sendTest: 'Отправить тестовый отчёт', testSent: 'Тестовый отчёт отправлен', saved: 'Сохранено', profile: 'Профиль', phone: 'Телефон WhatsApp (E.164, напр. +972501234567)',
    waConsent: 'Я согласен получать ежедневные сообщения о ценах в WhatsApp', waNeedsConsent: 'Для WhatsApp нужны номер телефона и согласие',
    language: 'Язык интерфейса', deleteAccount: 'Удалить аккаунт и все данные', confirmDeleteAccount: 'Аккаунт, мониторинги и история будут удалены безвозвратно. Продолжить?',
    recentNotifications: 'Последние уведомления',
    brand: 'LLB', brandSub: 'Поиск авиа-билетов', workspace: 'Рабочая область', overview: 'Обзор', trackersNav: 'Мониторинги',
    serviceActive: 'Сервис активен', menu: 'Меню', close: 'Закрыть', account: 'Аккаунт', more: 'Ещё действия',
    dreamTitle: 'Мечтайте о поездках', dreamText: 'Мы следим за ценами каждый день, чтобы вы не пропустили выгодный билет.',
    pageSub: 'Все ваши направления и лучшие найденные цены — в одном месте.',
    heroKicker: 'Умный поиск авиабилетов', heroTitle1: 'Вы планируете поездку.', heroTitle2: 'Мы отслеживаем цены.',
    heroText: 'Ежедневная проверка рейсов и выгодных предложений.',
    statTotal: 'Всего мониторингов', statTotalSub: 'Направления под контролем', statActive: 'Активных', statActiveSub: 'Ежедневно проверяются',
    statLowest: 'Самая низкая цена', statLowestSub: 'По всем направлениям', statLowestSubCur: (c: string) => `По направлениям в ${c}`,
    statUpdate: 'Обновление', daily: 'Ежедневно', statUpdateSub: 'Утренний поиск', statUpdateSubAt: (h: string) => `Утренний поиск в ${h}`,
    tracked: 'Отслеживаемые направления', trackedSub: 'Минимальная цена туда-обратно за всех пассажиров',
    searchDirection: 'Поиск направления', allStatuses: 'Все статусы', tripDates: 'Даты поездки', check: 'Проверка',
    lastSearch: 'Последний поиск', roundTrip: 'Туда-обратно', allAirportsShort: 'Все аэропорты', notEnoughData: 'Недостаточно данных',
    perPax: (n: number) => (n === 1 ? 'за пассажира' : `за ${n} пассажиров`),
    lastResults: 'Результаты последней проверки', noMatches: 'Под фильтр ничего не подходит.', confirmDeleteShort: 'Удалить с историей?',
    directionsCount: (n: number) => {
      const m10 = n % 10, m100 = n % 100;
      const w = m10 === 1 && m100 !== 11 ? 'направление' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'направления' : 'направлений';
      return `${n} ${w}`;
    },
    notificationsSub: 'Ежедневные отчёты и оповещения о ценах, которые мы вам отправили.', notificationSettings: 'Настройки уведомлений',
    noNotifications: 'Уведомлений пока нет. Первый ежедневный отчёт придёт после утренней проверки.',
    when: 'Когда', kind: 'Тип', channel: 'Канал',
    KIND_DAILY_SUMMARY: 'Ежедневный отчёт', KIND_PRICE_DROP: 'Снижение цены', KIND_TEST: 'Тест',
    NS_SENT: 'Отправлено', NS_FAILED: 'Ошибка', NS_SKIPPED: 'Пропущено',
  },
};

export type Dict = typeof dict.en;
const Ctx = createContext<{ t: Dict; locale: Locale; setLocale: (l: Locale) => void }>({ t: dict.ru as Dict, locale: 'ru', setLocale: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ru');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ff_locale');
      if (saved === 'en' || saved === 'ru') setLocaleState(saved);
      else if (navigator.language && !navigator.language.startsWith('ru')) setLocaleState('en');
    } catch {}
  }, []);
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem('ff_locale', l); } catch {}
    document.documentElement.lang = l;
  };
  return <Ctx.Provider value={{ t: dict[locale] as Dict, locale, setLocale }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
