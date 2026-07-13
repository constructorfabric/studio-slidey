<script setup>
// Interactive web-app root: loads a spec, wires the deck, renders DeckHost +
// NavController. Spec source priority: window.__SLIDEY_SPEC__ (embedded by the
// single-file build) → ?spec=<url> query param → workspace mode (slidey CLI
// viewer: /api/config + file-tree sidebar) → ./spec.json → a drop/file-picker
// overlay.
import { computed, provide, ref, shallowRef, onMounted, onUnmounted, watch, nextTick } from 'vue';
import DeckHost from './DeckHost.vue';
import NavController from './NavController.vue';
import FileTree from './FileTree.vue';
import SceneEditor from './SceneEditor.vue';
import RrwebPlayer from '../rrweb/RrwebPlayer.vue';
import ReferenceViewer from './ReferenceViewer.vue';
import { store } from '../store.js';
import { createDeck, resolveAssetHref } from '../useDeck.js';
import { installEmbedAnnotate } from '../embed-annotate.js';
import { installInlineEdit } from '../inline-edit.js';
import { initialViewFromSearch } from '../initial-view.js';
import { resolveDeckSpec, hierarchyPathForDeck, linksForScene, sceneSectionIds, SOURCE_DECK_ID } from '../collections.mjs';
import { chaptersFromEvents } from '../rrweb/chapters.js';
import { resolveEvidencePlaybackHref } from '../evidencePlayback.mjs';
import {
  audioUrlFromBase64,
  speechTextForScene,
  stepNarrationCues,
  narrationItemsForScene,
  timedNarrationCues,
} from '../narration.mjs';
import { stepsForScene } from '../sceneSteps.mjs';
import { normalizeReference, normalizeReferences } from '../reference-viewer.js';
import { classifyInlineRefTarget } from '../inline-links.js';
import { documentLanguageForSpec, documentTitleForSpec, sceneAnnouncement } from '../accessibility.mjs';
import FeedbackModal from '../feedback/vendor/feedback-vue/src/FeedbackModal.vue';
import {
  anchorFor as feedbackAnchorForDeck,
  slideyPrivacyManifest,
  buildContext as buildFeedbackContext,
  feedbackRouter,
  feedbackSinks,
  feedbackKindGroups,
} from '../feedback/slideyFeedback.js';

const deck = shallowRef(null);
const currentSpec = ref(null);
const sourceSpec = ref(null);
const error = ref('');
const loading = ref(true);

// Workspace (CLI viewer) state.
const workspace = ref(false);
// Embedded single-file preview (VS Code webview): no file-tree sidebar, and the
// deck auto-reloads when its spec changes on disk.
const embedded = ref(false);
const tree = shallowRef(null);       // { name, children: [...] }
const activePath = ref('');
const sidebarWidth = ref(300);
const editorWidth = ref(380);
const viewerMode = ref('browse');
const isEditMode = computed(() => viewerMode.value === 'edit');
const dirty = ref(false);
const saving = ref(false);
const saveError = ref('');
const isInlineEditing = ref(false);
const suppressDeckNavClick = ref(false);
const schema = shallowRef(null);
const sessionSpec = ref(null);         // snapshot of the latest loaded/reloaded spec
const activeSpecBaseUrl = ref('');     // base URL for currently open workspace spec
const activeSpecDir = ref('');         // POSIX workspace-relative dir for host-open actions
const activeSpecEditable = ref(true);
const directReplay = ref({
  active: false,
  loading: false,
  error: '',
  title: '',
  ref: '',
  href: '',
  events: [],
  chapters: [],
});
const cloning = ref(false);
const cloneError = ref('');
const activeReference = ref(null);
const feedbackOpen = ref(false);
const feedbackSink = ref('');
const feedbackManifest = slideyPrivacyManifest();
const feedbackRouterInstance = computed(() => {
  if (typeof window !== 'undefined') {
    window.__SLIDEY_FEEDBACK__ = { ...(window.__SLIDEY_FEEDBACK__ || {}), selectedSink: feedbackSink.value || feedbackSinks()[0]?.id };
  }
  return feedbackRouter();
});
const feedbackContext = computed(() => (feedbackOpen.value ? buildFeedbackContext() : null));
function feedbackAnchorFor(kind) {
  return feedbackAnchorForDeck(deck.value, currentSpec.value, kind);
}
function onFeedbackSubmitted() {
  window.setTimeout(() => { feedbackOpen.value = false; }, 1500);
}
function onFeedbackOverlayClick(e) {
  if (e.target === e.currentTarget) feedbackOpen.value = false;
}
function selectFeedbackSink(e) { feedbackSink.value = e.target.value; }
const collection = shallowRef(null);
const activeDeckId = ref(SOURCE_DECK_ID);
const compactViewport = ref(false);
const openCollectionMenu = ref('');
const libraryBackStack = ref([]);
const libraryForwardStack = ref([]);
// A collection is a set of independently navigable presentations. Keep their
// last positions here rather than treating the outgoing deck's index as a
// meaningful position in the newly selected deck.
const libraryDeckPositions = new Map();
const libraryDecks = computed(() => collection.value && collection.value.isCollection ? collection.value.decks : []);
const activeViewEditable = computed(() =>
  activeSpecEditable.value && (!collection.value || !collection.value.isCollection || collection.value.isSource));
const defaultDeckId = computed(() => {
  const library = sourceSpec.value && sourceSpec.value.library ? sourceSpec.value.library : {};
  return library.defaultDeck || library.activeDeck || '';
});
const collectionTitle = computed(() => {
  const spec = sourceSpec.value || {};
  const library = spec.library || {};
  return library.title || (spec.meta && spec.meta.title) || 'Collection';
});
const sourceSceneCount = computed(() => {
  const spec = sourceSpec.value || {};
  return Array.isArray(spec.scenes) ? spec.scenes.length : 0;
});
const activeSceneCount = computed(() => {
  const spec = currentSpec.value || {};
  return Array.isArray(spec.scenes) ? spec.scenes.length : 0;
});
const activeDeckInfo = computed(() => {
  const info = collection.value;
  if (!info || !info.isCollection) return null;
  return (info.decks || []).find(candidate => candidate.id === activeDeckId.value) || null;
});
const activeDeckTitle = computed(() => {
  const found = activeDeckInfo.value;
  return found ? found.title : activeDeckId.value;
});
const viewerTitle = computed(() => {
  if (activeDeckInfo.value) return activeDeckTitle.value;
  const meta = currentSpec.value && currentSpec.value.meta;
  return (meta && (meta.title || meta.name)) || 'Untitled deck';
});
const currentScene = computed(() => {
  const spec = currentSpec.value;
  const state = deck.value && deck.value.state;
  return spec && state && Array.isArray(spec.scenes) ? spec.scenes[state.sceneIndex] || null : null;
});
const currentSceneAnnouncement = computed(() => sceneAnnouncement(
  currentSpec.value,
  deck.value && deck.value.state,
));
const currentLinks = computed(() => linksForScene(currentScene.value, collection.value));
const compactWorkspace = computed(() => workspace.value && !embedded.value && viewerMode.value !== 'present' && compactViewport.value);
const rrwebModal = ref({
  open: false,
  loading: false,
  error: '',
  title: '',
  ref: '',
  href: '',
  events: [],
  chapters: [],
});
// Published single-file builds have no live edge-tts endpoint to call, but
// publish-deck.sh pre-renders narration audio for every scene/step and embeds
// it as window.__SLIDEY_NARRATION_AUDIO__ (see build-single.mjs) — when that
// table is present, narration preview works entirely from the embedded cache.
const hasEmbeddedNarrationAudio = typeof window !== 'undefined' && !!window.__SLIDEY_NARRATION_AUDIO__;
const narrationPreviewSupported = computed(() => workspace.value || embedded.value || hasEmbeddedNarrationAudio);
const narrationSpeaking = ref(false);
const narrationLoading = ref(false);
const liveNarration = ref(false);
const livePlaybackScope = ref('');
const livePlaybackStack = ref(null);
const narrationEnabled = ref(true);
const captionsEnabled = ref(true);
const liveCaption = ref('');
const narrationError = ref('');
// Producer-owned rrweb playback time. It is copied into an annotation anchor
// only while an rrweb scene is active; it is never interpreted by the host.
const rrwebTimeMs = ref(null);
const deckHasNarration = computed(() =>
  Boolean(currentSpec.value && Array.isArray(currentSpec.value.scenes)
    && currentSpec.value.scenes.some(scene => speechTextForScene(scene))));
const currentHasNarration = computed(() => Boolean(speechTextForScene(currentScene.value)));
const narrationState = computed(() => ({
  supported: narrationPreviewSupported.value,
  speaking: narrationSpeaking.value,
  loading: narrationLoading.value,
  live: liveNarration.value,
  playing: liveNarration.value,
  playScope: livePlaybackScope.value,
  narrationEnabled: narrationEnabled.value,
  captionsEnabled: captionsEnabled.value,
  hasSceneNarration: currentHasNarration.value,
  hasDeckNarration: deckHasNarration.value,
  error: narrationError.value,
}));
let narrationSeq = 0;
let narrationAbortController = null;
const activeNarrationControllers = new Set();
const activeNarrationAudio = new Set();
const narrationObjectUrls = new Set();
let liveNarrationTimer = null;
let liveAdvanceInProgress = false;
let sceneNarrationSeq = 0;
let sceneNarrationAdvanceInProgress = false;
let videoCueState = { key: '', cues: [], spoken: new Set() };
let videoCueNarrationChain = Promise.resolve();
const NARRATION_PREFETCH_AHEAD = 2;
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let narrationAudioElement = null;

function deckKind(option) {
  if (!option) return '';
  if (option.source) return 'Source';
  if (option.deckType === 'subset') return 'Subset';
  if (option.id === defaultDeckId.value) return 'Summary';
  if (option.deckType === 'hierarchy') return 'Deck';
  return 'Subset';
}

function isHierarchyDeckOption(option) {
  if (!option) return false;
  return Boolean(option.source || option.deckType === 'hierarchy');
}

function isSubsetDeckOption(option) {
  return Boolean(option && option.deckType === 'subset');
}

function deckSceneCount(deckId) {
  if (!sourceSpec.value || !deckId) return 0;
  if (deckId === SOURCE_DECK_ID) return sourceSceneCount.value;
  const resolved = resolveDeckSpec(sourceSpec.value, { deckId });
  if (resolved.errors && resolved.errors.length) return 0;
  return Array.isArray(resolved.spec && resolved.spec.scenes) ? resolved.spec.scenes.length : 0;
}

function deckMeta(option) {
  if (!option) return '';
  const parts = [];
  const count = option.sceneCount || deckSceneCount(option.id);
  if (option.deckType !== 'subset' && count) parts.push(`${count} slides`);
  const tags = [option.purpose, option.theme].filter(Boolean).join(' / ');
  if (tags) parts.push(tags);
  if (option.deckType === 'hierarchy' && option.parent && option.parent !== SOURCE_DECK_ID) {
    const parent = (libraryDecks.value || []).find(candidate => candidate.id === option.parent);
    if (parent) parts.push(`under ${parent.title}`);
  }
  if (option.deckType === 'subset' && option.parent) {
    const parent = (libraryDecks.value || []).find(candidate => candidate.id === option.parent);
    if (parent) parts.push(`under ${parent.title}`);
  }
  return parts.join(' · ');
}

const libraryDeckRows = computed(() => (libraryDecks.value || []).map(option => ({
  ...option,
  kind: deckKind(option),
  sceneCount: option.sceneCount || deckSceneCount(option.id),
  metaText: deckMeta(option),
})));

function deckLevel(option, byId) {
  if (!option || option.source) return 0;
  let level = 1;
  let parentId = option.parent;
  const seen = new Set([option.id]);
  while (parentId && parentId !== SOURCE_DECK_ID && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    level += 1;
    parentId = byId.get(parentId).parent;
  }
  return Math.min(level, 4);
}

const hierarchyDeckRows = computed(() => {
  const decks = libraryDeckRows.value || [];
  const byId = new Map(decks.map(item => [item.id, item]));
  return decks
    .filter(isHierarchyDeckOption)
    .map(option => ({
      ...option,
      level: deckLevel(option, byId),
    }));
});

const subsetDeckRows = computed(() => (libraryDeckRows.value || []).filter(isSubsetDeckOption));

const activeIsSubset = computed(() => Boolean(activeDeckInfo.value && isSubsetDeckOption(activeDeckInfo.value)));
const activeIsHierarchy = computed(() => Boolean(activeDeckInfo.value && isHierarchyDeckOption(activeDeckInfo.value)));

const activeHierarchyTrail = computed(() => {
  const decks = libraryDeckRows.value || [];
  const byId = new Map(decks.map(item => [item.id, item]));
  const source = decks.find(item => item.source) || null;
  const out = [];
  let cursor = activeDeckInfo.value;
  const seen = new Set();
  if (cursor && isSubsetDeckOption(cursor)) cursor = null;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    out.unshift(cursor);
    const parentId = cursor.parent;
    cursor = parentId && parentId !== SOURCE_DECK_ID ? byId.get(parentId) : null;
  }
  if (source && (!out.length || out[0].id !== source.id)) out.unshift(source);
  return out.length ? out : (source ? [source] : []);
});

const currentSectionTitle = computed(() => {
  const scene = currentScene.value;
  const info = collection.value;
  const sectionId = sceneSectionIds(scene)[0];
  if (!scene || !sectionId || !info || !info.isCollection) return '';
  const found = (info.sections || []).find(candidate => candidate.id === sectionId);
  return found ? found.title : sectionId;
});

const activeDeckStatus = computed(() => {
  const info = activeDeckInfo.value;
  if (!info) return '';
  const parts = [deckKind(info)];
  if (info.deckType === 'subset' && activeSceneCount.value) {
    parts.push(`${activeSceneCount.value} synced slides`);
  } else if (activeSceneCount.value) {
    parts.push(`${activeSceneCount.value} slides`);
  } else if (info.source && sourceSceneCount.value) {
    parts.push(`${sourceSceneCount.value} slides`);
  }
  if (info.deckType === 'hierarchy' && info.parent && info.parent !== SOURCE_DECK_ID) {
    const parent = (libraryDecks.value || []).find(candidate => candidate.id === info.parent);
    if (parent) parts.push(`under ${parent.title}`);
  }
  if (info.deckType === 'subset') {
    const tags = [info.purpose, info.theme].filter(Boolean).join(' / ');
    if (tags) parts.push(tags);
  } else if (sourceSceneCount.value) {
    const tags = [info.purpose, info.theme].filter(Boolean).join(' / ');
    if (tags) parts.push(tags);
  }
  if (currentSectionTitle.value) parts.push(currentSectionTitle.value);
  return parts.filter(Boolean).join(' · ');
});

