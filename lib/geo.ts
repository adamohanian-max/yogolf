import fs from 'fs';
import path from 'path';

let zipMap: Map<string, { lat: number; lng: number }> | null = null;

export function zipToLatLng(zip: string): { lat: number; lng: number } | null {
  if (!zipMap) {
    zipMap = new Map();
    const csv = fs.readFileSync(path.join(process.cwd(), 'data', 'zips.csv'), 'utf8');
    for (const line of csv.split('\n')) {
      const [z, lat, lng] = line.split(',');
      if (z && lat && lng) zipMap.set(z, { lat: parseFloat(lat), lng: parseFloat(lng) });
    }
  }
  return zipMap.get(zip.trim().slice(0, 5)) ?? null;
}
