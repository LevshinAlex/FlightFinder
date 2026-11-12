'use client';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtDateTime, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Point = { date: string; price: number; destination: string | null; priceStatus: string | null };

/** Our daily checks, plus (dashed) Google's own recent prices for the current cheapest route. */
export default function PriceChart({ points, googlePoints = [], currency, locale }: {
  points: Point[]; googlePoints?: { date: string; price: number }[]; currency: string; locale: string;
}) {
  const { t } = useI18n();
  if (!points.length && !googlePoints.length) return <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>—</div>;
  const data = [
    ...points.map((p) => ({ ...p, t: new Date(p.date).getTime() })),
    ...googlePoints.map((p) => ({ t: new Date(p.date).getTime(), google: p.price })),
  ].sort((a, b) => a.t - b.t);
  const withGoogle = googlePoints.length > 0;
  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => fmtDate(new Date(v).toISOString(), locale)}
            stroke="var(--muted)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} width={64} domain={['auto', 'auto']}
            tickFormatter={(v) => money(v, currency, locale)} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
            labelFormatter={(v) => fmtDateTime(new Date(v as number), locale)}
            formatter={(v: number, name, item: any) => [
              `${money(v, currency, locale)}${item.dataKey === 'price' && item.payload.destination ? ` · ${item.payload.destination}` : ''}${item.payload.priceStatus === 'INDICATIVE' ? ' (~)' : ''}`,
              withGoogle ? name : '',
            ]}
          />
          {withGoogle && <Legend wrapperStyle={{ fontSize: 12 }} />}
          <Line type="monotone" dataKey="price" name={t.ourSeries} stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
          {withGoogle && (
            <Line type="monotone" dataKey="google" name={t.googleSeries} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
