'use client';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtDateTime, money } from '@/lib/api';

export default function PriceChart({ points, currency, locale }: { points: { date: string; price: number; destination: string | null; priceStatus: string | null }[]; currency: string; locale: string }) {
  if (!points.length) return <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>—</div>;
  const data = points.map((p) => ({ ...p, t: new Date(p.date).getTime() }));
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
            formatter={(v: number, _n, item: any) => [`${money(v, currency, locale)}${item.payload.destination ? ` · ${item.payload.destination}` : ''}${item.payload.priceStatus === 'INDICATIVE' ? ' (~)' : ''}`, '']}
          />
          <Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
