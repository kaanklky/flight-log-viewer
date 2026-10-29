const PATHS = {
  highest: '<path d="M12 3v11M7.5 7.5L12 3l4.5 4.5"/><path d="M4 20h16"/>',
  fastest: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 17l4-5"/><circle cx="12" cy="17" r="1.2"/>',
  farthest: '<circle cx="6" cy="18" r="2"/><path d="M8 16L19 5M12 5h7v7"/>',
  launch: '<path d="M3 20h18"/><path d="M5 16l5-5 3 3 6-7M15 7h4v4"/>',
  landing: '<path d="M3 20h18"/><path d="M5 6l5 5 3-3 6 7M19 11v4h-4"/>',
  lowvolt: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3M10.5 9.5L8.5 13h4l-2 3.5"/>',
  linkdrop: '<path d="M5 18v-2M10 18v-5M15 18V9M20 18V5"/><path d="M3 3l18 18"/>',
  cutoff: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'
};

export const EVENT_STYLE = {
  launch: { color: '#16a06a', name: 'Launch' },
  landing: { color: '#2f7be0', name: 'Landing' },
  highest: { color: '#c98500', name: 'Highest point' },
  fastest: { color: '#7a62d8', name: 'Top speed' },
  farthest: { color: '#178fb5', name: 'Farthest from home' },
  lowvolt: { color: '#d9622b', name: 'Lowest battery voltage' },
  linkdrop: { color: '#d03a3a', name: 'Link quality drop' },
  cutoff: { color: '#b02525', name: 'Recording ends mid-air' }
};

export function icon(type, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[type]}</svg>`;
}
