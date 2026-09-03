import { StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import markers from './utils/markers';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={{textAlign:'center', fontSize:32}}>GMap (KMUTNB)</Text>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map} 
        initialRegion={markers[0].coordinate}
      >
        <Marker
          coordinate={markers[0].coordinate}
          title={markers[0].name}
          description={markers[0].description}
          pinColor="red" // Optional: customize pin color
        />
        {// Use Array of Markers
        /*markers.map((marker, id) => (
          <Marker
            key={id}
            coordinate={marker.coordinate}
            title={marker.name}
            description={marker.description}
            pinColor="red" // Optional: customize pin color
          />
          ))*/
        }
      </MapView>

      <Text>Copyright: KMUTNB</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
