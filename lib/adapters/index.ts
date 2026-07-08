import type { Adapter } from '../types';
import { foreupAdapter } from './foreup';
import { chronogolfAdapter } from './chronogolf';
import { teeitupAdapter } from './teeitup';
import { cpsAdapter } from './cps';
import { clubcaddieAdapter } from './clubcaddie';
import { teesnapAdapter } from './teesnap';
import { teequestAdapter } from './teequest';
import { webtracAdapter } from './webtrac';
import { golfrevAdapter } from './golfrev';
import { teeonAdapter } from './teeon';
import { quick18Adapter } from './quick18';
import { eagleclubAdapter } from './eagleclub';
import { golfnowAdapter } from './golfnow';
import { fallbackAdapter } from './fallback';

const registry: Record<string, Adapter> = {
  foreup: foreupAdapter,
  chronogolf: chronogolfAdapter,
  teeitup: teeitupAdapter,
  cps: cpsAdapter,
  clubcaddie: clubcaddieAdapter,
  teesnap: teesnapAdapter,
  teequest: teequestAdapter,
  webtrac: webtracAdapter,
  golfrev: golfrevAdapter,
  teeon: teeonAdapter,
  quick18: quick18Adapter,
  eagleclub: eagleclubAdapter,
  golfnow: golfnowAdapter,
  fallback: fallbackAdapter,
};

export function getAdapter(provider: string): Adapter {
  return registry[provider] ?? fallbackAdapter;
}
