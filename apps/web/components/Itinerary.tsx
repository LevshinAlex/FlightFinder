'use client';
import { dayShift, fmtStamp, fmtWait, leg, Places, Segment } from '@/lib/itinerary';
import { useI18n } from '@/lib/i18n';

type Segs = { outbound?: Segment[]; inbound?: Segment[] } | null | undefined;

/** Departure → arrival times of both directions (local airport time) and total travel time. */
export function LegTimes({ segments, outboundMin, inboundMin }: { segments: Segs; outboundMin?: number | null; inboundMin?: number | null }) {
  const { t, locale } = useI18n();
  const rows = [[t.legOut, leg(segments?.outbound), outboundMin], [t.legBack, leg(segments?.inbound), inboundMin]] as const;
  return (
    <div className="legs">
      {rows.map(([label, l, dur]) => l?.depart && (
        <div key={label} className="leg-row">
          <span className="leg-label">{label}</span>
          <span>
            {fmtStamp(l.depart, locale)} → {l.arrive ? fmtStamp(l.arrive, locale, false) : '—'}
            {dayShift(l) > 0 && <sup className="day-shift" title={l.arrive ? fmtStamp(l.arrive, locale) : undefined}>+{dayShift(l)}</sup>}
            {dur ? <span className="duration" title={t.durationHint}>{fmtWait(dur, locale)}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Stops per direction with the layover city and waiting time. */
export function LegStops({ segments, places, outboundStops, inboundStops }: { segments: Segs; places?: Places; outboundStops: number; inboundStops: number }) {
  const { t, locale } = useI18n();
  const rows = [[t.legOut, leg(segments?.outbound), outboundStops], [t.legBack, leg(segments?.inbound), inboundStops]] as const;
  return (
    <div className="legs">
      {rows.map(([label, l, stops]) => (
        <div key={label} className="leg-row">
          <span className="leg-label">{label}</span>
          {stops === 0 ? <span>{t.nonstop}</span> : !l?.layovers.length ? <span>{t.stopsCount(stops)}</span> : (
            <span className="layovers">
              {l.layovers.map((x, i) => (
                <span key={i} className="layover" title={t.layoverHint}>
                  {places?.[x.airport]?.[locale] ? `${places[x.airport][locale]} ` : ''}<b>{x.airport}</b>
                  {x.minutes != null && <span className={`wait${x.minutes >= 360 ? ' long' : ''}`}>{fmtWait(x.minutes, locale)}</span>}
                </span>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
