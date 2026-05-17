import crypto from 'crypto';
import { OrefRealtimeAlert, OrefCategory, CATEGORY_MAP } from '../types';

/**
 * Hebrew keyword → OrefCategory mapping for the first line of a Telegram message.
 * Order matters: more specific keywords should come first.
 */
const KEYWORD_TO_CATEGORY: [string, number][] = [
  ['צבע אדום', OrefCategory.Rockets],
  ['חדירת כלי טיס', OrefCategory.UAVIntrusion],
  ['חדירת מחבלים', OrefCategory.TerroristInfiltration],
];

/**
 * Sorts city names by length descending (longest first).
 * This ensures longer names are matched before shorter substrings.
 */
export function buildCityIndex(cityNames: string[]): string[] {
  return [...cityNames].sort((a, b) => b.length - a.length);
}

/**
 * Parses a Telegram alert channel message into OrefRealtimeAlert objects.
 *
 * @param text - The raw message text from the Telegram channel
 * @param fallbackCategory - Category key (e.g. "rockets", "uav") used when no Hebrew keyword matches
 * @param cityList - City names sorted longest-first via buildCityIndex
 * @returns An array containing a single OrefRealtimeAlert, or empty if no cities were found
 */
export function parseTelegramMessage(
  text: string,
  fallbackCategory: string,
  cityList: string[],
): OrefRealtimeAlert[] {
  if (!text || !text.trim()) {
    return [];
  }

  const firstLine = text.split('\n')[0];

  // 1. Detect category
  const cat = detectCategory(firstLine, fallbackCategory);

  // 2. Extract title from first line (text before '[' bracket)
  const title = extractTitle(firstLine);

  // 3. Extract cities using longest-first matching with text removal
  const cities = extractCities(text, cityList);

  // 4. No cities → empty result
  if (cities.length === 0) {
    return [];
  }

  return [{
    id: `telegram-${crypto.randomUUID()}`,
    cat: String(cat),
    title,
    data: cities,
    desc: '',
  }];
}

function detectCategory(firstLine: string, fallbackCategory: string): number {
  for (const [keyword, category] of KEYWORD_TO_CATEGORY) {
    if (firstLine.includes(keyword)) {
      return category;
    }
  }

  // Fallback: resolve the category string to a numeric ID via CATEGORY_MAP
  const ids = CATEGORY_MAP[fallbackCategory];
  if (ids && ids.length > 0) {
    return ids[0];
  }

  // Ultimate fallback
  return OrefCategory.Rockets;
}

function extractTitle(firstLine: string): string {
  const bracketIndex = firstLine.indexOf('[');
  if (bracketIndex > 0) {
    return firstLine.substring(0, bracketIndex).trim();
  }
  return firstLine.trim();
}

function extractCities(text: string, cityList: string[]): string[] {
  const found: string[] = [];
  let remaining = text;

  for (const city of cityList) {
    if (remaining.includes(city)) {
      found.push(city);
      // Remove all occurrences of this city from remaining text
      // to prevent shorter substrings from matching
      while (remaining.includes(city)) {
        remaining = remaining.replace(city, '');
      }
    }
  }

  // Deduplicate (in case the same city appeared through different paths)
  return [...new Set(found)];
}
