/**
 * Country / airport directory (src/airports/data/countries.json): both languages complete,
 * nothing duplicated, every country searchable.
 */
import { loadCountries } from '../src/airports/airports.service';

const countries = loadCountries();
const CYRILLIC = /[А-Яа-яЁё]/;

describe('country directory', () => {
  it('every country has an English and a Russian name – the same number in both languages', () => {
    const en = countries.map((c) => c.name.en).filter((n) => n && !CYRILLIC.test(n));
    const ru = countries.map((c) => c.name.ru).filter((n) => n && CYRILLIC.test(n));
    expect(en).toHaveLength(countries.length);
    expect(ru).toHaveLength(countries.length);
    expect(new Set(en).size).toBe(en.length);
    expect(new Set(ru).size).toBe(ru.length);
  });

  it('country codes (ISO 3166) and airport IATA codes are unique and well-formed', () => {
    const codes = countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z]{2}$/));
    const iata = countries.flatMap((c) => c.airports.map((a) => a.iata));
    expect(new Set(iata).size).toBe(iata.length);
    iata.forEach((a) => expect(a).toMatch(/^[A-Z]{3}$/));
  });

  it('every country has at least one airport, every airport a city name in both languages', () => {
    for (const c of countries) {
      expect(c.airports.length).toBeGreaterThan(0);
      for (const a of c.airports) {
        expect(a.city.en && !CYRILLIC.test(a.city.en)).toBeTruthy();
        expect(CYRILLIC.test(a.city.ru)).toBe(true);
      }
    }
  });

  it('covers the main destinations: Europe, the Americas, South-East Asia and Japan', () => {
    const codes = new Set(countries.map((c) => c.code));
    for (const c of ['IT', 'ES', 'FR', 'DE', 'GB', 'NO', 'FI', 'RU', 'US', 'CA', 'MX', 'BR', 'AR', 'CU', 'DO', 'TH', 'VN', 'ID', 'MY', 'SG', 'PH', 'JP']) {
      expect(codes.has(c)).toBe(true);
    }
  });
});