function linkMeta(link) {
  if (!link) return '';
  const parts = [];
  if (link.section) {
    const found = (collection.value && collection.value.sections || []).find(section => section.id === String(link.section));
    parts.push(found && found.title ? found.title : String(link.section));
  }
  if (link.deckTitle) parts.push(link.deckTitle);
  return parts.join(' -> ');
}

function deckOptionById(deckId) {
  return (libraryDeckRows.value || []).find(option => option.id === deckId) || null;
}

const hierarchyLinkRows = computed(() => currentLinks.value
  .filter(link => isHierarchyDeckOption(deckOptionById(link.deck)))
  .map(link => {
    const active = activeDeckInfo.value;
    const relation = active && active.parent === link.deck ? 'Parent' : 'Go deeper';
    return {
      ...link,
      relation,
      metaText: linkMeta(link),
    };
  }));

const subsetLinkRows = computed(() => currentLinks.value
  .filter(link => isSubsetDeckOption(deckOptionById(link.deck)))
  .map(link => ({
    ...link,
    metaText: linkMeta(link),
  })));

const activeHierarchySummary = computed(() => {
  let trail = activeHierarchyTrail.value || [];
  if (trail.length > 2 && trail[0] && trail[0].source) trail = trail.slice(1);
  if (!trail.length) return activeDeckTitle.value;
  return trail.map(crumb => crumb.title).join(' / ');
});

// Keep the current deck's title separate from the path: hierarchy paths can
// get long, while the deck title needs to remain the dominant orientation cue.
const activeHierarchyOverlayTrail = computed(() => activeHierarchyTrail.value || []);

const activeSubsetSummary = computed(() => {
  if (activeIsSubset.value) return activeDeckTitle.value;
  const count = subsetDeckRows.value.length;
  return count ? `${count} view${count === 1 ? '' : 's'}` : 'None';
});

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function stringOrNull(value) {
  const found = firstPresent(value);
  return found == null ? null : String(found);
}

function sectionTitle(sectionId) {
  if (!sectionId) return '';
  const found = (collection.value && collection.value.sections || [])
    .find(section => section.id === String(sectionId));
  return found && found.title ? found.title : String(sectionId);
}

function currentSceneTitle() {
  const scene = currentScene.value;
  if (!scene) return '';
  return scene.title || scene.heading || scene.label || scene.eyebrow || '';
}

function currentLibraryLocation() {
  const state = deck.value && deck.value.state;
  const scene = currentScene.value;
  const sections = sceneSectionIds(scene);
  const section = sections[0] || null;
  const sceneId = scene
    ? firstPresent(scene._library && scene._library.sourceId, scene.id, scene.key)
    : null;
  const deckTitle = activeDeckTitle.value || activeDeckId.value;
  const foundSectionTitle = currentSectionTitle.value || sectionTitle(section);
  const foundSceneTitle = currentSceneTitle();
  return {
    deck: activeDeckId.value,
    scene: stringOrNull(sceneId),
    section: stringOrNull(section),
    step: state ? state.stepIndex : null,
    label: foundSectionTitle || foundSceneTitle || deckTitle,
    deckTitle,
    sectionTitle: foundSectionTitle,
    sceneTitle: foundSceneTitle,
  };
}

function decorateLibraryLocation(raw) {
  if (!raw || !raw.deck) return null;
  const deckId = String(raw.deck);
  const option = deckOptionById(deckId);
  const section = stringOrNull(firstPresent(raw.section, raw.sectionId));
  const deckTitle = raw.deckTitle || (option && option.title) || deckId;
  const foundSectionTitle = raw.sectionTitle || sectionTitle(section);
  const foundSceneTitle = raw.sceneTitle || '';
  const rawStep = firstPresent(raw.step, raw.stepIndex);
  const step = rawStep == null || Number.isNaN(Number(rawStep)) ? null : Math.max(0, Math.floor(Number(rawStep)));
  return {
    deck: deckId,
    scene: stringOrNull(firstPresent(raw.scene, raw.sceneId)),
    section,
    step,
    label: raw.label || raw.title || foundSectionTitle || foundSceneTitle || deckTitle,
    deckTitle,
    sectionTitle: foundSectionTitle,
    sceneTitle: foundSceneTitle,
  };
}

function affordanceForLocation(raw, kind) {
  const location = decorateLibraryLocation(raw);
  if (!location) return null;
  const context = firstPresent(
    location.sectionTitle && location.sectionTitle !== location.deckTitle ? location.sectionTitle : null,
    location.sceneTitle && location.sceneTitle !== location.deckTitle ? location.sceneTitle : null,
    location.label && location.label !== location.deckTitle ? location.label : null,
  );
  return {
    ...location,
    action: kind === 'down' ? 'Return down' : 'Back up',
    title: location.deckTitle || location.label || location.deck,
    context: context ? String(context) : '',
  };
}

function stackTop(stack) {
  return stack && stack.length ? stack[stack.length - 1] : null;
}

const libraryBackAffordance = computed(() => affordanceForLocation(stackTop(libraryBackStack.value), 'up'));
const libraryForwardAffordance = computed(() => affordanceForLocation(stackTop(libraryForwardStack.value), 'down'));

function isSameLibraryLocation(a, b) {
  if (!a || !b || a.deck !== b.deck) return false;
  const aScene = a.scene || '';
  const bScene = b.scene || '';
  const aSection = a.section || '';
  const bSection = b.section || '';
  if (aScene && bScene && aScene !== bScene) return false;
  if (aSection && bSection && aSection !== bSection) return false;
  return true;
}

function trimStackThroughTarget(stack, target) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (isSameLibraryLocation(stack[i], target)) return stack.slice(0, i);
  }
  return stack;
}

function isDeckAncestor(ancestorId, deckId) {
  if (!ancestorId || !deckId || ancestorId === deckId) return false;
  const decks = libraryDeckRows.value || [];
  const byId = new Map(decks.map(item => [item.id, item]));
  let cursor = byId.get(deckId);
  const seen = new Set([deckId]);
  while (cursor) {
    const parent = cursor.source ? null : (cursor.parent || SOURCE_DECK_ID);
    if (!parent || seen.has(parent)) return false;
    if (parent === ancestorId) return true;
    seen.add(parent);
    cursor = byId.get(parent);
  }
  return false;
}

function relationToDeck(targetDeckId) {
  const currentDeckId = activeDeckId.value;
  if (isDeckAncestor(targetDeckId, currentDeckId)) return 'up';
  if (isDeckAncestor(currentDeckId, targetDeckId)) return 'down';
  return 'across';
}

function capStack(stack) {
  return stack.slice(Math.max(0, stack.length - 8));
}

function commitLibraryNavigationTrail(origin, target, mode) {
  if (!origin || !target) return;
  const back = libraryBackStack.value.slice();
  const forward = libraryForwardStack.value.slice();
  if (mode === 'back') {
    back.pop();
    libraryBackStack.value = back;
    libraryForwardStack.value = capStack([...forward, origin]);
    return;
  }
  if (mode === 'forward') {
    libraryBackStack.value = capStack([...back, origin]);
    libraryForwardStack.value = forward.slice(0, -1);
    return;
  }

  if (relationToDeck(target.deck) === 'up') {
    libraryBackStack.value = trimStackThroughTarget(back, target);
    libraryForwardStack.value = [origin];
    return;
  }

  libraryBackStack.value = capStack([...back, origin]);
  libraryForwardStack.value = [];
}

function resetLibraryNavigationTrail() {
  libraryBackStack.value = [];
  libraryForwardStack.value = [];
}

function rememberLibraryDeckPosition(deckId = activeDeckId.value, state = deck.value && deck.value.state) {
  if (!deckId || !state) return;
  libraryDeckPositions.set(deckId, {
    sceneIndex: state.sceneIndex,
    stepIndex: state.stepIndex,
  });
}

function resetLibraryDeckPositions() {
  libraryDeckPositions.clear();
}

function toggleCollectionMenu(menu) {
  openCollectionMenu.value = openCollectionMenu.value === menu ? '' : menu;
}

function closeCollectionMenu() {
  openCollectionMenu.value = '';
}

function onWindowKeydown(e) {
  if (e.key === 'Escape' && rrwebModal.value.open) {
    closeRrwebModal();
    return;
  }
  if (e.key === 'Escape') closeCollectionMenu();
}

function onWindowClick() {
  closeCollectionMenu();
}

function clearLiveNarrationTimer() {
  if (liveNarrationTimer) {
    clearTimeout(liveNarrationTimer);
    liveNarrationTimer = null;
  }
}

function resetVideoCueState() {
  videoCueState = { key: '', cues: [], spoken: new Set() };
  videoCueNarrationChain = Promise.resolve();
}

function currentNarrationMeta() {
  const spec = currentSpec.value || sourceSpec.value || {};
  return (spec.meta && spec.meta.narration) || {};
}

function updateNarrationActivity() {
  narrationSpeaking.value = narrationLoading.value || activeNarrationAudio.size > 0;
}

function revokeNarrationUrl(url) {
  if (!url || !narrationObjectUrls.has(url)) return;
  narrationObjectUrls.delete(url);
  try { URL.revokeObjectURL(url); } catch (_) {}
}

function reusableNarrationAudio() {
  if (!narrationAudioElement) {
    narrationAudioElement = new Audio();
    narrationAudioElement.preload = 'auto';
    narrationAudioElement.playsInline = true;
  }
  return narrationAudioElement;
}

function primeNarrationPlaybackForGesture() {
  const audio = reusableNarrationAudio();
  try {
    audio.pause();
    audio.muted = true;
    audio.src = SILENT_WAV_DATA_URL;
    const started = audio.play();
    if (started && typeof started.then === 'function') {
      started
        .then(() => {
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch (_) {}
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
    } else {
      audio.muted = false;
    }
  } catch (_) {
    audio.muted = false;
  }
}

function resetNarrationForUserGesture() {
  stopNarrationAudioOnly();
  primeNarrationPlaybackForGesture();
}

function stopNarrationAudioOnly() {
  narrationSeq += 1;
  if (narrationAbortController) {
    try { narrationAbortController.abort(); } catch (_) {}
    narrationAbortController = null;
  }
  for (const controller of Array.from(activeNarrationControllers)) {
    try { controller.abort(); } catch (_) {}
  }
  activeNarrationControllers.clear();
  narrationLoading.value = false;
  for (const audio of activeNarrationAudio) {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (_) {}
  }
  activeNarrationAudio.clear();
  for (const url of Array.from(narrationObjectUrls)) revokeNarrationUrl(url);
  updateNarrationActivity();
}

function stopNarration(opts = {}) {
  sceneNarrationSeq += 1;
  liveNarration.value = false;
  livePlaybackScope.value = '';
  livePlaybackStack.value = null;
  liveCaption.value = '';
  clearLiveNarrationTimer();
  resetVideoCueState();
  stopNarrationAudioOnly();
  if (opts.pauseVideo !== false && currentScene.value && currentScene.value.type === 'video') {
    try {
      window.dispatchEvent(new CustomEvent('slidey:video-command', { detail: { action: 'pause' } }));
    } catch (_) { /* no active video scene */ }
  }
}

function setNarrationEnabled(enabled) {
  const nextEnabled = Boolean(enabled);
  if (narrationEnabled.value === nextEnabled) return;
  narrationEnabled.value = nextEnabled;

  // Audio cancellation increments narrationSeq, which correctly stops the
  // current utterance but used to make the reveal-playback loop interpret the
  // toggle as a terminal failure. Restart that loop at the *next* reveal so
  // automatic slide/deck playback keeps moving under the newly chosen mode.
  // Video playback is already independent of cue audio: its time events simply
  // start (or skip) later cues according to narrationEnabled.
  const scene = currentScene.value;
  if (liveNarration.value && scene && scene.type !== 'video') {
    sceneNarrationSeq += 1;
    clearLiveNarrationTimer();
    resetVideoCueState();
    stopNarrationAudioOnly();
    nextTick(() => runLiveNarrationForCurrent({ resumeAfterCurrentStep: true }));
    return;
  }
  if (!narrationEnabled.value) stopNarrationAudioOnly();
}

function setCaptionsEnabled(enabled) {
  captionsEnabled.value = Boolean(enabled);
  if (!captionsEnabled.value) liveCaption.value = '';
}

// Mirrors src/narration-preview.js's normalizeMeta() defaults — kept tiny and
// duplicated deliberately, since that file is CJS/Node-only (requires
// 'child_process' via ./narration.js) and can't be imported into this bundle.
function narrationVoiceRateFor(meta) {
  const voice = String((meta && meta.voice) || 'en-AU-NatashaNeural').trim() || 'en-AU-NatashaNeural';
  const rate = String((meta && meta.rate) || '').trim() || '+0%';
  return { voice, rate };
}

function embeddedNarrationAudio(text) {
  const table = hasEmbeddedNarrationAudio ? window.__SLIDEY_NARRATION_AUDIO__ : null;
  if (!table) return null;
  const { voice, rate } = narrationVoiceRateFor(currentNarrationMeta());
  const key = JSON.stringify({ text: String(text || ''), voice, rate });
  return table[key] || null;
}

async function requestNarrationAudio(text, signal) {
  const cached = embeddedNarrationAudio(text);
  if (cached && cached.audioBase64) {
    const url = audioUrlFromBase64(cached.audioBase64, cached.mime || 'audio/mpeg');
    narrationObjectUrls.add(url);
    return url;
  }
  const res = await fetch('/api/narration-audio', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: String(text || ''), meta: currentNarrationMeta() }),
    signal,
  });
  let payload = {};
  try {
    payload = await res.json();
  } catch (_) {
    payload = {};
  }
  if (!res.ok) {
    throw new Error(payload.error || `edge-tts narration failed (${res.status})`);
  }
  if (!payload.audioBase64) throw new Error('edge-tts narration response did not include audio');
  const url = audioUrlFromBase64(payload.audioBase64, payload.mime || 'audio/mpeg');
  narrationObjectUrls.add(url);
  return url;
}

async function requestNarrationAudioWithController(text, controller) {
  activeNarrationControllers.add(controller);
  narrationLoading.value = true;
  updateNarrationActivity();
  try {
    return await requestNarrationAudio(text, controller.signal);
  } finally {
    activeNarrationControllers.delete(controller);
    if (narrationAbortController === controller) narrationAbortController = null;
    narrationLoading.value = activeNarrationControllers.size > 0;
    updateNarrationActivity();
  }
}

