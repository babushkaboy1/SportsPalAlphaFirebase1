import React, { useRef, useState, useEffect } from 'react';
import { View, TouchableOpacity, Text, Platform, ActivityIndicator, TextInput, Alert, ScrollView } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; title: string; subtitle?: string; latitude: number; longitude: number }>>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            // Lock in current location immediately if no initial coords were provided
            if (!selectedCoords) {
              setSelectedCoords({ latitude: location.coords.latitude, longitude: location.coords.longitude });
              try {
                const [rev] = await Location.reverseGeocodeAsync({ latitude: location.coords.latitude, longitude: location.coords.longitude });
                if (rev) {
                  setAddress(formatSimpleAddress(rev));
                }
              } catch {}
            }
          }
        }
      } catch (e) {
        // handle error
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Format address simply: "StreetName StreetNumber PostalCode" (e.g., "Xryshidos 21 11363")
  const formatSimpleAddress = (result: any) => {
    // Some providers put the number in streetNumber, others in name. Prefer streetNumber.
    const streetNumber = result.streetNumber || (result.name && /^\d+$/.test(result.name) ? result.name : '');
    const street = result.street || '';
    const first = [street, streetNumber].filter(Boolean).join(' ').trim();
    const parts = [first, result.postalCode].filter(Boolean);
    return parts.join(' ').trim();
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

  // Search handler: geocode query and move the map
  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    try {
      const results = await Location.geocodeAsync(query);
      if (results && results.length > 0) {
        const { latitude, longitude } = results[0];
        const region = { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
        setSelectedCoords({ latitude, longitude });
        mapRef.current?.animateToRegion(region);
        // Try to fetch and show address for the result
        try {
          const [rev] = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (rev) setAddress(formatSimpleAddress(rev));
        } catch {}
        setShowSuggestions(false);
      } else {
        Alert.alert('No results', 'Could not find that place. Try a more specific address.');
      }
    } catch (e) {
      Alert.alert('Search failed', 'There was a problem searching that location.');
    }
  };

  // Debounced suggestions on typing
  const handleQueryChange = (text: string) => {
    setSearchQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text || text.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const q = encodeURIComponent(text.trim());
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${q}`;
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            // Provide a friendly UA per Nominatim policy
            'User-Agent': 'SportsPalApp/1.0 (+https://sportspal.app)'
          },
        });
        const data: any[] = await res.json();
        const mapped = (data || []).map((item: any, idx: number) => {
          const title = item.display_name?.split(',').slice(0, 2).join(', ').trim() || text.trim();
          const parts = item.display_name?.split(',').map((s: string) => s.trim()) || [];
          const subtitle = parts.slice(2, 6).join(', ');
          return {
            id: `${item.osm_type}-${item.osm_id}-${idx}`,
            title,
            subtitle: subtitle || undefined,
            latitude: parseFloat(item.lat),
            longitude: parseFloat(item.lon),
          };
        });
        setSuggestions(mapped);
        setShowSuggestions(mapped.length > 0);
      } catch (e) {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  const handlePickSuggestion = async (item: { latitude: number; longitude: number; title: string }) => {
    const { latitude, longitude } = item;
    setSelectedCoords({ latitude, longitude });
    mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    try {
      const [rev] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (rev) setAddress(formatSimpleAddress(rev));
    } catch {}
    setShowSuggestions(false);
  };

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
      <View style={{ position: 'absolute', top: Math.max(insets.top + 12, 20), left: 20, right: 20, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity
          style={{ backgroundColor: DARK_TURQUOISE, borderRadius: 24, padding: 8 }}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        {/* Search Bar */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e1e', borderRadius: 24, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#2a2a2a' }}>
          <Ionicons name="search" size={18} color={DARK_TURQUOISE} />
          <TextInput
            placeholder="Search address or place"
            placeholderTextColor="#888"
            style={{ flex: 1, color: '#fff', marginLeft: 8, paddingVertical: 4 }}
            value={searchQuery}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            onSubmitEditing={async () => {
              await handleSearch();
            }}
          />
        </View>
      </View>

      {/* Suggestions Dropdown */}
      {showSuggestions && (
        <View
          style={{
            position: 'absolute',
            top: Math.max(insets.top + 62, 90),
            left: 20,
            right: 20,
            backgroundColor: '#1e1e1e',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#2a2a2a',
            zIndex: 25,
            maxHeight: 300,
            overflow: 'hidden',
          }}
        >
          <View style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomColor: '#2a2a2a', borderBottomWidth: 1 }}>
            <Text style={{ color: '#aaa', fontSize: 12 }}>
              {isSearching ? 'Searching…' : 'Suggestions'}
            </Text>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 }}
                onPress={() => handlePickSuggestion(s)}
              >
                <Ionicons name="location-outline" size={18} color="#1ae9ef" />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                    {s.title}
                  </Text>
                  {s.subtitle ? (
                    <Text style={{ color: '#bbb', fontSize: 12 }} numberOfLines={1}>
                      {s.subtitle}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
          bottom: Math.max(insets.bottom + 50, 90),
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

      {/* No OSM attribution needed without OSM tiles overlay */}

      {/* Confirm Button */}
      <TouchableOpacity
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: DARK_TURQUOISE, paddingVertical: 22,
          alignItems: 'center', justifyContent: 'center', paddingBottom: Math.max(insets.bottom + 12, 24),
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