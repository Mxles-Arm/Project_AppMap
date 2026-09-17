import type { LocationCoords } from '../hooks/useLocation';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export type WalkingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
};

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '< 1 นาที';
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ชม. ${rest} นาที`;
}

export async function getWalkingRoute(
  from: LocationCoords,
  to: LocationCoords
): Promise<WalkingRoute | null> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${from.latitude},${from.longitude}` +
      `&destination=${to.latitude},${to.longitude}` +
      `&mode=walking` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (json.status !== 'OK' || !json.routes?.[0]) return null;

    const leg = json.routes[0].legs[0];
    return {
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
      polyline: json.routes[0].overview_polyline.points,
    };
  } catch {
    return null;
  }
}

export function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}
