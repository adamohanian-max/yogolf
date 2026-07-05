import type { Adapter } from '../types';
import { foreupAdapter } from './foreup';
import { chronogolfAdapter } from './chronogolf';
import { teeitupAdapter } from './teeitup';
import { cpsAdapter } from './cps';
import { clubcaddieAdapter } from './clubcaddie';
import { fallbackAdapter } from './fallback';

const registry: Record<string, Adapter> = {
  foreup: foreupAdapter,
  chronogolf: chronogolfAdapter,
  teeitup: teeitupAdapter,
  cps: cpsAdapter,
  clubcaddie: clubcaddieAdapter,
  fallback: fallbackAdapter,
};

export function getAdapter(provider: string): Adapter {
  return registry[provider] ?? fallbackAdapter;
}
