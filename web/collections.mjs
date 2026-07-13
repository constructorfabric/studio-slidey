export const SOURCE_DECK_ID = '__source';

function normalizeDeckId(id) {
  const value = id == null ? '' : String(id);
  return value === 'source' || value === 'all' ? SOURCE_DECK_ID : value;
}

export function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringSet(value) {
  return new Set(asArray(value).map(v => String(v)).filter(Boolean));
}

function rawDeckDefinitions(rawDecks) {
  if (!rawDecks) return [];
  return Array.isArray(rawDecks)
    ? rawDecks
    : Object.entries(rawDecks).map(([id, value]) => ({ id, ...(value || {}) }));
}

function explicitDeckType(raw, parent) {
  const value = String(raw.deckType || raw.kind || raw.role || '').toLowerCase();
  if (['subset', 'view', 'synced', 'selection'].includes(value)) return 'subset';
  if (['hierarchy', 'deck', 'child', 'detail', 'folder', 'presentation'].includes(value)) return 'hierarchy';

  if (raw.select || raw.selector) return 'subset';
  if (parent && parent !== SOURCE_DECK_ID && !raw.select && !raw.selector) return 'hierarchy';
  if (Array.isArray(raw.scenes) && raw.scenes.some(item => item && typeof item === 'object' && item.type && !item.ref && !item.scene)) {
    return 'hierarchy';
  }
  return 'subset';
}

function localSceneItems(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Array.isArray(raw.scenes) ? raw.scenes : [];
}

function sceneCountForDeck(raw, deckType) {
  if (deckType === 'hierarchy') return localSceneItems(raw).filter(item => item && typeof item === 'object' && item.type).length;
  return 0;
}

function isSceneOriginDeck(deck) {
  return Boolean(deck && (deck.source || deck.deckType === 'hierarchy'));
}

function sceneId(scene, index) {
  if (scene && scene.id != null) return String(scene.id);
  if (scene && scene.key != null) return String(scene.key);
  return String(index);
}

function sceneTags(scene) {
  const tags = new Set();
  for (const tag of asArray(scene && scene.tags)) tags.add(String(tag));
  if (scene && scene.purpose) tags.add(String(scene.purpose));
  if (scene && scene.theme) tags.add(String(scene.theme));
  return tags;
}

function selectorDeckIds(selector) {
  if (!selector || typeof selector !== 'object') return null;
  const raw = selector.decks || selector.deckIds || selector.deck || selector.fromDecks || selector.fromDeck || selector.sourceDecks || selector.sourceDeck;
  if (raw == null) return null;
  return new Set([...stringSet(raw)].map(normalizeDeckId).filter(Boolean));
}

export function sceneSectionIds(scene) {
  const ids = [];
  if (scene && scene.section != null) ids.push(String(scene.section));
  for (const section of asArray(scene && scene.sections)) {
    if (section != null) ids.push(String(section));
  }
  return [...new Set(ids.filter(Boolean))];
}

export function linkTargetForItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nested = raw.link && typeof raw.link === 'object' ? raw.link : {};
  const deckId = raw.deck || raw.deckId || raw.targetDeck || nested.deck || nested.deckId || nested.targetDeck;
  if (!deckId) return null;
  return {
    ...nested,
    deck: String(deckId),
    label: raw.linkLabel || nested.label || nested.title || raw.label || raw.title || String(deckId),
    scene: raw.scene || raw.sceneId || raw.targetScene || nested.scene || nested.sceneId || nested.targetScene || null,
    section: raw.section || raw.sectionId || nested.section || nested.sectionId || null,
  };
}

export function normalizeDeckDefinitions(spec) {
  const library = spec && spec.library && typeof spec.library === 'object' ? spec.library : null;
  const scenes = Array.isArray(spec && spec.scenes) ? spec.scenes : [];
  if (!library) return [];

  const sourceDeck = {
    id: SOURCE_DECK_ID,
    title: library.sourceTitle || (spec.meta && spec.meta.title) || library.title || 'Full deck',
    description: library.sourceDescription || 'All source scenes',
    deckType: 'source',
    source: true,
    sceneCount: scenes.length,
  };

  const decks = [sourceDeck];
  const seen = new Set([SOURCE_DECK_ID]);
  function addDeck(raw, inheritedParent = SOURCE_DECK_ID) {
    if (!raw || typeof raw !== 'object') return;
    const id = raw.id != null ? String(raw.id) : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    const parent = String(raw.parent || raw.parentDeck || inheritedParent || SOURCE_DECK_ID);
    const deckType = explicitDeckType(raw, parent);
    decks.push({
      id,
      title: raw.title || raw.label || id,
      purpose: raw.purpose || raw.audience || '',
      theme: raw.theme || '',
      audience: raw.audience || '',
      description: raw.description || '',
      parent,
      deckType,
      source: false,
      sceneCount: sceneCountForDeck(raw, deckType),
      raw,
    });

    for (const child of rawDeckDefinitions(raw.children)) addDeck(child, id);
  }

  for (const raw of rawDeckDefinitions(library.decks || [])) {
    addDeck(raw, SOURCE_DECK_ID);
  }
  return decks;
}

