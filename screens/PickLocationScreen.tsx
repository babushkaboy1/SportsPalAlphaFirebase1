import React, { useRef, useState, useEffect } from 'react';
import { View, TouchableOpacity, Text, Platform, ActivityIndicator } from 'react-native';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DARK_TURQUOISE = '#009fa3';

type Props = StackScreenProps<RootStackParamList, 'PickLocation'>;

export default function PickLocationScreen({ navigation, route }: Props) {
  const mapRef = useRef<MapView>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<{ latitude: number; longitude: number } | null>(
    route.params?.initialCoords ?? null
  );
  const [address, setAddress] = useState<string>('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Try last known location first (fast)
          let location = await Location.getLastKnownPositionAsync({});
          if (!location) {
            // Fallback to current position (slower)
            location = await Location.getCurrentPositionAsync({});
          }
          if (location) {
            setUserLocation(location.coords);
          }
        }
      } catch (e) {
        // handle error
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Format address simply: "Street Number, City, Region PostalCode"
  const formatSimpleAddress = (result: any) => {
    const parts = [
      [result.street, result.name].filter(Boolean).join(' '), // e.g. "Chryshidos 21"
      result.city,
      result.region,
      result.postalCode
    ].filter(Boolean);
    return parts.join(', ');
  };

  // Fetch address when selectedCoords changes
  useEffect(() => {
    const fetchAddress = async () => {
      if (selectedCoords) {
        try {
          const [result] = await Location.reverseGeocodeAsync(selectedCoords);
          if (result) {
            setAddress(formatSimpleAddress(result));
          } else {
            setAddress('');
          }
        } catch {
          setAddress('');
        }
      }
    };
    fetchAddress();
  }, [selectedCoords]);

  // Move map to user location
  const goToMyLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      setSelectedCoords({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      mapRef.current?.animateToRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

  if (!userLocation) {
    return (
      <View style={{ flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1ae9ef" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#121212' }}>
      {/* Back Button */}
      <TouchableOpacity
        style={{
          position: 'absolute', top: 40, left: 20, zIndex: 20,
          backgroundColor: DARK_TURQUOISE, borderRadius: 24, padding: 8,
        }}
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="arrow-back" size={28} color="#fff" />
      </TouchableOpacity>

      <MapView
        ref={mapRef}
        style={{ flex: 1, borderRadius: 10 }}
        provider={Platform.OS === 'android' ? PROVIDER_DEFAULT : undefined}
        initialRegion={{
          latitude: selectedCoords?.latitude || userLocation?.latitude || 37.9838,
          longitude: selectedCoords?.longitude || userLocation?.longitude || 23.7275,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={!!userLocation}
        showsMyLocationButton={false}
        onRegionChangeComplete={(region: Region) =>
          setSelectedCoords({ latitude: region.latitude, longitude: region.longitude })
        }
      >
        {Platform.OS === 'android' && (
          <UrlTile
            urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
          />
        )}
      </MapView>

      {/* Centered Pin */}
      <View pointerEvents="none" style={{
        position: 'absolute', top: '50%', left: '50%',
        marginLeft: -24, marginTop: -48, zIndex: 10,
      }}>
        <Ionicons name="location-sharp" size={48} color="#1ae9ef" />
      </View>

      {/* Address Display */}
      {address ? (
        <View style={{
          position: 'absolute',
          bottom: 120,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 30,
        }}>
          <Text style={{
            color: '#fff',
            backgroundColor: 'rgba(0,0,0,0.7)',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            fontSize: 15,
            textAlign: 'center',
            maxWidth: '90%',
          }}>
            {address}
          </Text>
        </View>
      ) : null}

      {/* My Location Button (bottom right, always visible) */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: 90,
          right: 20,
          zIndex: 50, // ensure it's above the map and confirm button
        }}
      >
        <TouchableOpacity
          style={{
            backgroundColor: DARK_TURQUOISE,
            borderRadius: 24,
            padding: 10,
            elevation: 2,
          }}
          onPress={goToMyLocation}
        >
          <Ionicons name="locate" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* OSM Attribution for Android, above confirm button */}
      {Platform.OS === 'android' && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 70,
            left: 0,
            right: 0,
            alignItems: 'center',
            zIndex: 40,
          }}
        >
          <Text style={{
            color: '#aaa',
            fontSize: 12,
            backgroundColor: 'rgba(18,18,18,0.7)',
            paddingHorizontal: 8,
            borderRadius: 6,
          }}>
            © OpenStreetMap contributors
          </Text>
        </View>
      )}

      {/* Confirm Button */}
      <TouchableOpacity
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: DARK_TURQUOISE, paddingVertical: 22,
          alignItems: 'center', justifyContent: 'center', paddingBottom: 32,
          zIndex: 10,
        }}
        onPress={async () => {
          let locationAddress = address;
          if (selectedCoords && !locationAddress) {
            try {
              const [result] = await Location.reverseGeocodeAsync(selectedCoords);
              if (result) {
                locationAddress = formatSimpleAddress(result);
              }
            } catch {}
          }
          navigation.navigate('MainTabs', {
            screen: 'CreateGame',
            params: {
              pickedCoords: selectedCoords
                ? { ...selectedCoords, address: locationAddress }
                : undefined,
              formState: route.params.formState,
            },
          });
        }}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>
          Confirm Location
        </Text>
      </TouchableOpacity>
    </View>
  );
}