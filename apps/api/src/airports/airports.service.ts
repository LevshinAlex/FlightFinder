import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface Airport { iata: string; city: { en: string; ru: string }; name: string }
export interface Country { code: string; name: { en: string; ru: string }; airports: Airport[] }

let cache: Country[] | null = null;
export function loadCountries(): Country[] {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'countries.json'), 'utf8')) as Country[];
  return cache;
}

export function flagEmoji(code: string): string {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

@Injectable()
export class AirportsService {
  countries() {
    return loadCountries().map((c) => ({ code: c.code, name: c.name, flag: flagEmoji(c.code), airports: c.airports }));
  }

  country(code: string): Country {
    const c = loadCountries().find((x) => x.code === code.toUpperCase());
    if (!c) throw new NotFoundException(`Unknown country ${code}`);
    return c;
  }

  /** All passenger airports of the country, or the user's subset (validated). */
  resolveDestinationAirports(countryCode: string, selected: string[]): string[] {
    const all = this.country(countryCode).airports.map((a) => a.iata);
    if (!selected?.length) return all;
    return selected.filter((s) => all.includes(s));
  }

  airport(iata: string): (Airport & { country: string }) | null {
    for (const c of loadCountries()) {
      const a = c.airports.find((x) => x.iata === iata);
      if (a) return { ...a, country: c.code };
    }
    return null;
  }
}
