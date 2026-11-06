import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import { CampusLocation, projectCampusLocation } from './campusLocation';

type Status = 'idle' | 'requesting' | 'searching' | 'slow' | 'located' | 'outside' | 'imprecise' | 'denied' | 'blocked' | 'disabled' | 'unavailable';
type Reading = { status: Status; point?: CampusLocation };
const maxAccuracyMetres = 150;
const maxFixAgeMs = 30000;

export default function useCampusLocation(visible: boolean) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active' || AppState.currentState === null);
  const [tracking, setTracking] = useState(false);
  const [reading, setReading] = useState<Reading>({ status: 'idle' });
  const requesting = useRef(false);
  const enabled = useRef(false);

  const stop = (status: Status = 'idle') => {
    enabled.current = false;
    setTracking(false);
    setReading({ status });
  };

  async function start() {
    if (requesting.current || enabled.current) return;
    requesting.current = true;
    setReading({ status: 'requesting' });
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        if (reading.status === 'blocked') {
          await Linking.openSettings();
          stop();
        } else {
          stop(permission.canAskAgain ? 'denied' : 'blocked');
        }
        return;
      }
      enabled.current = true;
      setReading({ status: 'searching' });
      setTracking(true);
    } catch {
      stop('unavailable');
    } finally {
      requesting.current = false;
    }
  }

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!tracking) return;
    if (!visible || !foreground) {
      setReading({ status: 'searching' });
      return;
    }
    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;
    const active = () => !cancelled && enabled.current;
    setReading({ status: 'searching' });
    let timeout = setTimeout(() => {
      if (active()) setReading({ status: 'slow' });
    }, 18000);

    async function watch() {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!active()) return;
        if (!permission.granted) {
          stop(permission.canAskAgain ? 'denied' : 'blocked');
          return;
        }
        const services = await Location.hasServicesEnabledAsync();
        if (!active()) return;
        if (!services) {
          stop('disabled');
          return;
        }
        const next = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 2500, mayShowUserSettingsDialog: false },
          ({ coords, timestamp }) => {
            if (!active() || Date.now() - timestamp > maxFixAgeMs) return;
            const { latitude, longitude, accuracy } = coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
              if (active()) setReading({ status: 'slow' });
            }, maxFixAgeMs);
            if (accuracy !== null && accuracy > maxAccuracyMetres) {
              setReading({ status: 'imprecise' });
              return;
            }
            const point = projectCampusLocation(latitude, longitude, accuracy);
            setReading(point ? { status: 'located', point } : { status: 'outside' });
          },
          () => { if (active()) stop('unavailable'); },
        );
        if (active()) subscription = next;
        else next.remove();
      } catch {
        if (active()) stop('unavailable');
      }
    }
    void watch();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription?.remove();
    };
  }, [tracking, visible, foreground]);

  const point = tracking && visible && foreground ? reading.point : undefined;
  return { status: reading.status, point, tracking, start, stop };
}