function playNarrationUrl(url, token, opts = {}) {
  return new Promise((resolve) => {
    const audio = reusableNarrationAudio();
    try {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.onloadedmetadata = null;
      audio.oncanplay = null;
      audio.muted = false;
      audio.src = url;
    } catch (_) {}
    activeNarrationAudio.add(audio);
    updateNarrationActivity();
    let settled = false;
    let started = false;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      activeNarrationAudio.delete(audio);
      revokeNarrationUrl(url);
      updateNarrationActivity();
      if (token !== narrationSeq) {
        resolve(false);
        return;
      }
      if (err) narrationError.value = String(err.message || err);
      if (ok && typeof opts.onDone === 'function') opts.onDone();
      resolve(ok);
    };
    const startPlayback = () => {
      if (started || settled) return;
      started = true;
      if (typeof opts.onStart === 'function') {
        try { opts.onStart(audio); } catch (_) {}
      }
      audio.play().catch(err => finish(false, err));
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false, new Error('Could not play edge-tts narration audio'));
    audio.onloadedmetadata = startPlayback;
    audio.oncanplay = startPlayback;
    audio.load();
  });
}

async function speakText(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (!narrationPreviewSupported.value) {
    narrationError.value = 'Edge TTS preview is available in the Slidey web viewer and VS Code preview.';
    return false;
  }
  const cancelFirst = opts.cancel !== false;
  if (cancelFirst) stopNarrationAudioOnly();
  const token = narrationSeq;
  const controller = new AbortController();
  if (cancelFirst) narrationAbortController = controller;
  narrationError.value = '';
  try {
    const url = await requestNarrationAudioWithController(raw, controller);
    if (token !== narrationSeq) {
      revokeNarrationUrl(url);
      return false;
    }
    return await playNarrationUrl(url, token, opts);
  } catch (err) {
    if (token === narrationSeq && (!err || err.name !== 'AbortError')) {
      narrationError.value = String(err && err.message ? err.message : err);
    }
    return false;
  } finally {
    updateNarrationActivity();
  }
}

function preloadNarrationCue(item, audioToken, sceneToken) {
  if (!item || !item.cue) return null;
  if (item.audio) return item.audio;
  const controller = new AbortController();
  const promise = requestNarrationAudioWithController(item.cue, controller)
    .then(url => {
      if (audioToken !== narrationSeq || sceneToken !== sceneNarrationSeq) {
        revokeNarrationUrl(url);
        return null;
      }
      return url;
    })
    .catch(err => {
      if (audioToken === narrationSeq && sceneToken === sceneNarrationSeq && (!err || err.name !== 'AbortError')) {
        item.error = err;
      }
      return null;
    });
  item.audio = { controller, promise };
  return item.audio;
}

function primeNarrationBuffer(items, index, audioToken, sceneToken) {
  for (let i = index; i < Math.min(items.length, index + NARRATION_PREFETCH_AHEAD + 1); i += 1) {
    preloadNarrationCue(items[i], audioToken, sceneToken);
  }
}

async function waitForNarrationCue(item, audioToken, sceneToken) {
  if (!item || !item.cue) return '';
  const entry = preloadNarrationCue(item, audioToken, sceneToken);
  const url = entry ? await entry.promise : '';
  if (audioToken !== narrationSeq || sceneToken !== sceneNarrationSeq) return '';
  if (!url) {
    const detail = item.error && item.error.message ? item.error.message : item.error;
    narrationError.value = detail ? `Narration paused: ${detail}` : 'Narration paused: audio for the next reveal was not available.';
    return '';
  }
  return url;
}

async function playBufferedNarrationSteps(items, sceneToken) {
  if (!Array.isArray(items) || !items.length) return false;
  if (!narrationPreviewSupported.value) {
    narrationError.value = 'Edge TTS preview is available in the Slidey web viewer and VS Code preview.';
    return false;
  }
  const audioToken = narrationSeq;
  narrationError.value = '';
  primeNarrationBuffer(items, 0, audioToken, sceneToken);
  for (let i = 0; i < items.length; i += 1) {
    if (audioToken !== narrationSeq || sceneToken !== sceneNarrationSeq) return false;
    primeNarrationBuffer(items, i, audioToken, sceneToken);
    const item = items[i];
    const url = await waitForNarrationCue(item, audioToken, sceneToken);
    if (audioToken !== narrationSeq || sceneToken !== sceneNarrationSeq) return false;
    if (item.cue && !url) {
      stopNarrationAudioOnly();
      return false;
    }
    if (captionsEnabled.value) liveCaption.value = item.cue || '';
    const ok = await goForSceneNarration(item.pos, sceneToken);
    if (!ok) return false;
    if (url) {
      const played = await playNarrationUrl(url, audioToken);
      if (!played) {
        stopNarrationAudioOnly();
        return false;
      }
    } else {
      const stillCurrent = await delaySceneNarration(item.delayMs || 650, sceneToken);
      if (!stillCurrent) return false;
    }
  }
  return true;
}

async function playRevealStepsWithoutNarration(scene, token, startStepIndex = 0) {
  if (!deck.value || !scene) return false;
  const state = deck.value.state;
  const sceneIndex = state ? state.sceneIndex : 0;
  const steps = stepsForScene(scene);
  const startPos = deck.value.posForScene(sceneIndex, 0);
  const cues = stepNarrationCues(scene, steps);
  for (let i = Math.max(0, startStepIndex); i < steps.length; i += 1) {
    if (token !== sceneNarrationSeq) return false;
    if (captionsEnabled.value) liveCaption.value = String(cues[i] || '').trim();
    const ok = await goForSceneNarration(startPos + i, token);
    if (!ok) return false;
    const stillCurrent = await delaySceneNarration(scene.type === 'graph' ? 760 : 650, token);
    if (!stillCurrent) return false;
  }
  return true;
}

function videoCueKey() {
  const state = deck.value && deck.value.state;
  return `${activeDeckId.value}:${state ? state.sceneIndex : 0}:${store.sceneNonce}`;
}

function armVideoCueNarration(scene) {
  const cues = Array.isArray(scene && scene.narration)
    ? timedNarrationCues(scene, store.rrwebChapters || [])
    : [];
  videoCueState = { key: videoCueKey(), cues, spoken: new Set() };
}

async function advanceLiveNarration() {
  clearLiveNarrationTimer();
  if (!liveNarration.value || !deck.value) return;
  const state = deck.value.state;
  if (!state || livePlaybackScope.value === 'slide') {
    liveNarration.value = false;
    livePlaybackScope.value = '';
    livePlaybackStack.value = null;
    narrationSpeaking.value = false;
    liveCaption.value = '';
    resetVideoCueState();
    return;
  }
  if (state.sceneIndex + 1 >= state.sceneCount) {
    const stack = livePlaybackStack.value;
    const nextIndex = stack && stack.index + 1;
    if (livePlaybackScope.value === 'stack' && stack && nextIndex < stack.deckIds.length) {
      livePlaybackStack.value = { ...stack, index: nextIndex };
      liveNarration.value = false;
      try {
        const changed = await switchLibraryDeck(stack.deckIds[nextIndex], null, {
          preservePlayback: true,
          restart: true,
        });
        if (!changed) throw new Error('Could not load the next hierarchy deck');
        liveNarration.value = true;
        livePlaybackScope.value = 'stack';
        sceneNarrationSeq += 1;
        await nextTick();
        runLiveNarrationForCurrent();
      } catch (err) {
        stopNarration();
        narrationError.value = String(err.message || err);
      }
      return;
    }
    liveNarration.value = false;
    livePlaybackScope.value = '';
    livePlaybackStack.value = null;
    narrationSpeaking.value = false;
    liveCaption.value = '';
    resetVideoCueState();
    return;
  }
  liveAdvanceInProgress = true;
  try {
    await deck.value.gotoScene(state.sceneIndex + 1);
    sceneNarrationSeq += 1;
    await nextTick();
    runLiveNarrationForCurrent();
  } finally {
    liveAdvanceInProgress = false;
  }
}

function delaySceneNarration(ms, token) {
  return new Promise(resolve => {
    window.setTimeout(() => resolve(token === sceneNarrationSeq), Math.max(0, Number(ms || 0)));
  });
}

async function goForSceneNarration(pos, token) {
  if (!deck.value || token !== sceneNarrationSeq) return false;
  sceneNarrationAdvanceInProgress = true;
  try {
    await deck.value.go(pos);
    await nextTick();
  } finally {
    sceneNarrationAdvanceInProgress = false;
  }
  return token === sceneNarrationSeq;
}

async function playCurrentSceneByReveal(scene, token, startStepIndex = 0) {
  if (!deck.value || !scene) return false;
  const state = deck.value.state;
  const sceneIndex = state ? state.sceneIndex : 0;
  const { steps, items: rawItems, wholeSceneText } = narrationItemsForScene(scene, { startStepIndex });
  if (!steps.length) {
    if (wholeSceneText) return speakText(wholeSceneText, { cancel: false });
    const stillCurrent = await delaySceneNarration(1200, token);
    return stillCurrent;
  }

  const startPos = deck.value.posForScene(sceneIndex, 0);
  const items = rawItems.map(item => ({ ...item, pos: startPos + item.index }));
  if (!items.length) return true;
  return playBufferedNarrationSteps(items, token);
}

function runLiveNarrationForCurrent(opts = {}) {
  if (!liveNarration.value || !deck.value) return;
  clearLiveNarrationTimer();
  resetVideoCueState();
  const scene = currentScene.value || {};
  if (scene.type === 'video') {
    armVideoCueNarration(scene);
    if (typeof scene.narration === 'string' && scene.narration.trim()) {
      if (captionsEnabled.value) liveCaption.value = scene.narration.trim();
    }
    if (narrationEnabled.value && narrationPreviewSupported.value && typeof scene.narration === 'string' && scene.narration.trim()) {
      speakText(scene.narration, { cancel: false });
    } else {
      narrationLoading.value = false;
      updateNarrationActivity();
    }
    nextTick(() => {
      try {
        window.dispatchEvent(new CustomEvent('slidey:video-command', { detail: { action: 'play' } }));
      } catch (_) { /* no active video scene */ }
    });
    const durationMs = Number(scene.duration || 0) * 1000;
    if (durationMs > 0) {
      liveNarrationTimer = setTimeout(advanceLiveNarration, durationMs + 500);
    }
    return;
  }
  const token = sceneNarrationSeq;
  const steps = stepsForScene(scene);
  const text = speechTextForScene(scene);
  const state = deck.value.state;
  const startStepIndex = opts.resumeAfterCurrentStep && state
    ? Math.min(steps.length, state.stepIndex + 1)
    : 0;
  if (text || steps.length) {
    const play = narrationEnabled.value && narrationPreviewSupported.value
      ? playCurrentSceneByReveal(scene, token, startStepIndex)
      : playRevealStepsWithoutNarration(scene, token, startStepIndex);
    play.then(ok => {
      if (ok && liveNarration.value && token === sceneNarrationSeq) advanceLiveNarration();
    });
  } else {
    narrationLoading.value = false;
    updateNarrationActivity();
    liveNarrationTimer = setTimeout(advanceLiveNarration, 1200);
  }
}

function listenCurrentNarration() {
  sceneNarrationSeq += 1;
  const token = sceneNarrationSeq;
  liveNarration.value = false;
  clearLiveNarrationTimer();
  resetVideoCueState();
  resetNarrationForUserGesture();
  const scene = currentScene.value;
  const text = speechTextForScene(scene);
  if (!text) {
    narrationError.value = 'This slide has no narration.';
    return;
  }
  playCurrentSceneByReveal(scene, token);
}

function startLiveNarration(scope = 'deck') {
  sceneNarrationSeq += 1;
  if (!deck.value) return;
  if (scope === 'stack') {
    const deckIds = hierarchyPathForDeck(libraryDeckRows.value, activeDeckId.value);
    if (!deckIds.length) return;
    if (narrationEnabled.value && narrationPreviewSupported.value) resetNarrationForUserGesture();
    clearLiveNarrationTimer();
    resetVideoCueState();
    livePlaybackStack.value = { deckIds, index: 0 };
    liveNarration.value = false;
    livePlaybackScope.value = 'stack';
    liveCaption.value = '';
    narrationError.value = '';
    switchLibraryDeck(deckIds[0], null, { preservePlayback: true, restart: true }).then(changed => {
      if (!changed) {
        livePlaybackStack.value = null;
        narrationError.value = 'Could not start hierarchy stack playback.';
        return;
      }
      liveNarration.value = true;
      livePlaybackScope.value = 'stack';
      sceneNarrationSeq += 1;
      nextTick(runLiveNarrationForCurrent);
    });
    return;
  }
  livePlaybackStack.value = null;
  if (narrationEnabled.value && narrationPreviewSupported.value) resetNarrationForUserGesture();
  liveNarration.value = true;
  livePlaybackScope.value = scope === 'slide' ? 'slide' : 'deck';
  liveCaption.value = '';
  narrationError.value = '';
  runLiveNarrationForCurrent();
}

function onVideoTime(e) {
  const ms = Number(e && e.detail && e.detail.ms);
  rrwebTimeMs.value = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null;
  if (!liveNarration.value) return;
  const scene = currentScene.value || {};
  if (scene.type !== 'video') return;
  if (videoCueState.key !== videoCueKey()) armVideoCueNarration(scene);
  if (!videoCueState.cues.length) return;
  const seconds = Math.max(0, Number(e && e.detail && e.detail.ms || 0) / 1000);
  for (const cue of videoCueState.cues) {
    if (videoCueState.spoken.has(cue.key)) continue;
    if (seconds + 0.12 >= cue.at) {
      videoCueState.spoken.add(cue.key);
      if (captionsEnabled.value) liveCaption.value = cue.text;
      videoCueNarrationChain = videoCueNarrationChain
        .then(() => {
          if (!liveNarration.value || currentScene.value !== scene || videoCueState.key !== videoCueKey()) return false;
          return narrationEnabled.value && narrationPreviewSupported.value
            ? speakText(cue.text, { cancel: false })
            : false;
        })
        .catch(() => false);
    }
  }
}

async function onVideoEnded() {
  if (liveNarration.value && currentScene.value && currentScene.value.type === 'video') {
    try { await videoCueNarrationChain; } catch (_) {}
    advanceLiveNarration();
  }
}

watch(() => {
  const state = deck.value && deck.value.state;
  return state ? `${activeDeckId.value}:${state.sceneIndex}:${state.pos}` : '';
}, () => {
  if (sceneNarrationAdvanceInProgress || liveAdvanceInProgress) return;
  sceneNarrationSeq += 1;
  clearLiveNarrationTimer();
  resetVideoCueState();
  stopNarrationAudioOnly();
  if (liveNarration.value && !liveAdvanceInProgress) {
    nextTick(runLiveNarrationForCurrent);
  }
});
// Live on-disk reload: poll the open spec's mtime and offer a reload when it
// changes underneath us. A failed reload never tears down the session — it
// surfaces a transient message and leaves the current deck on screen.
const stale = ref(false);            // on-disk version differs from the loaded one
const reloadError = ref('');         // transient toast when a reload attempt fails
const reloading = ref(false);
// Save conflict (concurrent edit): set when the server rejects a save because
// the file changed on disk since we loaded it. Holds the on-disk version so the
// user can resolve it as OURS (overwrite) or THEIRS (discard local + reload).
const conflict = ref(null);          // { theirsSpec, theirsVersion } | null
let loadedMtime = 0;                 // mtime of the spec currently rendered
let latestMtime = 0;                 // most recent mtime observed on disk
let loadedVersion = '';              // content version of the spec currently rendered
let latestVersion = '';              // most recent content version observed on disk
let pollTimer = null;
let errTimer = null;
const POLL_MS = 1500;
const activeLocale = (() => {
  try {
    return new URLSearchParams(window.location.search).get('locale') || '';
  } catch (_) {
    return '';
  }
})();

