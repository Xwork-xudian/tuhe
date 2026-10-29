import { haversineMeters } from './coordinates.js';

export function normalizeComparable(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[\s\-_.,，。·、()（）[\]【】'"“”]/g, '')
    .replace(/(旗舰店|分店|店)$/g, '');
}

export function findDuplicate(place, existing, threshold = 120) {
  const name = normalizeComparable(place.name);
  const address = normalizeComparable(place.address);
  if (!name) return null;

  for (const item of existing) {
    if (place.externalId && item.source?.platform === place.platform && item.source?.externalId === place.externalId) return item;
    if (place.externalId && item.links?.[place.platform]?.externalId === place.externalId) return item;

    const itemName = normalizeComparable(item.name);
    if (name !== itemName) continue;

    if (place.location && item.location) {
      if (haversineMeters(place.location, item.location) <= threshold) return item;
    } else if (address && item.address && address === normalizeComparable(item.address)) {
      return item;
    } else if (place.city && item.city && place.city === item.city) {
      return item;
    }
  }
  return null;
}

export function findDuplicateGroups(places, threshold = 120) {
  const groups = [];
  const used = new Set();
  for (let i = 0; i < places.length; i += 1) {
    if (used.has(places[i].id)) continue;
    const group = [places[i]];
    for (let j = i + 1; j < places.length; j += 1) {
      if (used.has(places[j].id)) continue;
      if (isSimilar(places[i], places[j], threshold)) {
        group.push(places[j]);
        used.add(places[j].id);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

function isSimilar(a, b, threshold) {
  if (normalizeComparable(a.name) !== normalizeComparable(b.name)) return false;
  if (a.location && b.location) return haversineMeters(a.location, b.location) <= threshold;
  return Boolean(a.address && b.address && normalizeComparable(a.address) === normalizeComparable(b.address));
}

export function mergePlace(target, incoming) {
  target.tags = [...new Set([...(target.tags || []), ...(incoming.tags || [])])].slice(0, 20);
  for (const field of ['address', 'city', 'district', 'note', 'url']) {
    if (!target[field] && incoming[field]) target[field] = incoming[field];
  }
  if (!target.rating && incoming.rating) target.rating = incoming.rating;
  if (!target.location && incoming.location) target.location = incoming.location;
  if (!target.category || target.category === '未分类') target.category = incoming.category;
  target.updatedAt = new Date().toISOString();
  return target;
}
