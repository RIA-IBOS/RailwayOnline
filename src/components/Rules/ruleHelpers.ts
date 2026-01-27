import type { FeatureStore } from './featureStore';
import type { FeatureRecord, FloorViewConfig } from './renderRules';

/**
 * Shared helpers for rule evaluation.
 *
 * Goals:
 * - Avoid circular runtime dependencies between renderRules.ts and featureRenderRules.ts.
 * - Keep feature rules (data) separate from helper methods (logic).
 */

// ------------------------------
// Floor view
// ------------------------------

/** Default floor-view configuration used by both renderRules and feature rules. */
export const DEFAULT_FLOOR_VIEW: FloorViewConfig = {
  minLevel: 6,
  buildingClass: 'STB',
  floorClass: 'STF',
  buildingFloorRefField: 'ID',
  floorRefTargetField: 'staBFloorID',
  floorSelectorField: 'NofFloor',
};

/**
 * Format a floor label consistently.
 * - Accepts numbers/strings like 1, '1', 'B1', 'GF', 'G', etc.
 */
export function fmtFloorLabel(n: any): string {
  const s = String(n ?? '').trim();
  if (!s) return '';
  // Common aliases
  const up = s.toUpperCase();
  if (up === 'G' || up === 'GF' || up === 'GROUND') return 'G';
  // Try numeric first
  const v = Number(s);
  if (!Number.isNaN(v) && Number.isFinite(v)) {
    return v >= 0 ? `L${v}` : `B${Math.abs(v)}`;
  }
  return s;
}

// ------------------------------
// Station color selection helpers
// ------------------------------

type StaPlfPointIndex = {
  dir3Points: Set<string>; // STA uid set
  altPoints: Set<string>; // STA uid set
};

function getStationUidSetFromPlatforms(store: FeatureStore, field: string): Set<string> {
  const set = new Set<string>();
  const platforms = store.byClass['STP'] ?? [];
  for (const p of platforms) {
    const v = (p.featureInfo as any)?.[field];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      for (const x of v) {
        const id = String(x ?? '').trim();
        if (id) set.add(id);
      }
    } else {
      const id = String(v ?? '').trim();
      if (id) set.add(id);
    }
  }
  return set;
}

export function getStaPlfPointIndex(store: FeatureStore): StaPlfPointIndex {
  // The exact field names are based on existing project conventions.
  // If your STP schema differs, adjust here once.
  const dir3Points = getStationUidSetFromPlatforms(store, 'Dir3StaUID');
  const altPoints = getStationUidSetFromPlatforms(store, 'AltStaUID');
  return { dir3Points, altPoints };
}

/**
 * Decide station point color from platforms.
 * Returns CSS color string or null if no special color should be applied.
 */
export function getStationPointColorFromPlatforms(sta: FeatureRecord, store: FeatureStore): string | null {
  const idx = getStaPlfPointIndex(store);
  if (idx.dir3Points.has(sta.uid)) return '#0ea5e9'; // sky-500
  if (idx.altPoints.has(sta.uid)) return '#a855f7'; // purple-500
  return null;
}

// ------------------------------
// RLE exclusive choice
// ------------------------------

type RleExclusiveChoice = { choice: 'dir3' | 'alt' };

/**
 * Pick an exclusive RLE choice based on store content.
 * This helper preserves your prior behavior and keeps the decision centralized.
 */
export function getRleExclusiveChoice(store: FeatureStore): RleExclusiveChoice {
  // Heuristic: if there are any STP entries with Dir3 fields, prefer dir3.
  const platforms = store.byClass['STP'] ?? [];
  for (const p of platforms) {
    const v = (p.featureInfo as any)?.Dir3StaUID;
    if (v !== null && v !== undefined && String(v).trim() !== '') return { choice: 'dir3' };
  }
  return { choice: 'alt' };
}
