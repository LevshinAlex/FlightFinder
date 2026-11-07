/**
 * Builds the daily summary (one email for all active trackers, spec 8.1).
 * Pure functions: input data → { subject, html, text, whatsapp }.
 */
import { PriceAnalysis } from '../analysis/price-analysis';

export type Locale = 'ru' | 'en';

export interface ReportItem {
  trackerId: string;
  title: string;            // "🇮🇹 ITALY" or tracker name
  currency: string;
  analysis: (PriceAnalysis & { current?: any }) | null;
  runStatus: 'SUCCESS' | 'PARTIAL' | 'NO_RESULTS' | 'FAILED' | 'NONE';
  bestCity?: string;
  departureDate?: string;
  returnDate?: string;
  stopsOut?: number;
  stopsIn?: number;
  airline?: string;
  bookingUrl?: string;
  checkedAt?: Date;
  detailsUrl: string;
}

const T = {
  en: {
    subject: (d: string) => `✈️ Flight Price Report — ${d}`,
    hello: 'Good morning!', intro: 'Your flight price monitoring results:',
    best: 'Best price', prev: 'Previous price', dest: 'Best destination', dep: 'Departure', ret: 'Return',
    direct: 'Direct flight', stops: (o: number, i: number) => (o === i ? `${o} stop${o > 1 ? 's' : ''} each way` : `${o} stop(s) out / ${i} back`),
    dropped: (p: string) => `🟢 Price decreased by ${p}%`, increased: (p: string) => `🔴 Price increased by ${p}%`,
    nochange: '⚪ No significant change', first: 'First check – no comparison yet',
    newLow: '⭐ New historical low!', target: '🔥 Target price reached!',
    moved: (a: string, b: string) => `ℹ️ Cheapest destination changed: ${a} → ${b} (different flight, not the same ticket getting cheaper)`,
    failed: '⚠️ Price check failed today (flight data provider unavailable). No price change is reported.',
    none: 'No flights matching your criteria were found today.',
    indicative: '⚠️ Approximate price – not confirmed by a live check',
    checked: 'Checked', view: 'View Flight', details: 'Details',
    summary: 'Daily Summary', sDown: (n: number) => `🟢 ${n} destination(s) decreased in price.`,
    sUp: (n: number) => `🔴 ${n} destination(s) increased in price.`, sLow: (t: string, p: string) => `⭐ Lowest price today: ${t} — ${p}.`,
    disclaimer: 'Prices are the lowest among offers available to the service, not a guarantee of the lowest market price.',
    dropSubject: (t: string) => `🔥 Price drop: ${t}`,
  },
  ru: {
    subject: (d: string) => `✈️ Отчёт о ценах на авиабилеты — ${d}`,
    hello: 'Доброе утро!', intro: 'Результаты мониторинга цен:',
    best: 'Лучшая цена', prev: 'Предыдущая цена', dest: 'Лучшее направление', dep: 'Вылет', ret: 'Возвращение',
    direct: 'Прямой рейс', stops: (o: number, i: number) => (o === i ? `${o} пересадк${o > 1 ? 'и' : 'а'} в каждую сторону` : `Туда: ${o}, обратно: ${i} пересадк.`),
    dropped: (p: string) => `🟢 Цена снизилась на ${p}%`, increased: (p: string) => `🔴 Цена выросла на ${p}%`,
    nochange: '⚪ Без существенных изменений', first: 'Первая проверка – сравнивать пока не с чем',
    newLow: '⭐ Новый исторический минимум!', target: '🔥 Достигнута желаемая цена!',
    moved: (a: string, b: string) => `ℹ️ Самое дешёвое направление сменилось: ${a} → ${b} (это другой рейс, а не подешевевший тот же билет)`,
    failed: '⚠️ Сегодня проверка не выполнена (поставщик авиаданных недоступен). Изменение цены не сообщается.',
    none: 'Сегодня не найдено рейсов, соответствующих вашим условиям.',
    indicative: '⚠️ Предварительная цена – не подтверждена актуальной проверкой',
    checked: 'Проверено', view: 'Смотреть рейс', details: 'Подробнее',
    summary: 'Итоги дня', sDown: (n: number) => `🟢 Подешевело направлений: ${n}.`,
    sUp: (n: number) => `🔴 Подорожало направлений: ${n}.`, sLow: (t: string, p: string) => `⭐ Самая низкая цена сегодня: ${t} — ${p}.`,
    disclaimer: 'Показана минимальная цена среди доступных сервису предложений; это не гарантия абсолютного минимума рынка.',
    dropSubject: (t: string) => `🔥 Снижение цены: ${t}`,
  },
};

