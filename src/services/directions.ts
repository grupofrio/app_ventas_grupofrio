import Constants from 'expo-constants';

const API_KEY = (Constants.expoConfig?.extra?.googleMapsApiKey ?? '') as string;

export type LatLng = { latitude: number; longitude: number };

function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

export async function fetchDrivingRoute(
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[] | null> {
  if (!API_KEY) return null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&mode=driving` +
      `&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json() as { status: string; routes: Array<{ overview_polyline: { points: string } }> };
    if (data.status !== 'OK' || !data.routes.length) return null;
    return decodePolyline(data.routes[0].overview_polyline.points);
  } catch {
    return null;
  }
}