function inferMode(spec) {
  if (spec.meta && spec.meta.mode) return spec.meta.mode;
  return (spec.scenes || []).some(scene => scene && scene.type === 'request') ? 'api' : 'pitch';
}

function isEditableResponse(data, rel) {
  if (typeof data.editable === 'boolean') return data.editable;
  if (/\.readonly\.slidey\.json$/i.test(rel || '')) return false;
  return /\.json$/i.test(rel || '');
}

function cloneSpec(raw) {
  return JSON.parse(JSON.stringify(raw));
}

function emptyDirectReplay() {
  return {
    active: false,
    loading: false,
    error: '',
    title: '',
    ref: '',
    href: '',
    events: [],
    chapters: [],
  };
}

function resetDirectReplay() {
  directReplay.value = emptyDirectReplay();
  document.body.classList.remove('slidey-replay-mode');
}

function applySpecMeta(data, rel) {
  activeSpecEditable.value = activeLocale ? false : isEditableResponse(data, rel);
  cloneError.value = '';
  if (!activeViewEditable.value && isEditMode.value) setViewerMode('browse');
}

function deckIdFromSearch() {
  try {
    return new URLSearchParams(window.location.search).get('deck') || null;
  } catch (_) {
    return null;
  }
}

function targetPosition(nextDeck, spec, target) {
  if (!target || !spec || !Array.isArray(spec.scenes)) return null;
  const wantScene = target.scene || target.sceneId || null;
  const wantSection = target.section || target.sectionId || null;
  const rawStep = firstPresent(target.step, target.stepIndex);
  const wantStep = rawStep == null || Number.isNaN(Number(rawStep)) ? 0 : Math.max(0, Math.floor(Number(rawStep)));
  if (!wantScene && !wantSection) return null;
  const sceneNeedle = wantScene != null ? String(wantScene) : null;
  const sectionNeedle = wantSection != null ? String(wantSection) : null;
  const idx = spec.scenes.findIndex((scene) => {
    if (!scene) return false;
    if (sceneNeedle && (String(scene.id || '') === sceneNeedle || (scene._library && String(scene._library.sourceId || '') === sceneNeedle))) return true;
    if (sectionNeedle && sceneSectionIds(scene).includes(sectionNeedle)) return true;
    return false;
  });
  return idx >= 0 ? nextDeck.posForScene(idx, wantStep) : null;
}

async function loadSpec(spec, baseUrl, restore, opts = {}) {
  resetDirectReplay();
  if (!opts.preservePlayback) stopNarration({ pauseVideo: false });
  const resolved = resolveDeckSpec(spec, { deckId: opts.deckId });
  if (resolved.errors && resolved.errors.length) {
    throw new Error(resolved.errors.join('; '));
  }
  const renderSpec = resolved.isCollection && !resolved.isSource ? resolved.spec : spec;
  if (!renderSpec || !Array.isArray(renderSpec.scenes) || !renderSpec.scenes.length) {
    throw new Error('spec must have a non-empty "scenes" array');
  }
  sourceSpec.value = spec;
  currentSpec.value = renderSpec;
  document.documentElement.lang = documentLanguageForSpec(renderSpec);
  document.title = documentTitleForSpec(renderSpec);
  collection.value = resolved;
  activeDeckId.value = resolved.deckId || SOURCE_DECK_ID;
  store.setMeta(renderSpec.meta || {});
  store.setMode(inferMode(renderSpec));
  activeSpecBaseUrl.value = baseUrl || '';
  if (opts.resetSession !== false) {
    sessionSpec.value = cloneSpec(spec);
    dirty.value = false;
    resetLibraryNavigationTrail();
    resetLibraryDeckPositions();
  }
  saveError.value = '';
  if (!activeViewEditable.value && isEditMode.value) setViewerMode('browse');
  const d = createDeck(currentSpec.value, baseUrl);
  // Preserve the viewer's place across a reload: map the prior scene/step onto
  // the closest position in the freshly-loaded deck before the first render, so
  // there's no flash back to the start.
  const targetPos = targetPosition(d, renderSpec, opts.target);
  if (targetPos != null) {
    d.state.pos = Math.max(0, Math.min(d.state.total - 1, targetPos));
  } else if (restore) {
    d.state.pos = Math.max(0, Math.min(d.state.total - 1,
      d.posForScene(restore.sceneIndex, restore.stepIndex)));
  }
  await d.render();
  deck.value = d;
  fitScale();
  error.value = '';
}

function setActiveSpecDir(dir) {
  activeSpecDir.value = String(dir || '').replace(/^\/+|\/+$/g, '');
}

function directReplayTitle(spec, scene, rel) {
  return (spec && spec.meta && spec.meta.title)
    || (scene && scene.title)
    || String(rel || '').split('/').pop()
    || 'Session replay';
}

async function loadDirectReplay(spec, baseUrl, rel, opts = {}) {
  stopNarration({ pauseVideo: false });
  const scene = spec && Array.isArray(spec.scenes) ? spec.scenes[0] || {} : {};
  if (!scene.rrweb) throw new Error('rrweb replay spec did not include a replay source');
  const href = new URL(scene.rrweb, baseUrl || window.location.href).href;

  deck.value = null;
  sourceSpec.value = spec;
  currentSpec.value = spec;
  collection.value = null;
  activeDeckId.value = SOURCE_DECK_ID;
  activeSpecBaseUrl.value = baseUrl || '';
  store.setMeta((spec && spec.meta) || {});
  store.setMode('pitch');
  store.scene = null;
  store.sceneType = null;
  store.hidePitch();
  store.rrwebEvents = [];
  store.rrwebChapters = [];
  if (opts.resetSession !== false) {
    sessionSpec.value = cloneSpec(spec);
    dirty.value = false;
    resetLibraryNavigationTrail();
  }
  saveError.value = '';
  document.body.classList.add('slidey-replay-mode');
  directReplay.value = {
    active: true,
    loading: true,
    error: '',
    title: directReplayTitle(spec, scene, rel),
    ref: rel || scene.rrweb,
    href,
    events: [],
    chapters: [],
  };

  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`${res.status} loading ${scene.rrweb}`);
    const raw = await res.json();
    const events = rrwebEventsFromPayload(raw);
    if (events.length < 2) throw new Error('rrweb log has no replayable event stream');
    directReplay.value = {
      ...directReplay.value,
      loading: false,
      events,
      chapters: rrwebChaptersFromPayload(raw, events),
    };
    error.value = '';
  } catch (err) {
    directReplay.value = {
      ...directReplay.value,
      loading: false,
      error: String(err.message || err),
    };
  }
}

async function fetchSpec(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}

async function loadSchema() {
  try {
    const res = await fetch('/api/schema');
    if (res.ok) schema.value = await res.json();
  } catch (_) { /* schema metadata is optional in non-CLI contexts */ }
}

// ── Workspace: load a spec selected in the file tree ────────────────────────
async function openPath(rel, restore, deckId) {
  try {
    loading.value = true;
    const localeParam = activeLocale ? `&locale=${encodeURIComponent(activeLocale)}` : '';
    const res = await fetch(`/api/spec?path=${encodeURIComponent(rel)}${localeParam}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} loading ${rel}`);
    applySpecMeta(data, rel);
    // Spec-relative gif/img assets resolve under /workspace/<dir>/ in the CLI
    // viewer, or through a VS Code webview resource URI when embedded there.
    const base = data.assetBase || new URL(`/workspace/${data.dir ? data.dir + '/' : ''}`, window.location.href).href;
    setActiveSpecDir(data.dir);
    if (data.rrweb) {
      await loadDirectReplay(data.spec, base, rel, { resetSession: true });
    } else {
      await loadSpec(data.spec, base, restore, { deckId, resetSession: true });
    }
    activePath.value = rel;
    // Fresh file → reset the live-reload watch to this version.
    loadedMtime = latestMtime = data.mtimeMs || 0;
    loadedVersion = latestVersion = data.version || '';
    stale.value = false;
    conflict.value = null;
    clearReloadError();
    dirty.value = false;
    saveError.value = '';
  } catch (err) {
    error.value = String(err.message || err);
    deck.value = null;
  } finally {
    loading.value = false;
  }
}

async function switchLibraryDeck(deckId, target = null, opts = {}) {
  if (!sourceSpec.value || !deckId) return false;
  rememberLibraryDeckPosition();
  // A menu switch has no destination slide, so resume the selected deck where
  // it was last left (or its first slide on first visit). Library links retain
  // their explicit destination through `target` below.
  const restore = !target && !opts.restart ? libraryDeckPositions.get(deckId) || null : null;
  try {
    loading.value = true;
    await loadSpec(sourceSpec.value, activeSpecBaseUrl.value, restore, {
      deckId,
      target,
      preservePlayback: opts.preservePlayback,
      resetSession: false,
    });
    return true;
  } catch (err) {
    error.value = String(err.message || err);
    return false;
  } finally {
    loading.value = false;
  }
}

function switchLibraryDeckFromMenu(deckId, target = null) {
  closeCollectionMenu();
  switchLibraryDeck(deckId, target);
}

async function openLibraryLink(link, mode = 'link') {
  if (!link || !link.deck) return false;
  const origin = currentLibraryLocation();
  const target = decorateLibraryLocation(link);
  if (!target) return false;
  closeCollectionMenu();
  const changed = await switchLibraryDeck(target.deck, {
    scene: target.scene,
    section: target.section,
    step: target.step,
  });
  if (changed) commitLibraryNavigationTrail(origin, target, mode);
  return changed;
}

function onLibraryLinkEvent(e) {
  const link = e && e.detail;
  if (!link || !link.deck || isEditMode.value) return;
  openLibraryLink(link);
}

function openLibraryBackAffordance() {
  const target = libraryBackAffordance.value;
  if (!target) return;
  openLibraryLink(target, 'back');
}

function openLibraryForwardAffordance() {
  const target = libraryForwardAffordance.value;
  if (!target) return;
  openLibraryLink(target, 'forward');
}

// ── Live on-disk reload ─────────────────────────────────────────────────────
function clearReloadError() {
  reloadError.value = '';
  if (errTimer) { clearTimeout(errTimer); errTimer = null; }
}

// Poll the open spec's mtime; flag it stale when the file changes on disk.
async function pollMtime() {
  if (!activePath.value || (!deck.value && !directReplay.value.active)) return;
  try {
    const r = await fetch(`/api/stat?path=${encodeURIComponent(activePath.value)}`);
    if (!r.ok) return;
    const { mtimeMs, version } = await r.json();
    if (!mtimeMs) return;
    latestMtime = mtimeMs;
    latestVersion = version || '';
    // Compare content version when the server provides one (an identical-content
    // rewrite bumps mtime but not version, so it shouldn't read as stale); fall
    // back to mtime for older servers.
    const changed = version ? (loadedVersion && version !== loadedVersion) : (loadedMtime && mtimeMs !== loadedMtime);
    if (changed) {
      stale.value = true;
      // Embedded preview refreshes in place unless there are unsaved edits,
      // which would otherwise be discarded. In that case the compact deck
      // control exposes a reload action for the external version.
      if (embedded.value && !(isEditMode.value && dirty.value)) reloadActive();
    }
  } catch (_) { /* server gone / transient — try again next tick */ }
}

// Reload the open spec from disk. On any failure (gone, unparseable, invalid
// spec, broken render) we keep the deck that's already on screen, show a brief
// message, and carry on — never drop the user into an error state.
async function reloadActive() {
  const rel = activePath.value;
  if (!rel || reloading.value) return;
  reloading.value = true;
  clearReloadError();
  // Remember where we are so the reloaded deck lands on the same slide.
  const cur = deck.value && deck.value.state;
  const restore = cur ? { sceneIndex: cur.sceneIndex, stepIndex: cur.stepIndex } : null;
  try {
    const localeParam = activeLocale ? `&locale=${encodeURIComponent(activeLocale)}` : '';
    const res = await fetch(`/api/spec?path=${encodeURIComponent(rel)}${localeParam}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} loading ${rel}`);
    applySpecMeta(data, rel);
    const base = data.assetBase || new URL(`/workspace/${data.dir ? data.dir + '/' : ''}`, window.location.href).href;
    setActiveSpecDir(data.dir);
    if (data.rrweb) {
      await loadDirectReplay(data.spec, base, rel, { resetSession: true });
    } else {
      await loadSpec(data.spec, base, restore, { deckId: activeDeckId.value, resetSession: true });   // swaps deck.value only on success
    }
    loadedMtime = latestMtime = data.mtimeMs || latestMtime;
    loadedVersion = latestVersion = data.version || latestVersion;
    stale.value = false;
    conflict.value = null;
  } catch (err) {
    // Keep the current version on screen and continue.
    reloadError.value = `Reload failed — kept the previous version. ${String(err.message || err)}`;
    // Acknowledge the broken revision so we stop re-prompting for it; a further
    // edit (newer mtime) re-arms the stale flag on the next poll.
    loadedMtime = latestMtime;
    loadedVersion = latestVersion;
    stale.value = false;
    errTimer = setTimeout(clearReloadError, 8000);
  } finally {
    reloading.value = false;
  }
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const spec = JSON.parse(await file.text());
    await loadSpec(spec, '', null, { deckId: deckIdFromSearch(), resetSession: true }); // no base URL → relative gif assets won't resolve
    setActiveSpecDir('');
  } catch (err) { error.value = String(err.message || err); }
}

function fitScale() {
  compactViewport.value = window.innerWidth < 760;
  const showSidebar = workspace.value && !embedded.value && viewerMode.value !== 'present' && !compactViewport.value;
  const sw = showSidebar ? sidebarWidth.value : 0;
  const ew = workspace.value && deck.value && isEditMode.value ? editorWidth.value : 0;
  // The persistent viewer bar reserves real stage space instead of sitting on
  // top of deck content. Replay owns its full-screen surface and has no bar.
  const topBarH = deck.value && !directReplay.active ? 54 : 0;
  const availableW = Math.max(320, window.innerWidth - sw - ew);
  const availableH = Math.max(180, window.innerHeight - topBarH);
  const scale = Math.min(availableW / 1920, availableH / 1080);
  document.documentElement.style.setProperty('--slidey-scale', String(scale));
  document.documentElement.style.setProperty('--slidey-sidebar-w', `${sw}px`);
  document.documentElement.style.setProperty('--slidey-editor-w', `${ew}px`);
  document.documentElement.style.setProperty('--slidey-topbar-h', `${topBarH}px`);
}

