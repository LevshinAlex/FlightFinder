/** Identifies a comparable "same trip": origin, destination airport and exact dates. */
export function routeKey(origin: string, destination: string, dep: string, ret: string): string {
  return `${origin}-${destination}-${dep.replace(/-/g, '')}-${ret.replace(/-/g, '')}`;
}
