import { NextRequest, NextResponse } from 'next/server';
import { zipToLatLng } from '@/lib/geo';

export async function GET(req: NextRequest) {
  const zip = req.nextUrl.searchParams.get('zip');
  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip.trim())) {
    return NextResponse.json({ error: 'Provide a 5-digit zip code' }, { status: 400 });
  }
  const loc = zipToLatLng(zip);
  if (!loc) {
    return NextResponse.json({ error: `Unknown zip code ${zip}` }, { status: 404 });
  }
  return NextResponse.json(loc);
}
