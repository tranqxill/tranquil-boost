'use strict';
// Simple line icons (24x24, stroke based).
window.ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1"/>',
  broom: '<path d="M14 4l6 6"/><path d="M17 7l-7 7"/><path d="M10 14c-3 0-6 2-7 7 5-1 7-4 7-7z"/><path d="M6 17l2 2"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3c1-4 4-8 9-9 2 0 3 1 3 3-1 5-5 8-9 9z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  gpu: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><circle cx="16.5" cy="12" r="1.5"/><path d="M6 18v2M10 18v2"/>',
  ram: '<rect x="2" y="7" width="20" height="10" rx="1.5"/><path d="M6 10v4M10 10v4M14 10v4M18 10v4"/><path d="M5 17v2M19 17v2"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  windows: '<path d="M3 5.5l7.5-1v7H3zM12.5 4.2L21 3v8.5h-8.5zM3 12.5h7.5v7L3 18.5zM12.5 12.5H21V21l-8.5-1.2z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/>',
};

window.icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${window.ICONS[name] || ''}</svg>`;
