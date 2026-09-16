import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { Alert } from 'react-native';

export type LocationCoords = {
  latitude: number;
  longitude: number;
};

export function useLocation() {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'ต้องการสิทธิ์ตำแหน่ง',
          'กรุณาอนุญาตให้แอปเข้าถึงตำแหน่งของคุณเพื่อใช้งานฟีเจอร์หาห้องน้ำใกล้สุด',
          [{ text: 'ตกลง' }]
        );
        setLoading(false);
        return;
      }

      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (active) {
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      } catch {
        Alert.alert('ไม่สามารถรับตำแหน่งได้', 'กรุณาลองใหม่อีกครั้ง');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, []);

  return { location, loading };
}
