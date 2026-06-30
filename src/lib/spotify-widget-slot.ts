export async function loadSpotifyWidgetSlot() {
  if (!__SPOTIFY_WIDGET_ENABLED__) {
    return null;
  }

  return (await import('../components/SpotifyWidgetLoader.astro')).default;
}