// Return the full hierarchy stack in presentation order: the source root,
// followed by every hierarchy deck in depth-first order. Subset views do not
// own a place in the hierarchy, so they are intentionally excluded. The
// selected deck only establishes that this is a hierarchy collection; Stack
// playback itself always starts at the root and traverses the whole tree.
export function hierarchyPathForDeck(decks, deckId) {
  const list = Array.isArray(decks) ? decks : [];
  const byId = new Map(list.map(deck => [deck.id, deck]));
  const source = list.find(deck => deck && deck.source) || byId.get(SOURCE_DECK_ID);
  const requested = byId.get(normalizeDeckId(deckId));
  const hierarchyRoot = requested && requested.deckType === 'hierarchy'
    ? requested
    : requested && requested.parent ? byId.get(requested.parent) : null;
  if (!source || (!source.source && !hierarchyRoot)) return [];

  const out = [source.id];
  const seen = new Set();
  function visit(parentId) {
    for (const deck of list) {
      if (!deck || deck.deckType !== 'hierarchy' || deck.parent !== parentId || seen.has(deck.id)) continue;
      seen.add(deck.id);
      out.push(deck.id);
      visit(deck.id);
    }
  }
  visit(source.id);
  return out;
}

export function normalizeSections(spec) {
  const library = spec && spec.library && typeof spec.library === 'object' ? spec.library : null;
  const raw = library && library.sections ? library.sections : [];
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([id, value]) => ({ id, ...(value || {}) }));
  return list
    .filter(section => section && section.id != null)
    .map(section => ({
      ...section,
      id: String(section.id),
      title: section.title || section.label || String(section.id),
      deck: section.deck || section.deckId || null,
      parent: section.parent || section.parentDeck || null,
    }));
}

export function isCollectionSpec(spec) {
  return !!(spec && spec.library && typeof spec.library === 'object');
}

