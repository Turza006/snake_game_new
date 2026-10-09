import type { MetadataRoute } from 'next';

// PWA manifest so "Add to Home Screen" launches full-screen in portrait
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Snake',
    short_name: 'Snake',
    description: 'A premium neon Snake game. Classic, Zen and Arcade modes.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0f2c',
    theme_color: '#0a0f2c',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
