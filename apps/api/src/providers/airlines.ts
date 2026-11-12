/**
 * IATA carrier code → English name, for providers that localise names (Ignav market IL returns
 * Hebrew, e.g. «אל על»). Covers carriers flying from TLV and the main European ones.
 */
export const AIRLINES: Record<string, string> = {
  // Israel
  LY: 'El Al', IZ: 'Arkia', '6H': 'Israir', BZ: 'Blue Bird Airways', HF: 'Air Haifa',
  // low-cost
  W6: 'Wizz Air', W4: 'Wizz Air Malta', W9: 'Wizz Air UK', '5W': 'Wizz Air Abu Dhabi',
  FR: 'Ryanair', RK: 'Ryanair UK', AL: 'Malta Air', U2: 'easyJet', EC: 'easyJet Europe', DS: 'easyJet Switzerland',
  VY: 'Vueling', V7: 'Volotea', HV: 'Transavia', TO: 'Transavia France', PC: 'Pegasus', '4Y': 'Discover Airlines',
  EW: 'Eurowings', DY: 'Norwegian', D8: 'Norwegian', FZ: 'flydubai', G9: 'Air Arabia', XQ: 'SunExpress', '0B': 'Blue Air',
  // Italy / Greece / Cyprus
  AZ: 'ITA Airways', A3: 'Aegean', OA: 'Olympic Air', GQ: 'Sky Express', CY: 'Cyprus Airways', U8: 'TUS Airways', X3: 'TUIfly', BY: 'TUI Airways',
  // Europe full-service
  LH: 'Lufthansa', LX: 'Swiss', OS: 'Austrian', SN: 'Brussels Airlines', WK: 'Edelweiss', EN: 'Air Dolomiti',
  AF: 'Air France', KL: 'KLM', BA: 'British Airways', IB: 'Iberia', UX: 'Air Europa', TP: 'TAP Air Portugal',
  LO: 'LOT', OK: 'Czech Airlines', RO: 'TAROM', FB: 'Bulgaria Air', JU: 'Air Serbia', OU: 'Croatia Airlines',
  BT: 'airBaltic', AY: 'Finnair', SK: 'SAS', EI: 'Aer Lingus', TK: 'Turkish Airlines', KM: 'KM Malta Airlines',
  H4: 'HiSky', '9U': 'Air Moldova', PS: 'Ukraine International', A9: 'Georgian Airways',
  // Gulf / Asia / Americas
  EK: 'Emirates', EY: 'Etihad', QR: 'Qatar Airways', GF: 'Gulf Air', RJ: 'Royal Jordanian', MS: 'EgyptAir',
  ET: 'Ethiopian', AI: 'Air India', UA: 'United', DL: 'Delta', AA: 'American Airlines', AC: 'Air Canada',
};

const LATIN = /^[\p{Script=Latin}\p{N}\s.,&'()\-/]+$/u;

/** English carrier name: provider's name if it is Latin, else our directory, else the IATA code. */
export function carrierName(code: string | undefined, providerName?: string): string | undefined {
  if (providerName && LATIN.test(providerName)) return providerName;
  if (code && AIRLINES[code]) return AIRLINES[code];
  return code || undefined;
}

/** Name (lower case) → IATA code, incl. the longer spellings providers use. */
const CODE_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(AIRLINES).map(([code, name]) => [name.toLowerCase(), code])),
  'el al israel airlines': 'LY', 'israir airlines': '6H', 'aegean airlines': 'A3', ita: 'AZ',
};

const IATA_FLIGHT = /^([A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/;

/**
 * Flight number with an IATA airline designator. Skyscanner uses its own 2-character codes for some
 * carriers ("I*6044" = Wizz Air Malta W4, "9_132" = Blue Bird BZ, "@6132" = TUS U8): the designator
 * is then taken from the carrier's name. Unknown ones stay as they came.
 */
export function iataFlightNumber(raw: string | undefined, carrier?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, '');
  if (IATA_FLIGHT.test(s)) return s;
  const code = carrier ? CODE_BY_NAME[carrier.toLowerCase()] : undefined;
  const num = s.slice(2);
  return code && /^\d{1,4}[A-Z]?$/.test(num) ? `${code}${num}` : s;
}