function selectorMatches(scene, index, selector) {
  if (!selector || typeof selector !== 'object') return true;
  const id = sceneId(scene, index);
  const tags = sceneTags(scene);

  const ids = selector.ids || selector.sceneIds || selector.scene || selector.ref;
  if (ids != null && !stringSet(ids).has(id)) return false;

  const sections = selector.sections || selector.section;
  if (sections != null) {
    const want = stringSet(sections);
    const found = sceneSectionIds(scene).some(section => want.has(section));
    if (!found) return false;
  }

  const types = selector.types || selector.type;
  if (types != null && !stringSet(types).has(String((scene && scene.type) || ''))) return false;

  const anyTags = selector.tags || selector.anyTags || selector.purposes || selector.themes;
  if (anyTags != null) {
    const want = stringSet(anyTags);
    let found = false;
    for (const tag of want) {
      if (tags.has(tag)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  const allTags = selector.allTags || selector.requireTags;
  if (allTags != null) {
    for (const tag of stringSet(allTags)) {
      if (!tags.has(tag)) return false;
    }
  }

  const excludeTags = selector.excludeTags || selector.notTags;
  if (excludeTags != null) {
    for (const tag of stringSet(excludeTags)) {
      if (tags.has(tag)) return false;
    }
  }

  const excludeIds = selector.excludeIds || selector.notIds;
  if (excludeIds != null && stringSet(excludeIds).has(id)) return false;

  return true;
}

function selectorMatchesEntry(entry, selector) {
  if (!entry || !selectorMatches(entry.scene, entry.index, selector)) return false;
  const decks = selectorDeckIds(selector);
  return !decks || decks.has(entry.sourceDeckId || SOURCE_DECK_ID);
}

function selectedEntriesBySelector(entries, selector) {
  return entries.filter(entry => selectorMatchesEntry(entry, selector));
}

function outputSceneMatchesSelector(scene, index, selector) {
  const meta = scene && scene._library ? scene._library : {};
  return selectorMatchesEntry({
    scene,
    index: Number.isInteger(meta.sourceIndex) ? meta.sourceIndex : index,
    id: meta.sourceId || sceneId(scene, index),
    sourceDeckId: meta.sourceDeckId || SOURCE_DECK_ID,
  }, selector);
}

function sourceSceneEntries(sourceScenes) {
  return sourceScenes.map((scene, index) => ({
    scene,
    index,
    id: sceneId(scene, index),
    sourceDeckId: SOURCE_DECK_ID,
    sourceDeckTitle: '',
    sourceDeckType: 'source',
  }));
}

function isDeckWithinScope(decks, deckId, rootDeckId) {
  const targetId = normalizeDeckId(deckId);
  const rootId = normalizeDeckId(rootDeckId || SOURCE_DECK_ID);
  if (!targetId) return false;
  if (targetId === rootId) return true;
  const byId = new Map(decks.map(deck => [deck.id, deck]));
  let cursor = byId.get(targetId);
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parentId = normalizeDeckId(cursor.parent || SOURCE_DECK_ID);
    if (parentId === rootId) return true;
    if (!parentId || parentId === SOURCE_DECK_ID) return rootId === SOURCE_DECK_ID;
    cursor = byId.get(parentId);
  }
  return false;
}

function scopeDeckIdsForSubset(decks, deck) {
  const rootId = normalizeDeckId((deck && deck.parent) || SOURCE_DECK_ID);
  const allowed = new Set();
  for (const candidate of decks) {
    if (!isSceneOriginDeck(candidate)) continue;
    if (isDeckWithinScope(decks, candidate.id, rootId)) allowed.add(candidate.id);
  }
  return allowed;
}

function scopedSceneEntries(sourceScenes, decks, deck) {
  const allowedDeckIds = scopeDeckIdsForSubset(decks, deck);
  const entries = [];
  for (const origin of decks) {
    if (!allowedDeckIds.has(origin.id)) continue;
    const scenes = origin.source ? sourceScenes : localSceneItems(origin.raw);
    scenes.forEach((scene, index) => {
      if (!scene || typeof scene !== 'object') return;
      entries.push({
        scene,
        index,
        id: sceneId(scene, index),
        sourceDeckId: origin.id,
        sourceDeckTitle: origin.title || '',
        sourceDeckType: origin.deckType || (origin.source ? 'source' : 'hierarchy'),
      });
    });
  }
  return { entries, allowedDeckIds };
}

function sceneOriginDeckId(item) {
  if (!item || typeof item !== 'object') return null;
  const raw = item.fromDeck || item.sourceDeck || item.sourceDeckId || item.deck || item.deckId;
  return raw == null ? null : normalizeDeckId(raw);
}

function findEntry(entries, ref, deckId = null) {
  const wantedDeckId = deckId ? normalizeDeckId(deckId) : null;
  const wantedRef = ref == null ? '' : String(ref);
  return entries.find(entry => {
    if (wantedDeckId && entry.sourceDeckId !== wantedDeckId) return false;
    return entry.id === wantedRef;
  });
}

function findEntryByIndex(entries, index, deckId = null) {
  const wantedDeckId = deckId ? normalizeDeckId(deckId) : null;
  const filtered = wantedDeckId ? entries.filter(entry => entry.sourceDeckId === wantedDeckId) : entries;
  return filtered[index] || null;
}

function scopedSelectorErrors(selector, allowedDeckIds, deckId) {
  const decks = selectorDeckIds(selector);
  if (!decks) return [];
  return [...decks]
    .filter(id => !allowedDeckIds.has(id))
    .map(id => `library.decks["${deckId}"].scenes: deck "${id}" is outside this subset's parent scope`);
}

function mergeScene(base, item) {
  const scene = cloneJson(base);
  if (!item || typeof item !== 'object') return scene;
  const overrides = item.overrides && typeof item.overrides === 'object' ? item.overrides : null;
  if (overrides) Object.assign(scene, cloneJson(overrides));
  const shallow = { ...item };
  delete shallow.ref;
  delete shallow.scene;
  delete shallow.id;
  delete shallow.fromDeck;
  delete shallow.sourceDeck;
  delete shallow.sourceDeckId;
  delete shallow.deck;
  delete shallow.deckId;
  delete shallow.overrides;
  delete shallow.select;
  if (Object.keys(shallow).length) Object.assign(scene, cloneJson(shallow));
  return scene;
}

function attachLibraryMeta(scene, meta) {
  Object.defineProperty(scene, '_library', {
    value: meta,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return scene;
}

function pushEntry(out, entry, deckId, item = null) {
  const scene = mergeScene(entry.scene, item);
  attachLibraryMeta(scene, {
    deckId,
    sourceIndex: entry.index,
    sourceId: entry.id,
    sourceDeckId: entry.sourceDeckId || SOURCE_DECK_ID,
    sourceDeckTitle: entry.sourceDeckTitle || '',
    sourceDeckType: entry.sourceDeckType || 'source',
  });
  out.push(scene);
}

function pushLocalScene(out, item, deckId, index, errors) {
  if (!item || typeof item !== 'object' || !item.type) {
    errors.push(`library.decks["${deckId}"].scenes[${index}]: hierarchy deck scenes must be inline scene objects`);
    return;
  }
  const scene = cloneJson(item);
  attachLibraryMeta(scene, {
    deckId,
    deckLocal: true,
    deckLocalIndex: index,
    deckLocalId: sceneId(scene, index),
  });
  out.push(scene);
}

function resolveSceneList(inputSpec, decks, deck, errors) {
  const sourceScenes = Array.isArray(inputSpec && inputSpec.scenes) ? inputSpec.scenes : [];
  const raw = deck && deck.raw ? deck.raw : {};
  const out = [];
  const deckId = deck && deck.id ? deck.id : SOURCE_DECK_ID;
  const explicit = raw.scenes || raw.include || raw.refs || null;

  if (deck && deck.deckType === 'hierarchy') {
    const localScenes = localSceneItems(raw);
    localScenes.forEach((item, index) => pushLocalScene(out, item, deckId, index, errors));
    return out;
  }

  const scoped = scopedSceneEntries(sourceScenes, decks, deck);
  const entries = scoped.entries;
  const allowedDeckIds = scoped.allowedDeckIds;

  if (Array.isArray(explicit)) {
    for (const item of explicit) {
      if (typeof item === 'number') {
        const index = item;
        const entry = findEntryByIndex(entries, index);
        if (!entry) {
          errors.push(`library.decks["${deckId}"].scenes: missing scene index ${index}`);
          continue;
        }
        pushEntry(out, entry, deckId);
        continue;
      }

      if (typeof item === 'string') {
        const entry = findEntry(entries, item);
        if (!entry) {
          errors.push(`library.decks["${deckId}"].scenes: missing scene "${item}"`);
          continue;
        }
        pushEntry(out, entry, deckId);
        continue;
      }

      if (!item || typeof item !== 'object') continue;

      if (item.select) {
        const selectorErrors = scopedSelectorErrors(item.select, allowedDeckIds, deckId);
        for (const line of selectorErrors) errors.push(line);
        if (selectorErrors.length) continue;
        for (const entry of selectedEntriesBySelector(entries, item.select)) pushEntry(out, entry, deckId, item);
        continue;
      }

      if (item.type && !item.ref && !item.scene) {
        const scene = cloneJson(item);
        attachLibraryMeta(scene, { deckId, inline: true });
        out.push(scene);
        continue;
      }

      const ref = item.ref || item.scene || item.id;
      const originDeckId = sceneOriginDeckId(item);
      if (originDeckId && !allowedDeckIds.has(originDeckId)) {
        errors.push(`library.decks["${deckId}"].scenes: deck "${originDeckId}" is outside this subset's parent scope`);
        continue;
      }
      const entry = ref != null ? findEntry(entries, String(ref), originDeckId) : null;
      if (!entry) {
        errors.push(`library.decks["${deckId}"].scenes: missing scene "${ref || '?'}"`);
        continue;
      }
      pushEntry(out, entry, deckId, item);
    }
  }

  const selector = raw.select || raw.selector || null;
  if (selector) {
    const selectorErrors = scopedSelectorErrors(selector, allowedDeckIds, deckId);
    for (const line of selectorErrors) errors.push(line);
    if (!selectorErrors.length) {
      for (const entry of selectedEntriesBySelector(entries, selector)) pushEntry(out, entry, deckId);
    }
  }

  if (!explicit && !selector) {
    entries.forEach(entry => pushEntry(out, entry, deckId));
  }

  const exclude = raw.exclude || raw.omit || null;
  if (exclude) {
    return out.filter((scene, index) => !outputSceneMatchesSelector(scene, index, exclude));
  }
  return out;
}

export function resolveDeckSpec(inputSpec, opts = {}) {
  const spec = inputSpec && typeof inputSpec === 'object' ? inputSpec : {};
  const sourceScenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  const library = spec.library && typeof spec.library === 'object' ? spec.library : null;
  const decks = normalizeDeckDefinitions(spec);
  const sections = normalizeSections(spec);
  const errors = [];
  const warnings = [];

  if (!library || !decks.length) {
    return {
      spec: cloneJson(spec),
      deckId: SOURCE_DECK_ID,
      deck: null,
      decks: [],
      sections: [],
      isCollection: false,
      isSource: true,
      errors,
      warnings,
    };
  }

  const requested = opts.deckId || library.activeDeck || library.defaultDeck || SOURCE_DECK_ID;
  const deckId = requested === 'source' || requested === 'all' ? SOURCE_DECK_ID : String(requested);
  const deck = decks.find(candidate => candidate.id === deckId);
  if (!deck || deck.source) {
    return {
      spec: cloneJson(spec),
      deckId: SOURCE_DECK_ID,
      deck: decks[0],
      decks,
      sections,
      isCollection: true,
      isSource: true,
      errors,
      warnings,
    };
  }

  const scenes = resolveSceneList(spec, decks, deck, errors);
  if (!scenes.length) warnings.push(`library.decks["${deck.id}"] resolved to zero scenes`);

  const resolved = cloneJson(spec);
  resolved.scenes = scenes;
  resolved.meta = {
    ...(cloneJson(spec.meta) || {}),
    ...(cloneJson(library.meta) || {}),
    ...(cloneJson(deck.raw && deck.raw.meta) || {}),
  };
  if (deck.title) resolved.meta.title = deck.title;
  resolved.meta.library = {
    ...(resolved.meta.library || {}),
    collectionTitle: library.title || (spec.meta && spec.meta.title) || '',
    deckId: deck.id,
    deckTitle: deck.title,
    purpose: deck.purpose || '',
    theme: deck.theme || '',
    sourceSceneCount: sourceScenes.length,
  };

  return {
    spec: resolved,
    deckId: deck.id,
    deck,
    decks,
    sections,
    isCollection: true,
    isSource: false,
    errors,
    warnings,
  };
}

function normalizeRawLinks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.entries(value).map(([key, link]) => ({ key, ...(link || {}) }));
  return [];
}

export function linksForScene(scene, resolved) {
  const result = [];
  if (!scene || !resolved || !resolved.isCollection) return result;
  const seen = new Set();

  const add = (raw) => {
    const target = linkTargetForItem(raw);
    if (!target) return;
    const deckId = target.deck;
    const deck = (resolved.decks || []).find(candidate => candidate.id === deckId);
    const key = [deckId, target.scene || '', target.section || ''].join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      ...target,
      deck: deckId,
      label: target.label || target.title || (deck && deck.title) || deckId,
      deckTitle: deck && deck.title ? deck.title : deckId,
      scene: target.scene || null,
      section: target.section || null,
    });
  };

  for (const raw of normalizeRawLinks(scene.links)) add(raw);
  for (const raw of normalizeRawLinks(scene.children)) add(raw);
  if (scene.nav) for (const raw of normalizeRawLinks(scene.nav.links || scene.nav)) add(raw);
  if (scene.navigation) for (const raw of normalizeRawLinks(scene.navigation.links || scene.navigation)) add(raw);
  for (const raw of asArray(scene.cards)) add(raw);
  for (const panel of asArray(scene.panels)) {
    for (const raw of asArray(panel && panel.nodes)) add(raw);
  }

  const currentDeck = resolved.deckId;
  for (const sectionId of sceneSectionIds(scene)) {
    const section = (resolved.sections || []).find(candidate => candidate.id === sectionId);
    if (section && section.deck && section.deck !== currentDeck) {
      const already = result.some(link => link.deck === section.deck && (!link.section || link.section === sectionId));
      if (!already) {
        const deck = (resolved.decks || []).find(candidate => candidate.id === section.deck);
        result.push({
          deck: section.deck,
          section: sectionId,
          label: section.cta || section.title || (deck && deck.title) || section.deck,
          deckTitle: deck && deck.title ? deck.title : section.deck,
        });
      }
    }
  }

  const activeDeck = resolved.deck || null;
  if (activeDeck && activeDeck.parent && activeDeck.parent !== currentDeck) {
    const parent = (resolved.decks || []).find(candidate => candidate.id === activeDeck.parent);
    if (parent && !result.some(link => link.deck === parent.id)) {
      const section = (resolved.sections || []).find(candidate => candidate.deck === activeDeck.id);
      result.push({
        deck: parent.id,
        label: `Back to ${parent.title || parent.id}`,
        deckTitle: parent.title || parent.id,
        scene: section && (section.parentScene || section.parentSceneId) || null,
        section: section && (section.parentSection || section.parentSectionId || section.id) || null,
      });
    }
  }

  return result;
}
