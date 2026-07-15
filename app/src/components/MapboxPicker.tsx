import React, { useRef, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import MapboxGL from '../lib/useMapbox';

export interface MapboxPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (lat: number, lng: number) => void;
  label?: string;
}

/**
 * A Mapbox map view that lets the user pick a location by tapping.
 * Falls back to a loading state while the map initialises.
 *
 * NOTE: Requires EXPO_PUBLIC_MAPBOX_TOKEN to be set. Without it,
 * the Mapbox component will not render and a placeholder is shown.
 */
export default function MapboxPicker({
  latitude,
  longitude,
  onPick,
  label,
}: MapboxPickerProps) {
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [loaded, setLoaded] = useState(false);
  const hasToken = !!process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

  const defaultCenter: [number, number] = [
    longitude ?? -70.6693,
    latitude ?? -33.4489,
  ];

  const handlePress = async (feature: GeoJSON.Feature) => {
    const coords = (feature.geometry as GeoJSON.Point)?.coordinates;
    if (coords) {
      const [lng, lat] = coords;
      onPick(lat, lng);
    }
  };

  if (!hasToken) {
    return (
      <View style={[styles.container, styles.placeholder]}>
        <Text style={styles.placeholderText}>
          Mapa no disponible: EXPO_PUBLIC_MAPBOX_TOKEN no configurado
        </Text>
        <Text style={styles.placeholderHint}>
          Configura la variable en tu archivo .env
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

      <View style={styles.mapWrapper}>
        {!loaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#1a73e8" />
          </View>
        )}

        <MapboxGL.MapView
          style={styles.map}
          onDidFinishLoadingMap={() => setLoaded(true)}
          onPress={handlePress}
        >
          <MapboxGL.Camera
            ref={cameraRef}
            zoomLevel={12}
            centerCoordinate={defaultCenter}
          />

          {latitude != null && longitude != null && (
            <MapboxGL.PointAnnotation
              id="picked-location"
              coordinate={[longitude, latitude]}
            >
              <View style={styles.marker} />
            </MapboxGL.PointAnnotation>
          )}
        </MapboxGL.MapView>

        <View style={styles.coordsOverlay}>
          <Text style={styles.coordsText}>
            {latitude != null && longitude != null
              ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
              : 'Toca el mapa para seleccionar ubicación'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' },
  mapWrapper: {
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  map: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    zIndex: 1,
  },
  coordsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    padding: 6,
  },
  coordsText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1a73e8',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 24,
  },
  placeholderText: {
    fontSize: 14,
    color: '#d32f2f',
    textAlign: 'center',
    marginBottom: 4,
  },
  placeholderHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
});