const SYMBOL: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
export function money(v: number, cur: string, locale: Locale = 'en'): string {
  const n = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 }).format(v);
  return SYMBOL[cur] ? `${SYMBOL[cur]}${n}` : `${n} ${cur}`;
}
const fmtDate = (iso: string | undefined, locale: Locale) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function itemLines(it: ReportItem, l: Locale): { lines: string[]; link?: string } {
  const t = T[l];
  const a = it.analysis;
  if (it.runStatus === 'FAILED' || it.runStatus === 'NONE' || !a) return { lines: [t.failed] };
  if (it.runStatus === 'NO_RESULTS' || a.currentMinPrice == null) return { lines: [t.none] };
  const lines = [`${t.best}: ${money(a.currentMinPrice, it.currency, l)}`];
  if (a.currentPriceStatus === 'INDICATIVE') lines.push(t.indicative);
  if (a.previousPrice != null) lines.push(`${t.prev}: ${money(a.previousPrice, it.currency, l)}`);
  const pct = a.priceChangePct != null ? Math.abs(a.priceChangePct).toFixed(1) : '';
  lines.push(
    a.status === 'PRICE_DROPPED' ? t.dropped(pct) : a.status === 'PRICE_INCREASED' ? t.increased(pct) : a.status === 'FIRST_CHECK' ? t.first : t.nochange,
  );
  if (a.cheapestRouteChanged && a.previousBestDestination && a.bestDestination) lines.push(t.moved(a.previousBestDestination, a.bestDestination));
  if (a.isNewHistoricalLow) lines.push(t.newLow);
  if (a.targetReached) lines.push(t.target);
  if (it.bestCity) lines.push(`${t.dest}: ${it.bestCity}`);
  if (it.departureDate) lines.push(`${t.dep}: ${fmtDate(it.departureDate, l)}`);
  if (it.returnDate) lines.push(`${t.ret}: ${fmtDate(it.returnDate, l)}`);
  if (it.stopsOut != null) lines.push(it.stopsOut === 0 && it.stopsIn === 0 ? t.direct : t.stops(it.stopsOut, it.stopsIn ?? 0));
  if (it.checkedAt) lines.push(`${t.checked}: ${it.checkedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  return { lines, link: it.bookingUrl };
}

export function buildDailyReport(items: ReportItem[], reportDate: string, l: Locale) {
  const t = T[l];
  const ok = items.filter((i) => i.analysis?.currentMinPrice != null && (i.runStatus === 'SUCCESS' || i.runStatus === 'PARTIAL'));
  const down = ok.filter((i) => i.analysis!.status === 'PRICE_DROPPED').length;
  const up = ok.filter((i) => i.analysis!.status === 'PRICE_INCREASED').length;
  const lowest = [...ok].sort((a, b) => a.analysis!.currentMinPrice! - b.analysis!.currentMinPrice!)[0];
  const dateLabel = new Date(`${reportDate}T00:00:00Z`).toLocaleDateString(l === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const summary = [down ? t.sDown(down) : null, up ? t.sUp(up) : null,
    lowest ? t.sLow(lowest.title.replace(/^\S+\s/, ''), money(lowest.analysis!.currentMinPrice!, lowest.currency, l)) : null].filter(Boolean) as string[];

  let text = `${t.subject(dateLabel)}\n\n${t.hello}\n${t.intro}\n\n`;
  let html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<h2>${esc(t.subject(dateLabel))}</h2><p>${t.hello}<br>${t.intro}</p>`;
  for (const it of items) {
    const { lines, link } = itemLines(it, l);
    text += `${it.title}\n${lines.join('\n')}\n${link ? `${t.view}: ${link}\n` : ''}${t.details}: ${it.detailsUrl}\n\n---\n\n`;
    html += `<div style="border:1px solid #e3e3e3;border-radius:10px;padding:14px;margin:14px 0">
<h3 style="margin:0 0 8px">${esc(it.title)}</h3>${lines.map((x) => `<div>${esc(x)}</div>`).join('')}
<p style="margin:12px 0 0">${link ? `<a href="${esc(link)}" style="background:#1565c0;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">${t.view}</a> ` : ''}
<a href="${esc(it.detailsUrl)}" style="margin-left:8px">${t.details}</a></p></div>`;
  }
  text += `${t.summary}\n${summary.join('\n')}\n\n${t.disclaimer}\n`;
  html += `<h3>${t.summary}</h3>${summary.map((x) => `<div>${esc(x)}</div>`).join('')}<p style="color:#777;font-size:12px">${t.disclaimer}</p></div>`;

  // Short WhatsApp version (spec 8.2)
  const wa = ['✈️ Flight Tracker', ''];
  for (const it of items) {
    const a = it.analysis;
    if (!a || a.currentMinPrice == null || !['SUCCESS', 'PARTIAL'].includes(it.runStatus)) { wa.push(`${it.title}: —`); continue; }
    const arrow = a.priceChangePct == null ? '' : a.priceChangePct < 0 ? ` ↓${Math.abs(a.priceChangePct).toFixed(1)}%` : a.priceChangePct > 0 ? ` ↑${a.priceChangePct.toFixed(1)}%` : '';
    wa.push(`${it.title}: ${money(a.currentMinPrice, it.currency, l)}${arrow}`);
  }
  if (lowest) wa.push('', `🔥 Best deal today: ${lowest.title} — ${money(lowest.analysis!.currentMinPrice!, lowest.currency, l)}`);

  return { subject: t.subject(dateLabel), html, text, whatsapp: wa.join('\n'), lowest };
}

export function buildPriceDropAlert(it: ReportItem, l: Locale) {
  const { lines, link } = itemLines(it, l);
  const subject = T[l].dropSubject(it.title);
  const text = `${subject}\n\n${lines.join('\n')}\n${link ? `${T[l].view}: ${link}\n` : ''}${it.detailsUrl}`;
  const html = `<div style="font-family:Arial,sans-serif"><h2>${esc(subject)}</h2>${lines.map((x) => `<div>${esc(x)}</div>`).join('')}
${link ? `<p><a href="${esc(link)}">${T[l].view}</a></p>` : ''}<p><a href="${esc(it.detailsUrl)}">${T[l].details}</a></p></div>`;
  return { subject, text, html };
}