function setViewerMode(mode) {
  if (mode !== 'browse' && mode !== 'edit' && mode !== 'present') return;
  if (mode === 'edit' && workspace.value && !activeViewEditable.value) return;
  document.body.classList.toggle('slidey-edit-mode', mode === 'edit');
  document.body.classList.toggle('slidey-browse-mode', mode === 'browse');
  document.body.classList.toggle('slidey-present-mode', mode === 'present');
  document.body.classList.toggle('slidey-presentation-mode', mode !== 'edit');
  viewerMode.value = mode;
  try {
    localStorage.setItem('slidey.viewerMode', mode);
    localStorage.setItem('slidey.editMode', mode === 'edit' ? '1' : '0');
  } catch (_) {}
  fitScale();
}

function closeRrwebModal() {
  rrwebModal.value = {
    open: false,
    loading: false,
    error: '',
    title: '',
    ref: '',
    href: '',
    events: [],
    chapters: [],
  };
}

function rrwebEventsFromPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.events)) return raw.events;
  return [];
}

function rrwebChaptersFromPayload(raw, events) {
  if (raw && Array.isArray(raw.chapters)) return raw.chapters;
  return chaptersFromEvents(events || []);
}

async function onOpenRrweb(e) {
  const detail = (e && e.detail) || {};
  const ref = String(detail.ref || '').trim();
  if (!ref) return;
  const href = resolveEvidencePlaybackHref(ref, activeSpecBaseUrl.value, window.location.href);
  rrwebModal.value = {
    open: true,
    loading: true,
    error: '',
    title: String(detail.title || detail.label || 'Session replay'),
    ref,
    href,
    events: [],
    chapters: [],
  };
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`${res.status} loading ${ref}`);
    const raw = await res.json();
    const events = rrwebEventsFromPayload(raw);
    if (events.length < 2) throw new Error('rrweb log has no replayable event stream');
    rrwebModal.value = {
      ...rrwebModal.value,
      loading: false,
      events,
      chapters: rrwebChaptersFromPayload(raw, events),
    };
  } catch (err) {
    rrwebModal.value = {
      ...rrwebModal.value,
      loading: false,
      error: String(err.message || err),
    };
  }
}

const sceneReferences = computed(() => {
  const sc = store.scene || {};
  return normalizeReferences(sc).map(resolveReference);
});

function openReference(ref) {
  const normalized = normalizeReference(ref);
  activeReference.value = normalized ? resolveReference(normalized) : ref;
}

function closeReference() {
  activeReference.value = null;
}

// Delegated click router for inline `<a data-slidey-ref="target">` links —
// produced by `slidey convert` from Markdown `[text](target)`, or hand-
// authored into any `*Html` field (bodyHtml, labelHtml, introHtml, ...).
// Routes to whichever modal surface already owns that target kind: another
// library deck ("deck:<id>" / "deck:<id>#<scene>"), the rrweb replay modal
// (an `.rrweb.json` target), or the reference viewer modal (everything
// else — image/video/markdown/code/json/diff/text/html, inferred the same
// way `references[]` entries are). Static PNG/PDF/MP4 exports never dispatch
// a real click here, so those renders simply show the anchor's visual
// chrome (see `[data-slidey-ref]` in template.css) with no interaction —
// the documented graceful-degradation default.
function onInlineRefClick(e) {
  const anchor = e.target && e.target.closest && e.target.closest('[data-slidey-ref]');
  if (!anchor) return;
  const parsed = classifyInlineRefTarget(anchor.getAttribute('data-slidey-ref'));
  if (!parsed) return;
  e.preventDefault();
  e.stopPropagation();
  const label = anchor.textContent || '';
  if (parsed.kind === 'deck') {
    window.dispatchEvent(new CustomEvent('slidey:library-link', {
      detail: { deck: parsed.deck, scene: parsed.scene || null, label },
    }));
  } else if (parsed.kind === 'rrweb') {
    window.dispatchEvent(new CustomEvent('slidey:open-rrweb', {
      detail: { ref: parsed.ref, title: label },
    }));
  } else {
    openReference({ src: parsed.src, label });
  }
}

