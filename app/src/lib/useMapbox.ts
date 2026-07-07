import Mapbox from '@rnmapbox/maps';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

/**
 * Initialize Mapbox access token at module load.
 * Called once when this module is first imported.
 */
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else {
  console.warn(
    '[useMapbox] EXPO_PUBLIC_MAPBOX_TOKEN is not set. Mapbox will not render.',
  );
}

export default Mapbox;
