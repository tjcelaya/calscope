// @calscope/gcal -- Google Calendar REST client, auth, event->Entry mapping and import
// heuristics for M1.5 (read path). Framework-free; must never import solid-js
// (lint-enforced). All network access is injected (fetch, the GIS global) so the package
// tests entirely offline against fixtures.
export * from './types.js'
export * from './auth.js'
export * from './client.js'
export * from './map.js'
export * from './classify.js'
export * from './colors.js'
export * from './report.js'