function isLocalViewerHost() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function hostOpenSource(src) {
  const raw = String(src || '');
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/')) return raw;
  const dir = activeSpecDir.value;
  if (!dir) return raw;
  const parts = `${dir}/${raw}`.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

async function openReferenceExternal(ref) {
  const normalized = normalizeReference(ref);
  const resolved = normalized ? resolveReference(normalized) : ref;
  const fallbackHref = resolved && resolved.href;
  const payload = resolved && resolved.src
    ? {
        src: hostOpenSource(resolved.src),
        lineStart: resolved.lineStart,
        lineEnd: resolved.lineEnd,
        kind: resolved.kind,
      }
    : null;

  if (embedded.value && payload && typeof window.slideyOpenReference === 'function') {
    try {
      await window.slideyOpenReference(payload);
      return;
    } catch (_) {
      // Fall back to browser navigation below.
    }
  }

  if (workspace.value && !embedded.value && isLocalViewerHost() && payload) {
    try {
      const res = await fetch('/api/open-reference', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
    } catch (_) {
      // Fall back to browser navigation below.
    }
  }

  if (fallbackHref) window.open(fallbackHref, '_blank', 'noopener,noreferrer');
}

function resolveReference(ref) {
  if (!ref) return ref;
  return {
    ...ref,
    href: ref.inline ? '' : resolveAssetHref(ref.src, activeSpecBaseUrl.value, window.location.href),
  };
}

provide('slideyReferences', {
  open: openReference,
  resolve: resolveReference,
});

// ── Sidebar resize ──────────────────────────────────────────────────────────
function startResize(e) {
  e.preventDefault();
  const move = (ev) => {
    sidebarWidth.value = Math.max(180, Math.min(560, ev.clientX));
    fitScale();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function markDirty() {
  dirty.value = true;
  saveError.value = '';
}
function setInlineEditing(v) {
  isInlineEditing.value = Boolean(v);
}
function suppressDeckClick() {
  suppressDeckNavClick.value = true;
}
function clearDeckClickSuppression() {
  suppressDeckNavClick.value = false;
}

// Save the in-memory spec. `force` overwrites a concurrent on-disk change
// (OURS resolution); otherwise the server rejects a stale base with 409 and we
// raise the conflict bar so the user can choose OURS or THEIRS.
async function saveActive(force = false) {
  if (!activePath.value || !sourceSpec.value || saving.value || !activeViewEditable.value) return;
  // Strict: Save is bound as `@click="saveActive"`, so a click event must not be
  // mistaken for force — only an explicit `true` (the OURS path) overwrites.
  const forceWrite = force === true;
  saving.value = true;
  saveError.value = '';
  try {
    const res = await fetch(`/api/spec?path=${encodeURIComponent(activePath.value)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: sourceSpec.value, baseVersion: loadedVersion, force: forceWrite }),
    });
    const data = await res.json();
    if (res.status === 409 && data.conflict) {
      // Someone else wrote this file since we loaded it. Hold their version and
      // let the user resolve; don't lose either side silently.
      conflict.value = { theirsSpec: data.current && data.current.spec, theirsVersion: data.current && data.current.version };
      latestVersion = (data.current && data.current.version) || latestVersion;
      latestMtime = (data.current && data.current.mtimeMs) || latestMtime;
      stale.value = true;
      return;
    }
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} saving ${activePath.value}`);
    loadedMtime = latestMtime = data.mtimeMs || latestMtime;
    loadedVersion = latestVersion = data.version || loadedVersion;
    stale.value = false;
    conflict.value = null;
    dirty.value = false;
    sessionSpec.value = cloneSpec(sourceSpec.value);
  } catch (err) {
    saveError.value = String(err.message || err);
  } finally {
    saving.value = false;
  }
}

// OURS — keep my edits, overwrite the concurrent on-disk version.
async function resolveConflictOurs() {
  conflict.value = null;
  await saveActive(true);
}

// THEIRS — discard my edits and adopt the on-disk version.
async function resolveConflictTheirs() {
  conflict.value = null;
  await reloadActive();
}

async function revertActive() {
  if (!workspace.value || !sourceSpec.value || !sessionSpec.value || !deck.value || !dirty.value || saving.value || !activeViewEditable.value) return;
  saveError.value = '';
  const cur = deck.value.state;
  const restore = cur ? { sceneIndex: cur.sceneIndex, stepIndex: cur.stepIndex } : null;
  try {
    await loadSpec(cloneSpec(sessionSpec.value), activeSpecBaseUrl.value, restore, {
      deckId: activeDeckId.value,
      resetSession: true,
    });
  } catch (err) {
    saveError.value = String(err.message || err);
  }
}

async function cloneActive() {
  if (!activePath.value || cloning.value || !workspace.value) return;
  cloning.value = true;
  cloneError.value = '';
  try {
    const res = await fetch(`/api/clone-spec?path=${encodeURIComponent(activePath.value)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} cloning ${activePath.value}`);
    await openPath(data.path);
    setViewerMode('edit');
  } catch (err) {
    cloneError.value = String(err.message || err);
  } finally {
    cloning.value = false;
  }
}

let teardownAnnotate = null;
let teardownInlineEdit = null;

onMounted(async () => {
  try {
    const savedMode = localStorage.getItem('slidey.viewerMode');
    if (savedMode === 'browse' || savedMode === 'edit' || savedMode === 'present') {
      viewerMode.value = savedMode;
    } else if (localStorage.getItem('slidey.editMode') === '1') {
      viewerMode.value = 'edit';
    } else {
      viewerMode.value = 'browse';
    }
  } catch (_) {
    viewerMode.value = 'browse';
  }
  setViewerMode(viewerMode.value);
  fitScale();
  window.addEventListener('resize', fitScale);
  window.addEventListener('keydown', onWindowKeydown);
  window.addEventListener('click', onWindowClick);
  window.addEventListener('click', onInlineRefClick);
  window.addEventListener('slidey:open-rrweb', onOpenRrweb);
  window.addEventListener('slidey:library-link', onLibraryLinkEvent);
  window.addEventListener('slidey:video-time', onVideoTime);
  window.addEventListener('slidey:video-ended', onVideoEnded);
  // Producer side of the embed annotation protocol: when an embedding host turns
  // on annotation mode, let the operator point at a real element on the live
  // slide and post a precise `<scene>/<field>` anchor back. Reads the CURRENT
  // slide via live accessors. No-op when not embedded.
  teardownAnnotate = installEmbedAnnotate({
    getRoot: () => document,
    getSceneType: () => store.sceneType,
    getSceneIndex: () => (deck.value && deck.value.state ? deck.value.state.sceneIndex : 0),
    getAnchor: () => {
      const anchor = deck.value && deck.value.anchorForScene ? deck.value.anchorForScene() : null;
      if (!anchor || !currentScene.value || !currentScene.value.rrweb || rrwebTimeMs.value == null) return anchor;
      return { ...anchor, rrwebTime: rrwebTimeMs.value };
    },
    gotoAnchor: (anchor) => {
      if (!deck.value || !deck.value.gotoAnchor) throw new Error('deck is not ready for anchor restoration');
      return deck.value.gotoAnchor(anchor);
    },
    gotoView: (sceneIndex, stepIndex) => {
      if (!deck.value) return;
      return deck.value.go(deck.value.posForScene(sceneIndex, stepIndex));
    },
  });
  // Click-to-edit text directly on the slide (workspace edit mode only). Writes
  // through the same in-memory spec the side form + Save button use.
  teardownInlineEdit = installInlineEdit({
    isActive: () => workspace.value && isEditMode.value && activeViewEditable.value && !!deck.value
      && /\.json$/i.test(activePath.value || ''),
    getSpec: () => currentSpec.value,
    getSceneIndex: () => (deck.value && deck.value.state ? deck.value.state.sceneIndex : 0),
    render: () => deck.value && deck.value.render(),
    markDirty,
    setInlineEditing,
    suppressDeckClick,
  });
  try {
    const initialView = initialViewFromSearch(window.location.search);
    const initialDeckId = window.__SLIDEY_INITIAL_DECK__ || deckIdFromSearch();
    // Embedded spec (single-file static build): self-contained, no fetch.
    if (window.__SLIDEY_SPEC__) {
      await loadSpec(window.__SLIDEY_SPEC__, window.location.href, initialView, {
        deckId: initialDeckId,
        resetSession: true,
      });
      return;
    }
    const param = new URLSearchParams(window.location.search).get('spec');
    if (param) {
      await loadSpec(await fetchSpec(param), new URL(param, window.location.href).href, initialView, {
        deckId: initialDeckId,
        resetSession: true,
      });
      return;
    }
    // Workspace mode: the slidey CLI viewer serves /api/config + /api/tree.
    let cfg = null;
    try {
      const r = await fetch('/api/config');
      if (r.ok) cfg = await r.json();
    } catch (_) { /* not the CLI viewer — fall through */ }
      if (cfg && cfg.root) {
        if (cfg.feedback) window.__SLIDEY_FEEDBACK__ = cfg.feedback;
        workspace.value = true;
        embedded.value = !!cfg.embedded;
        document.body.classList.add('slidey-workspace');
        if (embedded.value) {
          document.body.classList.add('slidey-embedded');
          // VS Code webview preview (embedded mode) should default to Present
          // on first load, not Edit, even when a previous session stored that.
          setViewerMode('present');
        }
        fitScale();
      // The file tree is workspace-only; embedded preview reuses the same scene
      // editor in-place.
      if (!embedded.value) {
        try { tree.value = await (await fetch('/api/tree')).json(); } catch (_) { tree.value = null; }
        await loadSchema();
      }
      if (cfg.openFile) await openPath(cfg.openFile, initialView, initialDeckId || cfg.deckId);
      if (!cfg.openFile && viewerMode.value === 'present') setViewerMode('browse');
      fitScale();
      // Watch the open spec for on-disk edits (CLI viewer only).
      pollTimer = setInterval(pollMtime, POLL_MS);
      return;
    }
    // Convenience default for `npm run dev`: a spec.json beside index.html.
    await loadSpec(await fetchSpec('./spec.json'), window.location.href, initialView, {
      deckId: initialDeckId,
      resetSession: true,
    });
  } catch (err) {
    error.value = String(err.message || err);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', fitScale);
  window.removeEventListener('keydown', onWindowKeydown);
  window.removeEventListener('click', onWindowClick);
  window.removeEventListener('click', onInlineRefClick);
  window.removeEventListener('slidey:open-rrweb', onOpenRrweb);
  window.removeEventListener('slidey:library-link', onLibraryLinkEvent);
  window.removeEventListener('slidey:video-time', onVideoTime);
  window.removeEventListener('slidey:video-ended', onVideoEnded);
  stopNarration({ pauseVideo: false });
  if (pollTimer) clearInterval(pollTimer);
  if (errTimer) clearTimeout(errTimer);
  if (teardownAnnotate) teardownAnnotate();
  if (teardownInlineEdit) teardownInlineEdit();
  document.body.classList.remove('slidey-edit-mode', 'slidey-presentation-mode', 'slidey-browse-mode', 'slidey-present-mode');
  document.body.classList.remove('slidey-replay-mode');
});
</script>

<template>
  <!-- Workspace sidebar (CLI viewer only — hidden in the embedded preview) -->
  <aside v-if="workspace && !embedded && viewerMode !== 'present' && !compactWorkspace" class="slidey-sidebar" :style="{ width: sidebarWidth + 'px' }">
    <div class="slidey-sidebar-head">
      <span class="slidey-sidebar-mark">slidey</span>
      <span class="slidey-sidebar-root" :title="tree && tree.name">{{ tree ? tree.name : '' }}</span>
      <button
        v-if="activePath && deck && !activeSpecEditable"
        class="slidey-sidebar-clone"
        :disabled="cloning"
        title="Create an editable .slidey.json copy of this report deck"
        @click.stop="cloneActive"
      >{{ cloning ? 'Cloning…' : 'Clone editable copy' }}</button>
      <span v-if="cloneError" class="slidey-embedded-saveerr" :title="cloneError">⚠ {{ cloneError }}</span>
    </div>
    <div class="slidey-sidebar-body">
      <FileTree
        v-if="tree && tree.children && tree.children.length"
        :nodes="tree.children"
        :active="activePath"
        :active-deck="activeDeckId"
        :select="openPath"
      />
      <p v-else class="slidey-sidebar-empty">No .json / .jsonl specs found here.</p>
    </div>
    <div class="slidey-sidebar-resize" @mousedown="startResize"></div>
  </aside>

  <!-- Reload-failure toast: the previous deck stays on screen; this just informs. -->
  <div v-if="reloadError" class="slidey-reload-toast" @click="clearReloadError">
    <span class="slidey-reload-toast-icon">⚠</span>
    <span class="slidey-reload-toast-msg">{{ reloadError }}</span>
  </div>

  <button
    v-if="deck && libraryBackAffordance && !isEditMode && !activeIsHierarchy"
    type="button"
    class="slidey-library-affordance slidey-library-affordance-up slidey-library-link"
    :class="{ 'with-hierarchy-overlay': activeIsHierarchy }"
    :title="libraryBackAffordance.context ? `Back up to ${libraryBackAffordance.title}: ${libraryBackAffordance.context}` : `Back up to ${libraryBackAffordance.title}`"
    @click.stop="openLibraryBackAffordance"
  >
    <span class="slidey-library-affordance-kicker">&uarr; {{ libraryBackAffordance.action }}</span>
    <span class="slidey-library-affordance-title">{{ libraryBackAffordance.title }}</span>
    <span v-if="libraryBackAffordance.context" class="slidey-library-affordance-context">{{ libraryBackAffordance.context }}</span>
  </button>

  <header
    v-if="deck && !directReplay.active"
    class="slidey-deck-chrome"
    :class="{ 'has-collection-nav': libraryDeckRows.length }"
    @click.stop
  >
    <nav v-if="activeHierarchyTrail.length > 1" class="slidey-deck-crumbs" aria-label="Parent deck path">
      <template v-for="(crumb, i) in activeHierarchyTrail.slice(0, -1)" :key="crumb.id">
        <span v-if="i" class="slidey-deck-crumb-separator" aria-hidden="true">/</span>
        <button
          type="button"
          class="slidey-deck-crumb"
          :title="crumb.description || crumb.title"
          @click.stop="switchLibraryDeckFromMenu(crumb.id)"
        >{{ crumb.title }}</button>
      </template>
    </nav>
    <div class="slidey-deck-title" :title="viewerTitle">{{ viewerTitle }}</div>
    <div v-if="workspace || embedded" class="slidey-deck-actions" role="group" aria-label="Viewer mode">
      <button
        v-if="stale"
        type="button"
        class="slidey-deck-mode slidey-deck-reload"
        :class="{ spinning: reloading }"
        :disabled="reloading"
        title="This deck changed on disk — reload it"
        data-tooltip="This deck changed on disk — reload it"
        aria-label="Reload changed deck"
        @click.stop="reloadActive"
      ><span aria-hidden="true">⟳</span></button>
      <button
        type="button"
        class="slidey-deck-mode"
        :class="{ active: viewerMode === 'browse' }"
        :aria-pressed="viewerMode === 'browse'"
        title="Browse deck"
        data-tooltip="Browse deck"
        aria-label="Browse deck"
        @click.stop="setViewerMode('browse')"
      ><span aria-hidden="true">◉</span></button>
      <button
        type="button"
        class="slidey-deck-mode"
        :class="{ active: viewerMode === 'edit' }"
        :aria-pressed="viewerMode === 'edit'"
        :disabled="!activeViewEditable"
        :title="activeViewEditable ? 'Edit deck' : 'This deck is read-only'"
        :data-tooltip="activeViewEditable ? 'Edit deck' : 'This deck is read-only'"
        :aria-label="activeViewEditable ? 'Edit deck' : 'This deck is read-only'"
        @click.stop="setViewerMode('edit')"
      ><span aria-hidden="true">✎</span></button>
      <button
        type="button"
        class="slidey-deck-mode"
        :class="{ active: viewerMode === 'present' }"
        :aria-pressed="viewerMode === 'present'"
        title="Present full screen"
        data-tooltip="Present full screen"
        aria-label="Present full screen"
        @click.stop="setViewerMode('present')"
      ><span aria-hidden="true">⛶</span></button>
    </div>
    <div v-if="!embedded" class="slidey-deck-actions" role="group" aria-label="Feedback">
      <button
        type="button"
        class="slidey-deck-mode"
        title="Send feedback"
        data-tooltip="Send feedback"
        aria-label="Send feedback"
        @click.stop="feedbackOpen = true"
      ><span aria-hidden="true">💬</span></button>
    </div>
    <nav
      v-if="libraryDeckRows.length"
      class="slidey-collection-nav"
      aria-label="Collection navigation"
      @click.stop
    >
        <div class="slidey-collection-tabs" role="group" aria-label="Collection menus">
          <button
            type="button"
            class="slidey-deck-mode slidey-collection-tab"
            :class="{ active: openCollectionMenu === 'hierarchy', current: activeIsHierarchy }"
            :aria-expanded="openCollectionMenu === 'hierarchy'"
            aria-controls="slidey-hierarchy-menu"
            title="Browse hierarchy"
            data-tooltip="Browse hierarchy"
            aria-label="Browse hierarchy"
            @click.stop="toggleCollectionMenu('hierarchy')"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 3.5h3v3H3zM10 9.5h3v3h-3zM10 2.5h3v3h-3zM6 5v3.5h4M6 10.5h4" /></svg>
            <span class="slidey-collection-tab-label">Hierarchy</span>
          </button>
          <button
            type="button"
            class="slidey-deck-mode slidey-collection-tab subsets"
            :class="{ active: openCollectionMenu === 'subsets', current: activeIsSubset }"
            :aria-expanded="openCollectionMenu === 'subsets'"
            aria-controls="slidey-subsets-menu"
            title="Browse subset views"
            data-tooltip="Browse subset views"
            aria-label="Browse subset views"
            @click.stop="toggleCollectionMenu('subsets')"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2.5" y="3" width="7" height="7" rx="1" /><rect x="6.5" y="6" width="7" height="7" rx="1" /></svg>
            <span class="slidey-collection-tab-label">Subsets</span>
          </button>
        </div>

        <section
          v-if="openCollectionMenu === 'hierarchy'"
          id="slidey-hierarchy-menu"
          class="slidey-collection-popover slidey-collection-popover-hierarchy"
          aria-label="Hierarchy menu"
        >
          <header class="slidey-collection-popover-head">
            <div>
              <div class="slidey-collection-kicker">Hierarchy</div>
              <div class="slidey-collection-title" :title="collectionTitle">{{ collectionTitle }}</div>
            </div>
            <div class="slidey-collection-status">{{ activeDeckStatus }}</div>
          </header>

          <div class="slidey-hierarchy-trail" aria-label="Current hierarchy path">
            <button
              v-for="(crumb, i) in activeHierarchyTrail"
              :key="crumb.id"
              type="button"
              class="slidey-hierarchy-crumb"
              :class="{ active: crumb.id === activeDeckId }"
              :title="crumb.description || crumb.title"
              @click.stop="switchLibraryDeckFromMenu(crumb.id)"
            >
              <span v-if="i" class="slidey-hierarchy-separator" aria-hidden="true">&rsaquo;</span>
              <span>{{ crumb.title }}</span>
            </button>
          </div>

          <div v-if="hierarchyLinkRows.length" class="slidey-hierarchy-next" aria-label="Hierarchy destinations from current slide">
            <div class="slidey-collection-section-label">{{ currentSectionTitle || 'Current slide' }}</div>
            <button
              v-for="(link, i) in hierarchyLinkRows"
              :key="`${link.deck}:${link.section || ''}:${link.scene || ''}:${i}`"
              type="button"
              class="slidey-hierarchy-next-row"
              @click.stop="openLibraryLink(link)"
            >
              <span class="slidey-hierarchy-next-relation">{{ link.relation }}</span>
              <span class="slidey-hierarchy-next-title">{{ link.label }}</span>
              <span v-if="link.metaText" class="slidey-hierarchy-next-meta">{{ link.metaText }}</span>
            </button>
          </div>

          <div class="slidey-hierarchy-map" aria-label="Collection hierarchy">
            <button
              v-for="option in hierarchyDeckRows"
              :key="option.id"
              type="button"
              class="slidey-hierarchy-map-row"
              :class="{ active: option.id === activeDeckId }"
              :style="{ paddingLeft: (10 + option.level * 18) + 'px' }"
              :title="option.description || option.title"
              @click.stop="switchLibraryDeckFromMenu(option.id)"
            >
              <span class="slidey-hierarchy-node" :class="`kind-${option.kind.toLowerCase()}`"></span>
              <span class="slidey-hierarchy-map-copy">
                <span class="slidey-hierarchy-map-title">{{ option.title }}</span>
                <span v-if="option.metaText" class="slidey-hierarchy-map-meta">{{ option.metaText }}</span>
              </span>
              <span class="slidey-hierarchy-map-kind">{{ option.kind }}</span>
            </button>
          </div>
        </section>

        <section
          v-if="openCollectionMenu === 'subsets'"
          id="slidey-subsets-menu"
          class="slidey-collection-popover slidey-collection-popover-subsets"
          aria-label="Subsets menu"
        >
          <header class="slidey-collection-popover-head">
            <div>
              <div class="slidey-collection-kicker">Subsets</div>
              <div class="slidey-collection-title" :title="collectionTitle">{{ collectionTitle }}</div>
            </div>
            <div class="slidey-collection-status">{{ sourceSceneCount }} source slides</div>
          </header>

          <div v-if="subsetLinkRows.length" class="slidey-subset-linked" aria-label="Subset destinations from current slide">
            <div class="slidey-collection-section-label">{{ currentSectionTitle || 'Current slide' }}</div>
            <button
              v-for="(link, i) in subsetLinkRows"
              :key="`${link.deck}:${link.section || ''}:${link.scene || ''}:${i}`"
              type="button"
              class="slidey-subset-row linked"
              @click.stop="openLibraryLink(link)"
            >
              <span class="slidey-subset-title">{{ link.label }}</span>
              <span v-if="link.metaText" class="slidey-subset-meta">{{ link.metaText }}</span>
            </button>
          </div>

          <div class="slidey-subset-list" aria-label="Subset decks">
            <button
              v-for="option in subsetDeckRows"
              :key="option.id"
              type="button"
              class="slidey-subset-row"
              :class="{ active: option.id === activeDeckId }"
              :title="option.description || option.title"
              @click.stop="switchLibraryDeckFromMenu(option.id)"
            >
              <span class="slidey-subset-main">
                <span class="slidey-subset-title">{{ option.title }}</span>
                <span class="slidey-subset-count">{{ option.sceneCount }} slides</span>
              </span>
              <span v-if="option.metaText" class="slidey-subset-meta">{{ option.metaText }}</span>
            </button>
            <div v-if="!subsetDeckRows.length" class="slidey-subset-empty">No subsets</div>
          </div>
        </section>
    </nav>
    <div v-if="isEditMode && !embedded" class="slidey-deck-actions slidey-deck-edit-actions" role="group" aria-label="Edit actions">
      <span class="slidey-deck-action-divider" aria-hidden="true"></span>
      <button
        v-if="isEditMode && !embedded"
        type="button"
        class="slidey-deck-save"
        :class="{ dirty }"
        :disabled="!dirty || saving || !activeViewEditable"
        :title="saveError || 'Save edits'"
        @click.stop="saveActive"
      >{{ saving ? '…' : 'Save' }}</button>
      <button
        v-if="isEditMode && !embedded && dirty"
        type="button"
        class="slidey-deck-revert"
        title="Discard unsaved edits"
        @click.stop="revertActive"
      >↶</button>
    </div>
  </header>

  <button
    v-if="deck && libraryForwardAffordance && !isEditMode"
    type="button"
    class="slidey-library-affordance slidey-library-affordance-down slidey-library-link"
    :title="libraryForwardAffordance.context ? `Return down to ${libraryForwardAffordance.title}: ${libraryForwardAffordance.context}` : `Return down to ${libraryForwardAffordance.title}`"
    @click.stop="openLibraryForwardAffordance"
  >
    <span class="slidey-library-affordance-kicker">&darr; {{ libraryForwardAffordance.action }}</span>
    <span class="slidey-library-affordance-title">{{ libraryForwardAffordance.title }}</span>
    <span v-if="libraryForwardAffordance.context" class="slidey-library-affordance-context">{{ libraryForwardAffordance.context }}</span>
  </button>

  <div v-if="deck && sceneReferences.length" class="slidey-reference-rail" aria-label="Scene references">
    <button
      v-for="ref in sceneReferences"
      :key="`${ref.kind}:${ref.src}:${ref.label}`"
      type="button"
      class="slidey-reference-chip"
      :class="{ 'is-auto': ref.auto }"
      :title="`Open ${ref.label}`"
      @click.stop="openReference(ref)"
    >
      <span class="slidey-reference-kind">{{ ref.kind }}</span>
      <span class="slidey-reference-label">{{ ref.label }}</span>
    </button>
  </div>

  <!-- Save conflict: the file changed on disk (e.g. an AI edit) while you had
       unsaved changes. Resolve by keeping yours or taking the on-disk version —
       neither side is discarded without a choice. -->
  <div v-if="conflict" class="slidey-conflict" role="alertdialog" aria-label="Save conflict">
    <div class="slidey-conflict-icon">⚠</div>
    <div class="slidey-conflict-body">
      <div class="slidey-conflict-title">This deck changed on disk while you were editing</div>
      <div class="slidey-conflict-msg">Saving now would overwrite the other change. Keep your version, or discard your edits and load the on-disk one.</div>
    </div>
    <div class="slidey-conflict-actions">
      <button
        type="button"
        class="slidey-conflict-ours"
        :disabled="saving || reloading"
        title="Overwrite the on-disk version with your edits"
        @click.stop="resolveConflictOurs"
      >Keep mine</button>
      <button
        type="button"
        class="slidey-conflict-theirs"
        :disabled="saving || reloading"
        title="Discard your edits and load the version on disk"
        @click.stop="resolveConflictTheirs"
      >Use on-disk</button>
    </div>
  </div>

  <ReferenceViewer :reference="activeReference" :close="closeReference" :open-external="openReferenceExternal" />

  <div v-if="directReplay.active" class="slidey-replay-viewer" data-testid="rrweb-direct-viewer">
    <div v-if="directReplay.loading" class="slidey-replay-message">Loading replay…</div>
    <div v-else-if="directReplay.error" class="slidey-replay-message error">{{ directReplay.error }}</div>
    <RrwebPlayer
      v-else
      data-testid="rrweb-direct-player"
      :events="directReplay.events"
      :chapters="directReplay.chapters"
      :autoplay="false"
      :controls="true"
    />
  </div>

  <DeckHost v-if="!directReplay.active" />
  <div
    v-if="deck && !directReplay.active"
    class="slidey-sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >{{ currentSceneAnnouncement }}</div>
  <NavController
    v-if="deck && !directReplay.active"
    :key="activePath"
    :deck="deck"
    :is-inline-editing="isInlineEditing"
    :suppress-deck-click="suppressDeckNavClick"
    :clear-deck-click-suppression="clearDeckClickSuppression"
    :narration-state="narrationState"
    :play-slide="() => startLiveNarration('slide')"
    :play-deck="() => startLiveNarration('deck')"
    :play-stack="() => startLiveNarration('stack')"
    :stack-available="Boolean(collection && collection.isCollection && activeHierarchyTrail.length)"
    :set-narration-enabled="setNarrationEnabled"
    :set-captions-enabled="setCaptionsEnabled"
    :stop-narration="stopNarration"
  />
  <div v-if="deck && liveNarration && captionsEnabled && liveCaption" class="slidey-closed-captions" role="status" aria-live="polite">
    {{ liveCaption }}
  </div>
  <div
    v-if="feedbackOpen"
    class="slidey-feedback-overlay"
    data-testid="feedback-modal-overlay"
    role="presentation"
    @click.stop="onFeedbackOverlayClick"
  >
    <div v-if="feedbackSinks().length > 1" class="slidey-feedback-destination">
      <label for="slidey-feedback-destination">Send to</label>
      <select id="slidey-feedback-destination" :value="feedbackSink || feedbackSinks()[0].id" @change="selectFeedbackSink">
        <option v-for="sink in feedbackSinks()" :key="sink.id" :value="sink.id">{{ sink.label || sink.id }}</option>
      </select>
    </div>
    <FeedbackModal
      :key="feedbackSink || feedbackSinks()[0].id"
      :kinds="feedbackKindGroups()"
      :anchor-for="feedbackAnchorFor"
      :manifest="feedbackManifest"
      :router="feedbackRouterInstance"
      :context="feedbackContext"
      @close="feedbackOpen = false"
      @submitted="onFeedbackSubmitted"
    />
  </div>
  <div
    v-if="rrwebModal.open"
    class="slidey-rrweb-modal"
    data-testid="rrweb-popout-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Session replay"
    @click.self="closeRrwebModal"
  >
    <section class="slidey-rrweb-panel">
      <header class="slidey-rrweb-head">
        <div class="slidey-rrweb-titleblock">
          <div class="slidey-rrweb-kicker">Session replay</div>
          <h2>{{ rrwebModal.title }}</h2>
          <p :title="rrwebModal.href">{{ rrwebModal.ref }}</p>
        </div>
        <button
          type="button"
          class="slidey-rrweb-close"
          data-testid="rrweb-popout-close"
          aria-label="Close replay"
          @click="closeRrwebModal"
        >×</button>
      </header>
      <div class="slidey-rrweb-body">
        <div v-if="rrwebModal.loading" class="slidey-rrweb-message">Loading replay…</div>
        <div v-else-if="rrwebModal.error" class="slidey-rrweb-message error">{{ rrwebModal.error }}</div>
        <RrwebPlayer
          v-else
          data-testid="rrweb-popout-player"
          :events="rrwebModal.events"
          :chapters="rrwebModal.chapters"
          :autoplay="false"
          :controls="true"
        />
      </div>
    </section>
  </div>
  <SceneEditor
    v-if="workspace && isEditMode && deck && currentSpec && activeViewEditable"
    :key="activePath"
    :deck="deck"
    :spec="currentSpec"
    :active-path="activePath"
    :dirty="dirty"
    :saving="saving"
    :save-error="saveError"
    :schema="schema"
    :narration-state="narrationState"
    @change="markDirty"
    @save="saveActive"
    @revert="revertActive"
    @listen-narration="listenCurrentNarration"
    @stop-narration="stopNarration"
  />

  <!-- Empty stage hint in workspace mode before a deck is chosen -->
  <div v-if="workspace && !deck && !directReplay.active" class="slidey-stage-empty">
    <p v-if="loading">Loading…</p>
    <template v-else>
      <p v-if="!embedded">Select a spec from the file tree.</p>
      <p v-if="error" class="slidey-loader-error">{{ error }}</p>
    </template>
  </div>

  <!-- Standalone loader / file picker (non-workspace) -->
  <div v-if="!deck && !workspace" class="slidey-loader">
    <div class="slidey-loader-card">
      <div class="slidey-loader-title">slidey</div>
      <p v-if="loading">Loading spec…</p>
      <template v-else>
        <p class="slidey-loader-hint">Load a scene spec to begin.</p>
        <p v-if="error" class="slidey-loader-error">{{ error }}</p>
        <label class="slidey-loader-btn">
          Choose spec.json…
          <input type="file" accept="application/json,.json" @change="onFile" hidden>
        </label>
        <p class="slidey-loader-tip">or pass <code>?spec=&lt;url&gt;</code></p>
      </template>
    </div>
  </div>
</template>

<style>
.slidey-loader {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: #0d1117; color: #e6edf3;
  font-family: 'Courier New', monospace;
}
.slidey-loader-card { text-align: center; max-width: 520px; padding: 40px; }
.slidey-loader-title {
  font-size: 56px; font-weight: bold;
  background: linear-gradient(180deg, #58a6ff, #bc8cff);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  margin-bottom: 18px;
}
.slidey-loader-hint { color: #8b949e; margin-bottom: 24px; }
.slidey-loader-error { color: #f85149; margin-bottom: 16px; }
.slidey-loader-btn {
  display: inline-block; cursor: pointer;
  padding: 12px 28px; border-radius: 8px;
  background: #1f6feb; color: #fff; font-weight: bold;
}
.slidey-loader-tip { color: #484f58; margin-top: 20px; font-size: 15px; }
.slidey-loader-tip code { color: #79c0ff; }

.slidey-replay-viewer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: var(--slidey-sidebar-w, 0px);
  z-index: 2050;
  box-sizing: border-box;
  display: flex;
  min-width: 0;
  min-height: 0;
  background: #0d1117;
  color: #e6edf3;
  font-family: 'Courier New', monospace;
}
body.slidey-embedded .slidey-replay-viewer,
body.slidey-workspace.slidey-present-mode .slidey-replay-viewer {
  left: 0;
}
.slidey-replay-viewer .rrp {
  width: 100%;
  height: 100%;
  gap: 0;
  min-width: 0;
  min-height: 0;
}
.slidey-replay-viewer .rrp-host {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  aspect-ratio: auto;
  border: 0;
  border-radius: 0;
}
.slidey-replay-viewer .rrp-ctl {
  flex: none;
  padding: 9px 12px;
  border-top: 1px solid #30363d;
  background: #0d1117;
}
.slidey-replay-viewer .rrp-chapter {
  flex: none;
  padding: 0 12px 9px;
  background: #0d1117;
}
.slidey-replay-message {
  width: 100%;
  display: grid;
  place-items: center;
  color: #8b949e;
  font-size: 18px;
}
.slidey-replay-message.error { color: #ff7b72; }
.slidey-closed-captions {
  position: fixed;
  z-index: 1002;
  left: 50%;
  bottom: 62px;
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 48px));
  padding: 9px 14px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  box-shadow: 0 4px 22px rgba(0, 0, 0, 0.42);
  font: 600 15px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: center;
}
body.slidey-video-full .slidey-closed-captions { top: 62px; bottom: auto; }

.slidey-feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 3300;
  display: grid;
  place-items: center;
  padding: 28px;
  box-sizing: border-box;
  background: rgba(2, 6, 12, 0.78);
  --fb-bg: #0d1117;
  --fb-fg: #f0f6fc;
  --fb-border: #30363d;
  --fb-accent: #58a6ff;
  --fb-danger: #f85149;
  --fb-success: #3fb950;
}
.slidey-feedback-destination {
  position: absolute;
  z-index: 1;
  width: min(30rem, calc(100vw - 56px));
  margin-top: calc(-1 * min(30rem, calc(100vw - 56px)) - 48px);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  color: #c9d1d9;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
}
.slidey-feedback-destination select {
  border: 1px solid var(--fb-border);
  border-radius: 6px;
  padding: 5px 7px;
  background: var(--fb-head-bg, #161b22);
  color: var(--fb-fg);
  font: inherit;
}
.slidey-rrweb-modal {
  position: fixed;
  inset: 0;
  z-index: 3200;
  display: grid;
  place-items: center;
  padding: 28px;
  box-sizing: border-box;
  background: rgba(2, 6, 12, 0.78);
  font-family: 'Courier New', monospace;
}
.slidey-rrweb-panel {
  width: min(1500px, calc(100vw - 56px));
  height: min(920px, calc(100vh - 56px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid #30363d;
  border-radius: 10px;
  overflow: hidden;
  background: #0d1117;
  color: #e6edf3;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.46);
}
.slidey-rrweb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  border-bottom: 1px solid #30363d;
  background: #161b22;
}
.slidey-rrweb-titleblock { min-width: 0; }
.slidey-rrweb-kicker {
  color: #58a6ff;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.slidey-rrweb-titleblock h2 {
  margin: 3px 0 4px;
  font: 700 22px/1.2 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.slidey-rrweb-titleblock p {
  margin: 0;
  max-width: 980px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8b949e;
  font-size: 13px;
}
.slidey-rrweb-close {
  width: 38px;
  height: 38px;
  border: 1px solid #30363d;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #c9d1d9;
  background: #0d1117;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}
.slidey-rrweb-close:hover,
.slidey-rrweb-close:focus-visible {
  border-color: #58a6ff;
  color: #fff;
  outline: none;
}
.slidey-rrweb-body {
  min-height: 0;
  padding: 18px;
  box-sizing: border-box;
}
.slidey-rrweb-body .rrp {
  width: 100%;
  height: 100%;
}
.slidey-rrweb-body .rrp-host {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  aspect-ratio: auto;
}
.slidey-rrweb-message {
  height: 100%;
  display: grid;
  place-items: center;
  color: #8b949e;
  font-size: 18px;
}
.slidey-rrweb-message.error { color: #ff7b72; }

/* Reload-failure toast — non-blocking; the previous deck stays interactive. */
.slidey-reload-toast {
  position: fixed;
  top: calc(var(--slidey-topbar-h, 0px) + 12px); left: 50%;
  transform: translateX(-50%);
  z-index: 2100;
  max-width: min(680px, 80vw);
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 16px;
  border: 1px solid #9e6a03;
  border-radius: 8px;
  background: #2d2206;
  color: #f0d894;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  cursor: pointer;
}
.slidey-reload-toast-icon { color: #e3b341; flex: none; }
.slidey-reload-toast-msg { overflow-wrap: anywhere; }

/* Persistent viewer bar: the deck is scaled into the space below it, so this
   control surface never covers a scene title or other presentation content. */
.slidey-deck-chrome {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--slidey-topbar-h, 54px);
  width: 100%;
  min-width: 0;
  padding: 5px 18px;
  border-bottom: 1px solid #30363d;
  background: linear-gradient(180deg, rgba(13, 17, 23, 0.96), rgba(13, 17, 23, 0.82));
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.18);
  color: #c9d1d9;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-sizing: border-box;
  -webkit-backdrop-filter: blur(10px) saturate(1.15);
  backdrop-filter: blur(10px) saturate(1.15);
}
body.slidey-embedded .slidey-deck-chrome,
body.slidey-workspace.slidey-present-mode .slidey-deck-chrome {
  left: 0;
  width: 100%;
}
.slidey-deck-crumbs {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  color: #8b949e;
  font-size: 11px;
  white-space: nowrap;
}
.slidey-deck-crumb {
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.slidey-deck-crumb:hover,
.slidey-deck-crumb:focus-visible { color: #c9d1d9; outline: none; }
.slidey-deck-crumb.active { color: #79c0ff; }
.slidey-deck-crumb-separator { flex: none; margin: 0 5px; color: #484f58; }
.slidey-deck-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #f0f6fc;
  font-size: 13px;
  font-weight: 720;
  letter-spacing: -0.012em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidey-deck-actions {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid #30363d;
  border-radius: 999px;
  background: #0d1117a8;
}
.slidey-deck-edit-actions {
  margin-left: -2px;
}
.slidey-deck-mode,
.slidey-deck-save,
.slidey-deck-revert {
  height: 26px;
  min-width: 26px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #8b949e;
  font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}
.slidey-deck-mode:hover:not(:disabled),
.slidey-deck-mode:focus-visible,
.slidey-deck-revert:hover,
.slidey-deck-revert:focus-visible { color: #f0f6fc; background: #30363d; outline: none; }
.slidey-deck-mode.active { background: #1f6feb; color: #fff; box-shadow: 0 0 0 1px #58a6ff77; }
.slidey-deck-mode:disabled { opacity: 0.35; cursor: default; }
.slidey-deck-mode svg {
  display: block;
  width: 15px;
  height: 15px;
  margin: auto;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.45;
}
.slidey-deck-reload { color: #79c0ff; }
.slidey-deck-reload.spinning > span { display: block; animation: slidey-deck-reload-spin 0.8s linear infinite; }
@keyframes slidey-deck-reload-spin { to { transform: rotate(360deg); } }
.slidey-deck-mode[data-tooltip] { position: relative; }
.slidey-deck-mode[data-tooltip]::after {
  position: absolute;
  z-index: 1;
  top: calc(100% + 8px);
  left: 50%;
  display: block;
  width: max-content;
  max-width: min(220px, calc(100vw - 28px));
  padding: 6px 8px;
  border: 1px solid #484f58;
  border-radius: 6px;
  background: #0d1117;
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.4);
  color: #f0f6fc;
  content: attr(data-tooltip);
  font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0;
  pointer-events: none;
  transform: translate(-50%, -2px);
  visibility: hidden;
  white-space: nowrap;
}
.slidey-deck-mode[data-tooltip]:hover::after,
.slidey-deck-mode[data-tooltip]:focus-visible::after {
  transform: translate(-50%, 0);
  visibility: visible;
}
.slidey-deck-action-divider { width: 1px; height: 15px; margin: 0 2px; background: #30363d; }
.slidey-deck-save { min-width: 42px; padding: 0 9px; color: #6e7681; font-size: 11px; }
.slidey-deck-save.dirty { background: #238636; color: #fff; }
.slidey-deck-save:disabled { cursor: default; }

.slidey-library-affordance {
  position: fixed;
  z-index: 2088;
  max-width: min(330px, calc(100vw - var(--slidey-sidebar-w, 0px) - 32px));
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: 9px 12px 10px;
  border: 1px solid #30363d;
  border-radius: 8px;
  background: #0d1117e8;
  color: #c9d1d9;
  font-family: 'Courier New', monospace;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: 0 10px 28px rgba(0,0,0,0.3);
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
}
.slidey-library-affordance-up {
  top: calc(var(--slidey-topbar-h, 0px) + 14px);
  left: calc(var(--slidey-sidebar-w, 0px) + 14px);
  border-color: #58a6ff99;
  box-shadow: inset 3px 0 0 #58a6ff, 0 10px 28px rgba(0,0,0,0.3);
}
.slidey-library-affordance-up.with-hierarchy-overlay {
  top: 105px;
}
body.slidey-embedded .slidey-library-affordance-up,
body.slidey-workspace.slidey-present-mode .slidey-library-affordance-up {
  top: calc(var(--slidey-topbar-h, 0px) + 14px);
}
body.slidey-embedded .slidey-library-affordance-up.with-hierarchy-overlay,
body.slidey-workspace.slidey-present-mode .slidey-library-affordance-up.with-hierarchy-overlay {
  top: 149px;
}
.slidey-library-affordance-down {
  right: 18px;
  bottom: 74px;
  border-color: #3fb95099;
  box-shadow: inset -3px 0 0 #3fb950, 0 10px 28px rgba(0,0,0,0.3);
}
body.slidey-video-full .slidey-library-affordance-down {
  bottom: 18px;
}
.slidey-library-affordance:hover,
.slidey-library-affordance:focus-visible {
  outline: none;
  background: #102844f2;
  color: #f0f6fc;
}
.slidey-library-affordance-down:hover,
.slidey-library-affordance-down:focus-visible {
  background: #0f2b1af2;
}
.slidey-library-affordance-kicker,
.slidey-library-affordance-title,
.slidey-library-affordance-context {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidey-library-affordance-kicker {
  color: #79c0ff;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0;
}
.slidey-library-affordance-down .slidey-library-affordance-kicker {
  color: #7ee787;
}
.slidey-library-affordance-title {
  color: #f0f6fc;
  font-size: 13px;
  font-weight: bold;
}
.slidey-library-affordance-context {
  color: #8b949e;
  font-size: 11px;
}

/* Collection navigation occupies the leading segment of the same toolbar.
   Only the menu itself floats; its triggers are deliberately part of the rail. */
.slidey-collection-nav {
  position: relative;
  order: -2;
  flex: none;
  align-self: stretch;
  display: flex;
  align-items: center;
  margin: -5px 0 -5px -18px;
  padding: 5px 14px 5px 18px;
  border-right: 1px solid #30363d;
  color: #c9d1d9;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-sizing: border-box;
}
.slidey-collection-tabs {
  display: flex;
  gap: 3px;
}
.slidey-collection-tab {
  height: 28px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  color: #8b949e;
  font-size: 11px;
  letter-spacing: 0.01em;
}
.slidey-collection-tab svg { width: 16px; height: 16px; margin: 0; stroke-width: 1.7; }
.slidey-collection-tab-label { font-weight: 750; }
.slidey-collection-tab.current { color: #79c0ff; }
.slidey-collection-tab.subsets.current { color: #e3b341; }
.slidey-collection-tab.active { background: #1f6feb; color: #fff; box-shadow: 0 0 0 1px #58a6ff77; }
.slidey-collection-tab.subsets.active { background: #9e6a03; box-shadow: 0 0 0 1px #d2992277; }
.slidey-collection-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: -6px;
  width: min(520px, calc(100vw - var(--slidey-sidebar-w, 0px) - 28px));
  /* The menu opens below the fixed viewer bar. Keep every destination
     reachable when the available vertical space is smaller than its content. */
  max-height: calc(100vh - var(--slidey-topbar-h, 0px) - 16px);
  max-height: calc(100dvh - var(--slidey-topbar-h, 0px) - 16px);
  padding: 10px;
  border: 1px solid #30363d;
  border-radius: 8px;
  background: #0d1117f4;
  box-shadow: 0 16px 40px rgba(0,0,0,0.36);
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.slidey-collection-popover-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid #21262d;
}
.slidey-collection-kicker {
  color: #58a6ff;
  font-size: 10px;
  line-height: 1.2;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0;
}
.slidey-collection-popover-subsets .slidey-collection-kicker {
  color: #d29922;
}
.slidey-collection-title,
.slidey-collection-status {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidey-collection-title {
  margin-top: 3px;
  color: #f0f6fc;
  font-size: 13px;
  font-weight: bold;
}
.slidey-collection-status {
  flex: none;
  max-width: 190px;
  padding: 3px 7px;
  border: 1px solid #30363d;
  border-radius: 999px;
  color: #8b949e;
  font-size: 10px;
}
.slidey-hierarchy-trail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 10px 2px;
  border-bottom: 1px solid #21262d;
}
.slidey-hierarchy-crumb {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  border: 0;
  background: transparent;
  color: #8b949e;
  font-family: inherit;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
}
.slidey-hierarchy-crumb span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidey-hierarchy-crumb:hover {
  color: #c9d1d9;
}
.slidey-hierarchy-crumb.active {
  color: #79c0ff;
}
.slidey-hierarchy-separator {
  color: #484f58;
}
.slidey-hierarchy-next,
.slidey-subset-linked {
  margin-top: 10px;
  padding: 8px;
  border: 1px solid #264f78;
  border-radius: 8px;
  background: #0b274233;
}
.slidey-subset-linked {
  border-color: #6e4f10;
  background: #3b2b0733;
}
.slidey-collection-section-label {
  margin: 0 0 6px;
  color: #8b949e;
  font-size: 11px;
  font-weight: bold;
}
.slidey-hierarchy-next-row,
.slidey-hierarchy-map-row,
.slidey-subset-row {
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #c9d1d9;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}
.slidey-hierarchy-next-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 2px 8px;
  align-items: center;
  padding: 7px 8px;
}
.slidey-hierarchy-next-row:hover,
.slidey-hierarchy-map-row:hover {
  border-color: #58a6ff;
  background: #1f6feb24;
}
.slidey-hierarchy-next-relation {
  grid-row: span 2;
  align-self: center;
  color: #79c0ff;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
}
.slidey-hierarchy-next-title,
.slidey-hierarchy-next-meta,
.slidey-hierarchy-map-title,
.slidey-hierarchy-map-meta,
.slidey-subset-title,
.slidey-subset-meta {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidey-hierarchy-next-title,
.slidey-hierarchy-map-title,
.slidey-subset-title {
  font-size: 13px;
  font-weight: bold;
}
.slidey-hierarchy-next-meta,
.slidey-hierarchy-map-meta,
.slidey-subset-meta {
  color: #8b949e;
  font-size: 11px;
}
.slidey-hierarchy-map {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 10px;
}
.slidey-hierarchy-map-row {
  min-height: 48px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  padding-right: 8px;
  padding-bottom: 6px;
}
.slidey-hierarchy-map-row.active {
  border-color: #58a6ff;
  background: #1f6feb2b;
}
.slidey-hierarchy-node {
  width: 11px;
  height: 11px;
  border: 2px solid #8b949e;
  border-radius: 50%;
  box-sizing: border-box;
}
.slidey-hierarchy-node.kind-source {
  border-color: #8b949e;
}
.slidey-hierarchy-node.kind-summary {
  border-color: #58a6ff;
  background: #58a6ff;
}
.slidey-hierarchy-node.kind-detail {
  border-color: #3fb950;
  background: #3fb950;
}
.slidey-hierarchy-node.kind-deck {
  border-color: #3fb950;
  background: #3fb950;
}
.slidey-hierarchy-map-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.slidey-hierarchy-map-kind,
.slidey-subset-count {
  flex: none;
  padding: 2px 6px;
  border: 1px solid #30363d;
  border-radius: 999px;
  color: #8b949e;
  font-size: 10px;
  white-space: nowrap;
}
.slidey-hierarchy-map-row.active .slidey-hierarchy-map-kind {
  border-color: #79c0ff99;
  color: #cfe8ff;
}
.slidey-subset-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
}
.slidey-subset-row {
  min-height: 50px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 8px 9px;
}
.slidey-subset-row:hover {
  border-color: #d29922;
  background: #d2992224;
}
.slidey-subset-row.active {
  border-color: #d29922;
  background: #d299222b;
  box-shadow: inset 3px 0 0 #d29922;
}
.slidey-subset-main {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.slidey-subset-empty {
  padding: 12px 4px 2px;
  color: #6e7681;
  font-size: 12px;
}

@media (max-width: 760px) {
  .slidey-deck-chrome,
  body.slidey-embedded .slidey-deck-chrome,
  body.slidey-workspace.slidey-present-mode .slidey-deck-chrome {
    top: 0;
    left: 0;
    width: 100%;
    gap: 7px;
    padding: 5px 12px;
  }
  .slidey-deck-crumbs { display: none; }
  .slidey-collection-nav { margin-left: -12px; padding-right: 8px; padding-left: 12px; }
  .slidey-collection-tab { width: 47px; justify-content: center; padding: 0; }
  .slidey-collection-tab-label { display: none; }
  .slidey-library-affordance-up {
    top: calc(var(--slidey-topbar-h, 0px) + 12px);
    left: 12px;
    max-width: calc(100vw - 24px);
  }
  body.slidey-embedded .slidey-library-affordance-up,
  body.slidey-workspace.slidey-present-mode .slidey-library-affordance-up {
    top: calc(var(--slidey-topbar-h, 0px) + 12px);
  }
  .slidey-library-affordance-up.with-hierarchy-overlay {
    top: 103px;
  }
  body.slidey-embedded .slidey-library-affordance-up.with-hierarchy-overlay,
  body.slidey-workspace.slidey-present-mode .slidey-library-affordance-up.with-hierarchy-overlay {
    top: 147px;
  }
  .slidey-library-affordance-down {
    right: 12px;
    bottom: 72px;
    max-width: calc(100vw - 24px);
  }
  .slidey-collection-popover {
    width: min(520px, calc(100vw - 24px));
    max-height: min(560px, calc(100dvh - var(--slidey-topbar-h, 0px) - 16px));
  }
  .slidey-collection-popover-head {
    flex-direction: column;
    gap: 6px;
  }
  .slidey-collection-status {
    max-width: 100%;
  }
  .slidey-hierarchy-next-row {
    grid-template-columns: 64px minmax(0, 1fr);
  }
}

/* Save-conflict bar — concurrent edit detected; force an OURS/THEIRS choice. */
.slidey-conflict {
  position: fixed;
  top: 16px; left: 50%;
  transform: translateX(-50%);
  z-index: 2300;
  max-width: min(720px, 92vw);
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px;
  border: 1px solid #b06104;
  border-radius: 10px;
  background: #2a1d04;
  color: #f6dca0;
  font-family: 'Courier New', monospace;
  box-shadow: 0 8px 28px rgba(0,0,0,0.5);
}
.slidey-conflict-icon { color: #e3b341; font-size: 18px; line-height: 1.3; flex: none; }
.slidey-conflict-body { flex: 1 1 auto; min-width: 0; }
.slidey-conflict-title { font-weight: bold; font-size: 13px; margin-bottom: 4px; }
.slidey-conflict-msg { font-size: 12px; line-height: 1.45; color: #d6bd84; overflow-wrap: anywhere; }
.slidey-conflict-actions { display: flex; gap: 8px; flex: none; align-self: center; }
.slidey-conflict-actions button {
  border-radius: 7px;
  padding: 6px 14px; font-size: 12px; font-weight: bold;
  font-family: inherit; cursor: pointer; border: 1px solid transparent;
}
.slidey-conflict-actions button:disabled { cursor: default; opacity: 0.6; }
.slidey-conflict-ours { background: #1f6feb; color: #fff; }
.slidey-conflict-ours:hover:not(:disabled) { background: #388bfd; }
.slidey-conflict-theirs { background: transparent; border-color: #6e7681; color: #c9d1d9; }
.slidey-conflict-theirs:hover:not(:disabled) { border-color: #f0883e; color: #f0883e; }

/* ── Inline (in-place) text editing — only in edit mode ────────────────────── */
/* Hover affordance on anything click-to-editable. */
body.slidey-edit-mode [data-edit-path] {
  cursor: text;
}
body.slidey-edit-mode [data-edit-path]:hover {
  outline: 1.5px dashed rgba(56, 189, 248, 0.7);
  outline-offset: 2px;
  border-radius: 3px;
}
/* SVG <text> can't take an outline cleanly — tint it on hover instead. */
body.slidey-edit-mode svg text[data-edit-path]:hover {
  outline: none;
  fill: #38bdf8;
}
/* The element currently being edited in place (HTML contentEditable). */
.slidey-inline-editing {
  outline: 2px solid #1f6feb !important;
  outline-offset: 2px;
  border-radius: 3px;
  background: rgba(31, 111, 235, 0.08);
}
/* Overlay input used to edit SVG <text> (positioned in inline-edit.js). */
.slidey-inline-svg-input {
  padding: 2px 6px;
  border: 2px solid #1f6feb;
  border-radius: 4px;
  background: #0d1117;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
  outline: none;
  resize: none;
}

/* Empty-stage hint shown in workspace mode before a deck is opened. */
.slidey-stage-empty {
  position: fixed; top: var(--slidey-topbar-h, 0px); bottom: 0; right: 0;
  left: var(--slidey-sidebar-w, 300px);
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  color: #8b949e; font-family: 'Courier New', monospace;
  pointer-events: none;
}
</style>
