const BOOKMARKS_STORAGE_KEY = 'ratperaBookmarksData';
const NOTES_FALLBACK_KEY = 'ratperaNotesFallback';
const FEATURED_CATEGORY = 'Home';
const CATEGORY_PRIORITY = new Map([
  [FEATURED_CATEGORY, 0],
  ['Web', 1]
]);
const SAVED_TABS_STORAGE_KEY = 'savedTabs';
const SAVED_TABS_FALLBACK_KEY = 'ratperaSavedTabsFallback';
const MAX_SAVED_TAB_SETS = 20;

let bookmarksData = {};
let bookmarkFormInitialized = false;

function runWhenReady(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}

const extensionStorage = (() => {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return {
      async get(keys) {
        return new Promise((resolve, reject) => {
          try {
            chrome.storage.local.get(keys, (items) => {
              const error = chrome?.runtime?.lastError;
              if (error) {
                reject(new Error(error.message || 'Storage get failed'));
                return;
              }
              resolve(items || {});
            });
          } catch (error) {
            reject(error);
          }
        });
      },
      async set(items) {
        return new Promise((resolve, reject) => {
          try {
            chrome.storage.local.set(items, () => {
              const error = chrome?.runtime?.lastError;
              if (error) {
                reject(new Error(error.message || 'Storage set failed'));
                return;
              }
              resolve();
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    };
  }

  if (typeof browser !== 'undefined' && browser?.storage?.local) {
    return {
      get(keys) {
        return browser.storage.local.get(keys);
      },
      set(items) {
        return browser.storage.local.set(items);
      }
    };
  }

  return null;
})();

const tabsApi = (() => {
  if (typeof chrome !== 'undefined' && chrome?.tabs) {
    return chrome.tabs;
  }

  if (typeof browser !== 'undefined' && browser?.tabs) {
    return browser.tabs;
  }

  return null;
})();

const usesChromeTabs = typeof chrome !== 'undefined' && tabsApi && tabsApi === chrome.tabs;
const usesBrowserTabs = typeof browser !== 'undefined' && tabsApi && tabsApi === browser.tabs;

async function queryCurrentWindowTabs() {
  if (tabsApi && typeof tabsApi.query === 'function') {
    try {
      const tabs = await new Promise((resolve, reject) => {
        try {
          tabsApi.query({ currentWindow: true }, (result) => {
            if (chrome?.runtime?.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            resolve(Array.isArray(result) ? result : []);
          });
        } catch (error) {
          reject(error);
        }
      });
      if (tabs.length > 0) {
        return tabs;
      }
    } catch (error) {
      console.warn('Error querying tabs:', error);
    }
  }

  const savedRaw = localStorage.getItem(SAVED_TABS_FALLBACK_KEY);
  if (!savedRaw) {
    return [];
  }

  try {
    const saved = JSON.parse(savedRaw);
    if (Array.isArray(saved) && saved.length > 0) {
      const [latest] = saved;
      if (latest && Array.isArray(latest.tabs)) {
        return latest.tabs;
      }
    }
  } catch (error) {
    console.warn('Failed to parse saved tab fallback:', error);
  }

  return [];
}

function createTab(createProperties) {
  if (!tabsApi) {
    return Promise.reject(new Error('Tabs API unavailable'));
  }

  if (usesBrowserTabs && typeof tabsApi.create === 'function') {
    return tabsApi.create(createProperties);
  }

  return new Promise((resolve, reject) => {
    if (!tabsApi || typeof tabsApi.create !== 'function') {
      reject(new Error('Tabs API unavailable'));
      return;
    }

    try {
      tabsApi.create(createProperties, (tab) => {
        const runtimeError = typeof chrome !== 'undefined' && chrome?.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || 'Unknown error'));
          return;
        }

        resolve(tab || null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function readFallbackNotes() {
  try {
    const raw = localStorage.getItem(NOTES_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function writeFallbackNotes(notes) {
  try {
    localStorage.setItem(NOTES_FALLBACK_KEY, JSON.stringify(notes));
  } catch (error) {
    // ignore storage write failures
  }
}

async function loadNotesFromStorage() {
  if (extensionStorage) {
    try {
      const result = await extensionStorage.get(['notes']);
      if (result && typeof result.notes === 'object' && result.notes !== null) {
        return result.notes;
      }
    } catch (error) {
      // fall back to local copy below
    }
  }

  return readFallbackNotes();
}

function persistNotes(notes) {
  writeFallbackNotes(notes);

  if (extensionStorage) {
    extensionStorage.set({ notes }).catch(() => {
      // already written to the fallback store
    });
  }
}

function sanitizeSavedTabSets(rawSets) {
  if (!Array.isArray(rawSets)) {
    return [];
  }

  return rawSets
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const tabs = Array.isArray(entry.tabs)
        ? entry.tabs
            .map((tab) => {
              if (!tab || typeof tab !== 'object' || typeof tab.url !== 'string') {
                return null;
              }

              const trimmedUrl = tab.url.trim();
              if (!trimmedUrl) {
                return null;
              }

              return {
                url: trimmedUrl,
                title: typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : trimmedUrl,
                pinned: Boolean(tab.pinned)
              };
            })
            .filter(Boolean)
        : [];

      if (tabs.length === 0) {
        return null;
      }

      const savedAt = typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt)
        ? entry.savedAt
        : Date.now();

      const identifier = typeof entry.id === 'string' && entry.id
        ? entry.id
        : `saved-${savedAt}-${Math.random().toString(36).slice(2, 8)}`;

      return {
        id: identifier,
        savedAt,
        tabs
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt);
}

function readSavedTabsFallback() {
  try {
    const raw = localStorage.getItem(SAVED_TABS_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function writeSavedTabsFallback(sets) {
  try {
    localStorage.setItem(SAVED_TABS_FALLBACK_KEY, JSON.stringify(sets));
  } catch (error) {
    // ignore fallback write failures
  }
}

async function loadSavedTabSets() {
  if (extensionStorage) {
    try {
      const result = await extensionStorage.get([SAVED_TABS_STORAGE_KEY]);
      const sanitized = sanitizeSavedTabSets(result?.[SAVED_TABS_STORAGE_KEY]).slice(0, MAX_SAVED_TAB_SETS);
      if (sanitized.length > 0) {
        writeSavedTabsFallback(sanitized);
        return sanitized;
      }
    } catch (error) {
      // fall back to local storage below
    }
  }

  const fallback = sanitizeSavedTabSets(readSavedTabsFallback()).slice(0, MAX_SAVED_TAB_SETS);
  if (fallback.length > 0) {
    writeSavedTabsFallback(fallback);
  }
  return fallback;
}

function persistSavedTabSets(sets) {
  const sanitized = sanitizeSavedTabSets(sets);
  const limited = sanitized.slice(0, MAX_SAVED_TAB_SETS);
  writeSavedTabsFallback(limited);

  if (extensionStorage) {
    extensionStorage.set({ [SAVED_TABS_STORAGE_KEY]: limited }).catch(() => {
      // fallback already updated
    });
  }

  return limited;
}

function updateClock() {
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');
  if (!timeEl || !dateEl) {
    return;
  }

  const now = new Date();

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const day = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  timeEl.textContent = `${hours}:${minutes}:${seconds}`;
  dateEl.textContent = day;
}

runWhenReady(() => {
  updateClock();
  setInterval(updateClock, 1000);
});

function initializeSectionToggles() {
  let storedStates = {};
  const STORAGE_KEY = 'ratperaSectionToggles';

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    storedStates = raw ? JSON.parse(raw) : {};
  } catch (error) {
    storedStates = {};
  }

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedStates));
    } catch (error) {
      // ignore storage failures
    }
  };

  document.querySelectorAll('.section-toggle').forEach((button) => {
    const targetId = button.dataset.target;
    const content = document.getElementById(targetId);
    if (!targetId || !content) {
      return;
    }

    const openLabel = button.dataset.openLabel || 'Show';
    const closeLabel = button.dataset.closeLabel || 'Hide';
    const section = button.closest('section');
    const sectionId = (section && section.id) || targetId;
    const shouldStartOpen = storedStates[sectionId] === true;

    if (shouldStartOpen) {
      content.removeAttribute('hidden');
      button.textContent = closeLabel;
    } else {
      content.setAttribute('hidden', '');
      button.textContent = openLabel;
    }

    button.addEventListener('click', () => {
      const willOpen = content.hasAttribute('hidden');
      if (willOpen) {
        content.removeAttribute('hidden');
        button.textContent = closeLabel;
        storedStates[sectionId] = true;
      } else {
        content.setAttribute('hidden', '');
        button.textContent = openLabel;
        storedStates[sectionId] = false;
      }
      persist();
    });
  });
}

runWhenReady(initializeSectionToggles);

async function fetchDefaultBookmarks() {
  try {
    const response = await fetch('data/bookmarks.json');
    if (!response.ok) {
      throw new Error(`Failed to load bookmarks: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    return {};
  }
}

function normalizeUrl(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function saveBookmarks() {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarksData));
  } catch (error) {
    // ignore storage failures to keep UI responsive
  }
  updateCategorySelect();
}

function sortCategories(entries) {
  return entries.sort(([a], [b]) => {
    const aPriority = CATEGORY_PRIORITY.has(a) ? CATEGORY_PRIORITY.get(a) : 2;
    const bPriority = CATEGORY_PRIORITY.has(b) ? CATEGORY_PRIORITY.get(b) : 2;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return a.localeCompare(b);
  });
}

function updateCategorySelect() {
  const select = document.getElementById('bookmark-category');
  if (!select) return;
  const selectedValue = select.value;
  select.innerHTML = '';
  const sorted = sortCategories(Object.entries(bookmarksData));
  sorted.forEach(([category]) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
  if (selectedValue && bookmarksData[selectedValue]) {
    select.value = selectedValue;
  }
}

function renderBookmarks() {
  const container = document.getElementById('bookmark-list');
  if (!container) return;

  container.innerHTML = '';

  const categories = sortCategories(Object.entries(bookmarksData));

  categories.forEach(([category, info]) => {
    const catDiv = document.createElement('div');
    catDiv.classList.add('category');

    const headerRow = document.createElement('div');
    headerRow.classList.add('category-row');

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.classList.add('category-toggle');
    toggleBtn.textContent = category;

    const actions = document.createElement('div');
    actions.classList.add('category-actions');

    if (info.main) {
      const link = document.createElement('a');
      link.href = info.main;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '↗';
      link.classList.add('main-link');
      actions.appendChild(link);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.classList.add('icon-btn');
    removeBtn.title = `Remove ${category}`;
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (confirm(`Remove the ${category} category and all of its bookmarks?`)) {
        delete bookmarksData[category];
        saveBookmarks();
        renderBookmarks();
      }
    });

    actions.appendChild(removeBtn);

    headerRow.appendChild(toggleBtn);
    headerRow.appendChild(actions);

    const subsDiv = document.createElement('div');
    subsDiv.classList.add('sub-links');
    subsDiv.style.display = 'none';

    toggleBtn.addEventListener('click', () => {
      subsDiv.style.display = subsDiv.style.display === 'none' ? 'block' : 'none';
    });

    const subs = Object.entries(info.subs || {});
    if (subs.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('empty-message');
      empty.textContent = 'No bookmarks yet.';
      subsDiv.appendChild(empty);
    } else {
      subs.forEach(([name, url]) => {
        const subRow = document.createElement('div');
        subRow.classList.add('sub-link-row');

        const subLink = document.createElement('a');
        subLink.href = url;
        subLink.target = '_blank';
        subLink.rel = 'noopener noreferrer';
        subLink.textContent = name;

        const subRemoveBtn = document.createElement('button');
        subRemoveBtn.type = 'button';
        subRemoveBtn.classList.add('icon-btn');
        subRemoveBtn.title = `Remove ${name}`;
        subRemoveBtn.textContent = '✕';
        subRemoveBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          delete bookmarksData[category].subs[name];
          saveBookmarks();
          renderBookmarks();
        });

        subRow.appendChild(subLink);
        subRow.appendChild(subRemoveBtn);
        subsDiv.appendChild(subRow);
      });
    }

    catDiv.appendChild(headerRow);
    catDiv.appendChild(subsDiv);
    container.appendChild(catDiv);
  });
}

function attachBookmarkFormHandlers() {
  if (bookmarkFormInitialized) return;
  bookmarkFormInitialized = true;

  const form = document.getElementById('bookmark-form');
  if (!form) return;

  const nameInput = document.getElementById('bookmark-name');
  const urlInput = document.getElementById('bookmark-url');
  const categorySelect = document.getElementById('bookmark-category');
  const newCategoryInput = document.getElementById('new-category');
  const categoryMainInput = document.getElementById('category-main');

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    let url = normalizeUrl(urlInput.value.trim());
    const newCategory = newCategoryInput.value.trim();
    const categoryMain = normalizeUrl(categoryMainInput.value.trim());
    const selectedCategory = categorySelect.value;

    if (!name || !url) {
      return;
    }

    const category = newCategory || selectedCategory;
    if (!category) {
      alert('Select or create a category first.');
      return;
    }

    if (!bookmarksData[category]) {
      bookmarksData[category] = {
        main: categoryMain || url,
        subs: {}
      };
    } else if (categoryMain) {
      bookmarksData[category].main = categoryMain;
    }

    bookmarksData[category].subs = bookmarksData[category].subs || {};
    bookmarksData[category].subs[name] = url;

    saveBookmarks();
    renderBookmarks();

    form.reset();
    updateCategorySelect();
  });
}

async function loadBookmarks() {
  const container = document.getElementById('bookmark-list');
  if (!container) return;

  const defaults = await fetchDefaultBookmarks();
  let storedRaw = null;

  try {
    storedRaw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
  } catch (error) {
    storedRaw = null;
  }
  let stored = null;

  if (storedRaw) {
    try {
      stored = JSON.parse(storedRaw);
    } catch (error) {
      stored = null;
    }
  }

  bookmarksData = stored && typeof stored === 'object' ? stored : defaults;

  Object.entries(defaults).forEach(([category, info]) => {
    if (!bookmarksData[category]) {
      bookmarksData[category] = info;
    }
  });

  saveBookmarks();
  renderBookmarks();
  attachBookmarkFormHandlers();
}

runWhenReady(loadBookmarks);

// ==== NOTES SECTION ====

runWhenReady(() => {
  const tabs = document.querySelectorAll('.note-tab');
  const noteArea = document.getElementById('note-area');

  if (!noteArea || tabs.length === 0) {
    return;
  }

  let currentNote = 'story';
  let noteCache = {};

  const syncNoteArea = () => {
    noteArea.value = noteCache[currentNote] || '';
  };

  loadNotesFromStorage().then((notes) => {
    noteCache = notes;
    syncNoteArea();
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', async () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentNote = tab.dataset.note;

      if (!(currentNote in noteCache)) {
        const latest = await loadNotesFromStorage();
        noteCache = { ...latest, ...noteCache };
      }

      syncNoteArea();
    });
  });

  noteArea.addEventListener('input', () => {
    noteCache[currentNote] = noteArea.value;
    persistNotes(noteCache);
  });
});

// ==== CREATURE OF THE DAY ====

async function loadCreature() {
  const infoDiv = document.getElementById('creature-info');
  if (!infoDiv) return;

  let creatures = [];
  try {
    const response = await fetch('data/creatures.json');
    if (!response.ok) {
      throw new Error(`Failed to load creatures: ${response.status}`);
    }
    creatures = await response.json();
  } catch (error) {
    infoDiv.innerHTML = '<p>We could not fetch a creature today. Please try again later.</p>';
    return;
  }

  if (!Array.isArray(creatures) || creatures.length === 0) {
    infoDiv.innerHTML = '<p>No creatures available right now.</p>';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let storedRaw = null;
  try {
    storedRaw = localStorage.getItem('ratperaCreature');
  } catch (error) {
    storedRaw = null;
  }
  let stored = null;

  if (storedRaw) {
    try {
      stored = JSON.parse(storedRaw);
    } catch (error) {
      stored = null;
    }
  }

  let creature = null;

  if (stored && stored.date === today) {
    creature = creatures.find(item => item.name === stored.name) || null;
  }

  if (!creature) {
    const exclude = stored ? stored.name : null;
    const pool = creatures.filter(item => item.name !== exclude);
    const source = pool.length > 0 ? pool : creatures;
    creature = source[Math.floor(Math.random() * source.length)];
    try {
      localStorage.setItem('ratperaCreature', JSON.stringify({
        date: today,
        name: creature.name
      }));
    } catch (error) {
      // ignore persistence failures
    }
  }

  const name = creature.name;
  const fact = creature.fact;

  const wikiApi = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;

  try {
    const res = await fetch(wikiApi);
    const data = await res.json();
    const image = data.thumbnail?.source;
    const wikiUrl = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`;
    const desc = data.extract ? data.extract : fact;

    let imgHTML = '';
    if (image && !image.includes('svg') && data.thumbnail?.width > 150) {
      imgHTML = `<img src="${image}" alt="${name}" class="creature-img">`;
    }

    infoDiv.innerHTML = `
      ${imgHTML}
      <h3>${name}</h3>
      <p>${fact}</p>
      <p class="creature-description">${desc}</p>
      <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Learn more on Wikipedia</a>
    `;
  } catch (error) {
    infoDiv.innerHTML = `
      <h3>${name}</h3>
      <p>${fact}</p>
      <em>Wikipedia info unavailable.</em>
    `;
  }
}

runWhenReady(loadCreature);

async function loadDinosaur() {
  const infoDiv = document.getElementById('dino-info');
  if (!infoDiv) return;

  const dinos = Array.isArray(window.ratperaDinosaurs) ? window.ratperaDinosaurs : [];
  if (dinos.length === 0) {
    infoDiv.innerHTML = '<p>Our paleontologists are still dusting off the fossils. Check back soon!</p>';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let storedRaw = null;
  try {
    storedRaw = localStorage.getItem('ratperaDino');
  } catch (error) {
    storedRaw = null;
  }
  let stored = null;

  if (storedRaw) {
    try {
      stored = JSON.parse(storedRaw);
    } catch (error) {
      stored = null;
    }
  }

  let dino = null;

  if (stored && stored.date === today) {
    dino = dinos.find(item => item.name === stored.name) || null;
  }

  if (!dino) {
    const exclude = stored ? stored.name : null;
    const pool = dinos.filter(item => item.name !== exclude);
    const source = pool.length > 0 ? pool : dinos;
    dino = source[Math.floor(Math.random() * source.length)];
    try {
      localStorage.setItem('ratperaDino', JSON.stringify({
        date: today,
        name: dino.name
      }));
    } catch (error) {
      // ignore persistence failures
    }
  }

  const name = dino.name;
  const fact = dino.fact;

  const wikiApi = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;

  try {
    const res = await fetch(wikiApi);
    const data = await res.json();
    const image = data.thumbnail?.source;
    const wikiUrl = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`;
    const desc = data.extract ? data.extract : fact;

    let imgHTML = '';
    if (image && !image.includes('svg') && data.thumbnail?.width > 150) {
      imgHTML = `<img src="${image}" alt="${name}" class="creature-img">`;
    }

    infoDiv.innerHTML = `
      ${imgHTML}
      <h3>${name}</h3>
      <p>${fact}</p>
      <p class="creature-description">${desc}</p>
      <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Learn more on Wikipedia</a>
    `;
  } catch (error) {
    infoDiv.innerHTML = `
      <h3>${name}</h3>
      <p>${fact}</p>
      <em>Wikipedia info unavailable.</em>
    `;
  }
}

runWhenReady(loadDinosaur);

// ==== ARCADE ====

runWhenReady(() => {
  const launchBtn = document.getElementById('launch-2048');
  const frameWrapper = document.querySelector('#game .game-frame-wrapper');
  const frame = document.getElementById('game-2048');
  if (!launchBtn || !frame || !frameWrapper) return;

  const frameSrc = frame.dataset.src;

  launchBtn.addEventListener('click', () => {
    const isVisible = frameWrapper.classList.toggle('visible');
    launchBtn.textContent = isVisible ? 'Hide 2048' : 'Play 2048';

    if (isVisible && !frame.src) {
      frame.src = frameSrc;
    }
  });
});

runWhenReady(() => {
  const launchBtn = document.getElementById('launch-adarkroom');
  const frameWrapper = document.getElementById('adarkroom-wrapper');
  const frame = document.getElementById('game-adarkroom');
  if (!launchBtn || !frame || !frameWrapper) return;

  const frameSrc = frame.dataset.src;

  launchBtn.addEventListener('click', () => {
    const isVisible = frameWrapper.classList.toggle('visible');
    launchBtn.textContent = isVisible ? 'Leave the Dark Room' : 'Enter the Dark Room';

    if (isVisible && !frame.src) {
      frame.src = frameSrc;
    }
  });
});

// ==== SOUNDSCAPES ====

runWhenReady(() => {
  const toggleBtn = document.getElementById('orca-toggle');
  const frameContainer = document.getElementById('orca-frame');
  if (!toggleBtn || !frameContainer) return;

  const STREAM_URL = 'https://pro.stream101.com/player2/?ip=2&port=8047&username=smrucons';
  const FALLBACK_URL = 'https://live.orcasound.net/listen/orcasound-lab';
  const DEFAULT_PLACEHOLDER =
    'Click the button to open the live Orcasound hydrophone player.<span class="orca-note">Use the controls in the player to listen in.</span>';

  let iframe = null;

  const setPlaceholder = (messageHtml = DEFAULT_PLACEHOLDER) => {
    frameContainer.innerHTML = `<p class="orca-placeholder">${messageHtml}</p>`;
    frameContainer.classList.remove('active', 'error');
    toggleBtn.textContent = 'Open Live Stream';
  };

  const showError = () => {
    frameContainer.classList.add('error');
    frameContainer.innerHTML = `<p class="orca-placeholder">We couldn't load the stream. <a href="${FALLBACK_URL}" target="_blank" rel="noopener noreferrer">Open Orcasound in a new tab</a>.</p>`;
    toggleBtn.textContent = 'Retry Live Stream';
  };

  const openStream = () => {
    frameContainer.innerHTML = '';
    frameContainer.classList.add('active');
    frameContainer.classList.remove('error');

    iframe = document.createElement('iframe');
    iframe.src = STREAM_URL;
    iframe.title = 'Orcasound Live Hydrophone';
    iframe.loading = 'lazy';
    iframe.allow = 'autoplay';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.className = 'orca-embed';
    iframe.addEventListener('error', showError);

    frameContainer.appendChild(iframe);
    toggleBtn.textContent = 'Hide Live Stream';
  };

  const closeStream = () => {
    if (iframe) {
      iframe.remove();
      iframe = null;
    }
    setPlaceholder();
  };

  toggleBtn.addEventListener('click', () => {
    if (iframe) {
      closeStream();
    } else {
      openStream();
    }
  });

  setPlaceholder();
});

// ==== SAVE CURRENT TABS ====

runWhenReady(() => {
  const saveButton = document.getElementById('save-tabs-button');
  const statusEl = document.getElementById('save-tabs-status');
  const listContainer = document.getElementById('saved-tab-sets');

  if (!saveButton || !listContainer) {
    return;
  }

  let savedTabSets = [];

  const setStatus = (message) => {
    if (statusEl) {
      statusEl.textContent = message;
    }
  };

  const formatTimestamp = (timestamp) => {
    if (typeof timestamp !== 'number') {
      return 'Saved tabs';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return 'Saved tabs';
    }

    return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };

  const renderSavedSets = () => {
    listContainer.innerHTML = '';

    if (!savedTabSets.length) {
      const note = document.createElement('p');
      note.className = 'section-note';
      note.textContent = 'No saved tab collections yet. Save your current window to revisit it later.';
      listContainer.appendChild(note);
      return;
    }

    savedTabSets.forEach((set) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'saved-tabs-entry';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'session-entry';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'session-entry-title';
      const tabCount = Array.isArray(set.tabs) ? set.tabs.length : 0;
      titleSpan.textContent = `${formatTimestamp(set.savedAt)} – ${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}`;
      openButton.appendChild(titleSpan);

      const firstTab = Array.isArray(set.tabs) && set.tabs.length > 0 ? set.tabs[0] : null;
      if (firstTab && (firstTab.title || firstTab.url)) {
        const detailSpan = document.createElement('span');
        detailSpan.className = 'session-entry-detail';
        detailSpan.textContent = firstTab.title || firstTab.url;
        openButton.appendChild(detailSpan);
      }

      openButton.addEventListener('click', () => {
        openSavedTabSet(set, openButton);
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'saved-tabs-delete';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', 'Delete saved tab set');
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        removeSavedSet(set.id);
      });

      wrapper.appendChild(openButton);
      wrapper.appendChild(deleteButton);
      listContainer.appendChild(wrapper);
    });
  };

  const removeSavedSet = (id) => {
    savedTabSets = savedTabSets.filter((set) => set.id !== id);
    savedTabSets = persistSavedTabSets(savedTabSets);
    renderSavedSets();
    setStatus('Removed saved tabs.');
  };

  const openSavedTabSet = async (set, triggerButton) => {
    if (!tabsApi) {
      setStatus('Opening saved tabs is not supported in this browser.');
      return;
    }

    const validTabs = Array.isArray(set.tabs)
      ? set.tabs.filter((tab) => {
          if (!tab || typeof tab.url !== 'string') {
            return false;
          }
          return !/^(chrome|edge|opera|about|devtools|view-source):/i.test(tab.url);
        })
      : [];

    if (!validTabs.length) {
      setStatus('No valid tabs to open from this saved set.');
      return;
    }

    const buttons = new Set([saveButton]);
    if (triggerButton) {
      buttons.add(triggerButton);
    }

    buttons.forEach((btn) => {
      if (btn) {
        btn.disabled = true;
      }
    });

    setStatus(`Opening ${validTabs.length} saved ${validTabs.length === 1 ? 'tab' : 'tabs'}...`);

    try {
      for (const tab of validTabs) {
        const createProperties = { url: tab.url };
        if (tab.pinned) {
          createProperties.pinned = true;
        }
        await createTab(createProperties);
      }

      setStatus(`Opened ${validTabs.length} saved ${validTabs.length === 1 ? 'tab' : 'tabs'}.`);
    } catch (error) {
      setStatus(`Could not open saved tabs: ${error?.message || 'Unknown error'}`);
    } finally {
      buttons.forEach((btn) => {
        if (btn) {
          btn.disabled = false;
        }
      });
    }
  };

  const refreshSavedSets = async () => {
    listContainer.textContent = 'Loading saved tab collections...';
    savedTabSets = await loadSavedTabSets();
    renderSavedSets();
  };

  if (!tabsApi) {
    saveButton.disabled = true;
    setStatus('Saving tabs is not supported in this browser.');
    refreshSavedSets();
    return;
  }

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    setStatus('Saving current window tabs...');

    try {
      const tabs = await queryCurrentWindowTabs();
      const usableTabs = tabs
        .filter((tab) => tab && typeof tab.url === 'string' && tab.url && !/^(chrome|edge|opera|about|devtools|view-source):/i.test(tab.url))
        .map((tab) => ({
          url: tab.url,
          title: tab.title || tab.url,
          pinned: Boolean(tab.pinned)
        }));

      if (usableTabs.length === 0) {
        setStatus('No tabs available to save from this window.');
        return;
      }

      const timestamp = Date.now();
      const savedSet = {
        id: `saved-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: timestamp,
        tabs: usableTabs
      };

      savedTabSets = persistSavedTabSets([savedSet, ...savedTabSets]);
      renderSavedSets();
      setStatus(`Saved ${usableTabs.length} ${usableTabs.length === 1 ? 'tab' : 'tabs'} from this window.`);
    } catch (error) {
      setStatus(`Could not save tabs: ${error?.message || 'Unknown error'}`);
    } finally {
      saveButton.disabled = false;
    }
  });

  refreshSavedSets();
});

