import React, { useRef, useState, useEffect } from 'react';
import { View, TouchableOpacity, Text, Platform, ActivityIndicator, TextInput, Alert, ScrollView, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';

type Props = StackScreenProps<RootStackParamList, 'PickLocation'>;

export default function PickLocationScreen({ navigation, route }: Props) {
  const { theme } = useTheme();
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
  
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    loadingContainer: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topBar: {
      position: 'absolute',
      top: Math.max(insets.top + 12, 20),
      left: 20,
      right: 20,
      zIndex: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    backButton: {
      backgroundColor: theme.primary,
      borderRadius: 24,
      padding: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    searchContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.card,
      borderRadius: 24,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 3,
    },
    searchInput: {
      flex: 1,
      color: theme.text,
      marginLeft: 8,
      paddingVertical: 4,
      fontSize: 15,
    },
    suggestionsContainer: {
      position: 'absolute',
      top: Math.max(insets.top + 70, 98),
      left: 20,
      right: 20,
      backgroundColor: theme.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      zIndex: 25,
      maxHeight: 350,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    suggestionsHeader: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      backgroundColor: theme.background,
    },
    suggestionsHeaderText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    suggestionIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    suggestionTextContainer: {
      marginLeft: 12,
      flex: 1,
    },
    suggestionTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    suggestionSubtitle: {
      color: theme.muted,
      fontSize: 13,
      marginTop: 2,
    },
    centeredPin: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      marginLeft: -24,
      marginTop: -48,
      zIndex: 10,
    },
    addressDisplay: {
      position: 'absolute',
      bottom: 130,
      left: 20,
      right: 20,
      alignItems: 'center',
      zIndex: 30,
    },
    addressText: {
      color: '#fff',
      backgroundColor: theme.isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(0, 0, 0, 0.75)',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      fontSize: 15,
      fontWeight: '600',
      textAlign: 'center',
      maxWidth: '100%',
      borderWidth: 1,
      borderColor: theme.primary,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    myLocationButton: {
      position: 'absolute',
      bottom: Math.max(insets.bottom + 90, 130),
      right: 20,
      zIndex: 50,
      backgroundColor: theme.primary,
      borderRadius: 28,
      padding: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 6,
    },
    confirmButton: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.primary,
      paddingVertical: 20,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: Math.max(insets.bottom + 12, 24),
      zIndex: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 10,
    },
    confirmButtonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 18,
    },
  });

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

  // Debounced suggestions on typing - using Photon API (free, no rate limits)
  const handleQueryChange = (text: string) => {
    setSearchQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text || text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const q = encodeURIComponent(text.trim());
        // Using Photon API - free geocoding API by Komoot
        const url = `https://photon.komoot.io/api/?q=${q}&limit=10&lang=en`;
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
          },
        });
        const data: any = await res.json();
        const features = data?.features || [];
        const mapped = features.map((item: any, idx: number) => {
          const props = item.properties || {};
          const coords = item.geometry?.coordinates || [0, 0];
          
          // Build title from available fields
          const name = props.name || props.street || '';
          const city = props.city || props.town || props.village || '';
          const title = name && city ? `${name}, ${city}` : name || city || 'Unknown location';
          
          // Build subtitle from country, state
          const parts = [];
          if (props.state) parts.push(props.state);
          if (props.country) parts.push(props.country);
          const subtitle = parts.join(', ');
          
          return {
            id: `photon-${idx}-${coords[0]}-${coords[1]}`,
            title,
            subtitle: subtitle || undefined,
            latitude: coords[1],
            longitude: coords[0],
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
    }, 300);
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={{ color: theme.text, marginTop: 12, fontSize: 15 }}>Finding your location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Back Button & Search Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={theme.primary} />
          <TextInput
            placeholder="Search address or place"
            placeholderTextColor={theme.muted}
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => {
              setSearchQuery('');
              setSuggestions([]);
              setShowSuggestions(false);
            }}>
              <Ionicons name="close-circle" size={20} color={theme.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Suggestions Dropdown */}
      {showSuggestions && (
        <View style={styles.suggestionsContainer}>
          <View style={styles.suggestionsHeader}>
            <Text style={styles.suggestionsHeaderText}>
              {isSearching ? 'Searching…' : `${suggestions.length} result${suggestions.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {suggestions.map((s, index) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.suggestionItem, index === suggestions.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => handlePickSuggestion(s)}
              >
                <View style={styles.suggestionIcon}>
                  <Ionicons name="location" size={18} color={theme.primary} />
                </View>
                <View style={styles.suggestionTextContainer}>
                  <Text style={styles.suggestionTitle} numberOfLines={1}>
                    {s.title}
                  </Text>
                  {s.subtitle ? (
                    <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                      {s.subtitle}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.muted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: selectedCoords?.latitude || userLocation?.latitude || 37.9838,
          longitude: selectedCoords?.longitude || userLocation?.longitude || 23.7275,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={!!userLocation}
        showsMyLocationButton={false}
        userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
        onRegionChangeComplete={(region: Region) =>
          setSelectedCoords({ latitude: region.latitude, longitude: region.longitude })
        }
      />

      {/* Centered Pin */}
      <View pointerEvents="none" style={styles.centeredPin}>
        <Ionicons name="location-sharp" size={48} color={theme.primary} />
      </View>

      {/* Address Display */}
      {address ? (
        <View style={styles.addressDisplay}>
          <Text style={styles.addressText}>
            {address}
          </Text>
        </View>
      ) : null}

      {/* My Location Button */}
      <TouchableOpacity
        style={styles.myLocationButton}
        onPress={goToMyLocation}
      >
        <Ionicons name="locate" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Confirm Button */}
      <TouchableOpacity
        style={styles.confirmButton}
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
        <Text style={styles.confirmButtonText}>
          Confirm Location
        </Text>
      </TouchableOpacity>
    </View>
  );
}