export const CHART_SPECS = [
  {
    title: 'Altitude (m)',
    when: log => log.hasAlt,
    series: [{ label: 'Altitude', get: s => s.alt, unit: ' m', digits: 1 }]
  },
  {
    title: 'Vertical speed (m/s)',
    when: log => log.hasAlt,
    series: [{ label: 'Vertical speed', get: s => s.vspeed, unit: ' m/s', digits: 1 }]
  },
  {
    title: 'Ground speed (km/h)',
    when: log => log.hasGps,
    series: [{ label: 'Speed', get: s => s.speed, unit: ' km/h', digits: 1 }]
  },
  {
    title: 'Heading (deg)',
    when: log => log.hasGps,
    min: 0,
    max: 360,
    step: 90,
    wrap: 360,
    series: [{ label: 'Heading', get: s => s.heading, unit: ' deg', digits: 0 }]
  },
  {
    title: 'Distance from home (m)',
    when: log => log.hasGps,
    min: 0,
    series: [
      { label: 'Ground', get: s => s.homeDist, unit: ' m', digits: 0 },
      { label: 'Slant', get: s => s.slant, unit: ' m', digits: 0 }
    ]
  },
  {
    title: 'Battery voltage (V)',
    when: log => log.hasVolt,
    series: [{ label: 'Pack', get: s => s.volt, unit: ' V', digits: 2 }]
  },
  {
    title: 'Cell voltage (V/cell)',
    when: log => log.hasVolt,
    series: [{ label: 'Per cell', get: s => s.vcell, unit: ' V', digits: 2 }]
  },
  {
    title: 'Link quality (%)',
    when: log => log.hasLink,
    max: 100,
    series: [{ label: 'RQly', get: s => s.rqly, unit: '%', digits: 0 }]
  },
  {
    title: 'RSSI (dB)',
    when: log => log.hasLink,
    series: [
      { label: 'RSSI-1', get: s => s.rss1, unit: ' dB', digits: 0 },
      { label: 'RSSI-2', get: s => s.rss2, unit: ' dB', digits: 0 }
    ]
  },
  {
    title: 'Sticks (%)',
    when: log => log.hasSticks,
    min: -100,
    max: 100,
    series: [
      { label: 'Throttle', get: s => s.thr * 100, unit: '%', digits: 0 },
      { label: 'Yaw', get: s => s.rud * 100, unit: '%', digits: 0 },
      { label: 'Pitch', get: s => s.ele * 100, unit: '%', digits: 0 },
      { label: 'Roll', get: s => s.ail * 100, unit: '%', digits: 0 }
    ]
  },
  {
    title: 'GPS satellites',
    when: log => log.samples.some(s => s.sats !== null),
    min: 0,
    series: [{ label: 'Sats', get: s => s.sats, unit: '', digits: 0 }]
  }
];
