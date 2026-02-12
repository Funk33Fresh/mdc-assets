'use strict';
(() => {
  const DEBUG = false;
  const API_BASE = window.MDC_API_BASE || 'https://n8n.flwrks.com/webhook';
  const CACHE_VERSION = 'v1';
  const CONSTANTS = {
    API_BASE,
    ENDPOINTS: {
      PROPERTIES: `${API_BASE}/site/properties`,
      PROPERTY_INFO: `${API_BASE}/property`,
      PROPERTIES_SIMILAR: `${API_BASE}/site/properties-similar`,
      FILTERS_DYNAMIC: `${API_BASE}/site/filters-dynamic`
    },
    TIMEOUTS: { DEFAULT: 10000, CRITICAL: 5000, NON_CRITICAL: 15000 },
    CACHE: {
      MEMORY_TTL: 300000,
      SESSION_TTL: 600000,
      MAX_SESSION_SIZE: 512000,
      VERSION: CACHE_VERSION
    },
    BATCH: { SIZE: 24, DELAY: 100 },
    CONCURRENT_REQUESTS: 6
  };
  // Allow re-initialization if needed, but preserve existing pages
  if (!window.MDC) {
    window.MDC = { pages: {}, util: {}, constants: CONSTANTS };
  } else {
    // Preserve existing pages if MDC already exists
    if (!window.MDC.pages) window.MDC.pages = {};
    if (!window.MDC.util) window.MDC.util = {};
    if (!window.MDC.constants) window.MDC.constants = CONSTANTS;
    if (DEBUG) console.warn('MDC: Already initialized, preserving existing state');
  }

  // ----- URL helpers (clean URLs SEO) -----
  const slugifyCity = (str) => {
    if (!str || typeof str !== 'string') return '';
    const t = str.trim().toLowerCase()
      .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i').replace(/ș/g, 's').replace(/ş/g, 's').replace(/ț/g, 't').replace(/ţ/g, 't')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return t;
  };
  const TYPE_TO_SLUG = {
    'apartament': 'apartamente',
    'casa': 'case', 'vila': 'case',
    'teren': 'terenuri',
    'spatiu comercial': 'spatii-comerciale', 'spațiu comercial': 'spatii-comerciale',
    'birou': 'birouri',
    'hala': 'hale',
    'hotel': 'hoteluri-pensiuni', 'pensiune': 'hoteluri-pensiuni', 'hotel / pensiune': 'hoteluri-pensiuni'
  };
  const SLUG_TO_TYPE = {
    'apartamente': 'apartament',
    'case': 'casa',
    'terenuri': 'teren',
    'spatii-comerciale': 'spatiu comercial',
    'birouri': 'birou',
    'hale': 'hala',
    'hoteluri-pensiuni': 'apartament',
    'proprietati': null
  };
  const CITY_SLUG_TO_NAME = {
    'cluj-napoca': 'Cluj-Napoca',
    'bucuresti': 'București',
    'timisoara': 'Timișoara',
    'iasi': 'Iași',
    'constanta': 'Constanța',
    'craiova': 'Craiova',
    'brasov': 'Brașov',
    'galati': 'Galați',
    'ploiesti': 'Ploiești',
    'oradea': 'Oradea',
    'sibiu': 'Sibiu',
    'arad': 'Arad',
    'pitesti': 'Pitești',
    'bacau': 'Bacău',
    'targu-mures': 'Târgu Mureș',
    'baia-mare': 'Baia Mare',
    'buzau': 'Buzău',
    'satu-mare': 'Satu Mare',
    'botosani': 'Botoșani',
    'suceava': 'Suceava'
  };
  const buildResultsCleanUrl = ({ transaction, type, city }) => {
    if (!transaction || !city) return null;
    const trSlug = transaction === 'rent' ? 'de-inchiriere' : 'de-vanzare';
    const citySlug = slugifyCity(city);
    if (!citySlug) return null;
    let prefix = 'proprietati';
    if (type && typeof type === 'string') {
      const typeNorm = type.toLowerCase().trim();
      prefix = TYPE_TO_SLUG[typeNorm] || typeNorm.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'proprietati';
    }
    return `/${prefix}-${trSlug}-${citySlug}`;
  };
  const parseResultsFromUrl = (location) => {
    const pathname = (location && location.pathname) || '';
    const search = (location && location.search) || '';
    const isLegacyPath = pathname === '/results' || pathname === '/rezultate';
    const params = new URLSearchParams(search);
    const get = (k) => params.get(k);
    const getNum = (k) => { const v = get(k); return v ? (Number.isFinite(+v) ? +v : null) : null; };
    const getDecoded = (k) => { const v = get(k); return v ? decodeURIComponent(v) : null; };
    if (isLegacyPath) {
      const parsed = {
        transaction: get('transaction') || 'any',
        scope: get('scope') || 'any',
        tip: getDecoded('type') || getDecoded('tip'),
        city: getDecoded('city'),
        zone: getDecoded('zone'),
        country: getDecoded('country'),
        rooms: getNum('rooms'),
        min_price: getNum('min_price'),
        max_price: getNum('max_price')
      };
      Object.keys(parsed).forEach(k => {
        if (parsed[k] === null || parsed[k] === '') delete parsed[k];
      });
      parsed.scope = parsed.scope || 'any';
      parsed.transaction = parsed.transaction || 'any';
      return parsed;
    }
    // Clean path: parse pathname "-de-" segments
    const path = pathname.replace(/^\/+|\/+$/g, '');
    const parts = path ? path.split('-de-') : [];
    const result = { transaction: 'any', scope: 'any' };
    if (parts.length >= 3) {
      const typeSlug = parts[0];
      const trSlug = parts[1];
      const citySlug = parts.slice(2).join('-');
      result.transaction = (trSlug === 'inchiriere') ? 'rent' : (trSlug === 'vanzare') ? 'sale' : 'any';
      result.tip = SLUG_TO_TYPE[typeSlug] !== undefined ? SLUG_TO_TYPE[typeSlug] : (typeSlug === 'proprietati' ? null : typeSlug.replace(/-/g, ' '));
      result.city = CITY_SLUG_TO_NAME[citySlug] || citySlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    const scope = getDecoded('scope') || get('scope');
    if (scope) result.scope = scope;
    const tipFromQ = getDecoded('type') || getDecoded('tip');
    if (tipFromQ) result.tip = tipFromQ;
    const zone = getDecoded('zone');
    if (zone) result.zone = zone;
    const country = getDecoded('country');
    if (country) result.country = country;
    const rooms = getNum('rooms');
    if (rooms != null) result.rooms = rooms;
    const min_price = getNum('min_price');
    if (min_price != null) result.min_price = min_price;
    const max_price = getNum('max_price');
    if (max_price != null) result.max_price = max_price;
    return result;
  };
  const buildPropertyCleanUrl = (slug) => {
    if (!slug || typeof slug !== 'string') return '/proprietate';
    return '/proprietate/' + encodeURIComponent(slug.trim());
  };
  const parsePropertyIdFromUrl = (location) => {
    const out = {};
    const pathname = (location && location.pathname) || '';
    const search = (location && location.search) || '';
    const pathMatch = pathname.match(/^\/proprietate\/([^/]+)$/i);
    if (pathMatch) {
      try {
        out.slug = decodeURIComponent(pathMatch[1]);
      } catch (e) {
        out.slug = pathMatch[1];
      }
    }
    const params = new URLSearchParams(search);
    const slugQ = params.get('slug');
    if (slugQ) out.slug = slugQ;
    const crmIdQ = params.get('crm_id');
    if (crmIdQ) {
      const id = parseInt(crmIdQ, 10);
      if (Number.isFinite(id) && id > 0) out.crm_id = id;
    }
    return out;
  };
  window.MDC.urlHelpers = {
    slugifyCity,
    buildResultsCleanUrl,
    parseResultsFromUrl,
    buildPropertyCleanUrl,
    parsePropertyIdFromUrl
  };

  const Logger = {
    log: (...args) => DEBUG && console.log('[MDC]', ...args),
    warn: (...args) => DEBUG && console.warn('[MDC]', ...args),
    error: (...args) => console.error('[MDC]', ...args),
    time: (label) => DEBUG && console.time(`[MDC] ${label}`),
    timeEnd: (label) => DEBUG && console.timeEnd(`[MDC] ${label}`)
  };
  class NetworkManager {
    constructor() {
      this.memoryCache = new Map();
      this.inFlight = new Map();
      this.requestQueue = [];
      this.activeRequests = 0;
      this.cleanupInterval = null;
      this.startCleanupInterval();
    }
    startCleanupInterval() {
      if (this.cleanupInterval) return;
      this.cleanupInterval = setInterval(() => this.cleanupExpiredCache(), 60000);
    }
    getCacheKey(url, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      const body = options.body ? JSON.stringify(options.body) : '';
      return `${method}:${url}:${body}`;
    }
    getSessionKey(cacheKey) {
      return `mdc_cache_${CONSTANTS.CACHE.VERSION}_${btoa(cacheKey).replace(/[+/=]/g, '')}`;
    }
    getFromMemoryCache(cacheKey) {
      const cached = this.memoryCache.get(cacheKey);
      if (!cached) return null;
      if (Date.now() > cached.expires) {
        this.memoryCache.delete(cacheKey);
        return null;
      }
      return cached.data;
    }
    getFromSessionCache(cacheKey) {
      try {
        const sessionKey = this.getSessionKey(cacheKey);
        const stored = sessionStorage.getItem(sessionKey);
        if (!stored) return null;
        const cached = JSON.parse(stored);
        if (Date.now() > cached.expires) {
          sessionStorage.removeItem(sessionKey);
          return null;
        }
        if (stored.length > CONSTANTS.CACHE.MAX_SESSION_SIZE) {
          sessionStorage.removeItem(sessionKey);
          return null;
        }
        return cached.data;
      } catch {
        return null;
      }
    }
    setMemoryCache(cacheKey, data, ttl = CONSTANTS.CACHE.MEMORY_TTL) {
      this.memoryCache.set(cacheKey, { data, expires: Date.now() + ttl });
    }
    setSessionCache(cacheKey, data, ttl = CONSTANTS.CACHE.SESSION_TTL) {
      try {
        const sessionKey = this.getSessionKey(cacheKey);
        const cached = { data, expires: Date.now() + ttl };
        const serialized = JSON.stringify(cached);
        if (serialized.length > CONSTANTS.CACHE.MAX_SESSION_SIZE) {
          Logger.warn('Cache entry too large');
          return;
        }
        sessionStorage.setItem(sessionKey, serialized);
      } catch (e) {
        Logger.warn('Failed to set sessionStorage cache:', e);
      }
    }
    cleanupExpiredCache() {
      const now = Date.now();
      for (const [key, value] of this.memoryCache.entries()) {
        if (now > value.expires) this.memoryCache.delete(key);
      }
      try {
        const prefix = `mdc_cache_${CONSTANTS.CACHE.VERSION}_`;
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith(prefix)) {
            try {
              const cached = JSON.parse(sessionStorage.getItem(key));
              if (now > cached.expires) keysToRemove.push(key);
            } catch {
              keysToRemove.push(key);
            }
          }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
      } catch (e) {}
    }
    shouldUseSessionCache(url) {
      const safeEndpoints = ['/site/properties', '/property', '/site/properties-similar'];
      return safeEndpoints.some(endpoint => url.includes(endpoint));
    }
    async fetch(url, options = {}) {
      const {
        timeout = CONSTANTS.TIMEOUTS.DEFAULT,
        retries = 0,
        retryDelay = 1000,
        useCache = true,
        useSessionCache = false,
        signal
      } = options;
      let requestUrl = url;
      if (typeof url === 'string' && (url.includes('webhook') || url.includes('n8n'))) {
        try {
          const u = new URL(url);
          if (!u.searchParams.has('_origin') && typeof window !== 'undefined' && window.location && window.location.origin)
            u.searchParams.set('_origin', window.location.origin);
          requestUrl = u.toString();
        } catch (e) {}
      }
      const cacheKey = this.getCacheKey(requestUrl, options);
      const useSession = useSessionCache || this.shouldUseSessionCache(url);
      if (useCache) {
        const cached = this.getFromMemoryCache(cacheKey);
        if (cached !== null) {
          Logger.log('Cache hit (memory):', requestUrl);
          return Promise.resolve(cached);
        }
        if (useSession) {
          const sessionCached = this.getFromSessionCache(cacheKey);
          if (sessionCached !== null) {
            Logger.log('Cache hit (session):', requestUrl);
            this.setMemoryCache(cacheKey, sessionCached);
            return Promise.resolve(sessionCached);
          }
        }
      }
      if (this.inFlight.has(cacheKey)) {
        Logger.log('Request deduplication:', requestUrl);
        return this.inFlight.get(cacheKey);
      }
      const controller = signal || new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const requestPromise = this.executeRequest(requestUrl, options, controller, retries, retryDelay)
        .then(data => {
          clearTimeout(timeoutId);
          this.inFlight.delete(cacheKey);
          this.activeRequests--;
          this.processQueue();
          if (useCache) {
            this.setMemoryCache(cacheKey, data);
            if (useSession) this.setSessionCache(cacheKey, data);
          }
          return data;
        })
        .catch(error => {
          clearTimeout(timeoutId);
          this.inFlight.delete(cacheKey);
          this.activeRequests--;
          this.processQueue();
          throw error;
        });
      if (this.activeRequests >= CONSTANTS.CONCURRENT_REQUESTS) {
        this.requestQueue.push({ url, options, promise: requestPromise });
      } else {
        this.activeRequests++;
        this.inFlight.set(cacheKey, requestPromise);
      }
      return requestPromise;
    }
    async executeRequest(url, options, controller, retries, retryDelay) {
      const defaultOptions = {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      };
      let attempt = 0;
      const maxAttempts = retries + 1;
      while (attempt < maxAttempts) {
        try {
          const response = await fetch(url, { ...defaultOptions, ...options });
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
          return await response.json();
        } catch (error) {
          attempt++;
          if (error.name === 'AbortError') throw error;
          if (error.message.includes('HTTP 4')) throw error;
          if (attempt < maxAttempts) {
            const delay = retryDelay * Math.pow(2, attempt - 1);
            Logger.log(`Retrying in ${delay}ms (${attempt}/${maxAttempts}):`, url);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw error;
          }
        }
      }
    }
    processQueue() {
      if (this.requestQueue.length === 0 || this.activeRequests >= CONSTANTS.CONCURRENT_REQUESTS) return;
      const next = this.requestQueue.shift();
      this.activeRequests++;
      const cacheKey = this.getCacheKey(next.url, next.options);
      this.inFlight.set(cacheKey, next.promise);
    }
    clearCache(pattern = null) {
      if (pattern) {
        for (const key of this.memoryCache.keys()) {
          if (key.includes(pattern)) this.memoryCache.delete(key);
        }
      } else {
        this.memoryCache.clear();
      }
      try {
        const prefix = `mdc_cache_${CONSTANTS.CACHE.VERSION}_`;
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith(prefix)) {
            if (!pattern || key.includes(pattern)) keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
      } catch (e) {}
    }
  }
  const networkManager = new NetworkManager();
  const DOMCache = {
    cache: new WeakMap(),
    get(cardEl, selector) {
      if (!cardEl) return null;
      let cardCache = this.cache.get(cardEl);
      if (!cardCache) {
        cardCache = new Map();
        this.cache.set(cardEl, cardCache);
      }
      if (cardCache.has(selector)) return cardCache.get(selector);
      const element = cardEl.querySelector(selector);
      cardCache.set(selector, element);
      return element;
    },
    getAll(cardEl, selector) {
      if (!cardEl) return [];
      const cacheKey = `all:${selector}`;
      let cardCache = this.cache.get(cardEl);
      if (!cardCache) {
        cardCache = new Map();
        this.cache.set(cardEl, cardCache);
      }
      if (cardCache.has(cacheKey)) return cardCache.get(cacheKey);
      const elements = Array.from(cardEl.querySelectorAll(selector));
      cardCache.set(cacheKey, elements);
      return elements;
    },
    clear(cardEl) {
      if (cardEl) this.cache.delete(cardEl);
    }
  };
  const batchDOMUpdates = (fn) => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 0);
    }
  };
  window.MDC.util.q = (s, r = document) => r.querySelector(s);
  window.MDC.util.qa = (s, r = document) => [...r.querySelectorAll(s)];
  const $ = window.MDC.util.q;
  const $$ = window.MDC.util.qa;
  const fetchJSON = async (url, options = {}) => {
    return networkManager.fetch(url, {
      ...options,
      useCache: options.useCache !== false,
      useSessionCache: options.useSessionCache !== false
    });
  };
  const FavoritesStorage = {
    key: 'mdc_favorites',
    get: () => {
      try {
        const stored = localStorage.getItem(FavoritesStorage.key);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    },
    set: (ids) => {
      try {
        localStorage.setItem(FavoritesStorage.key, JSON.stringify(ids));
        return true;
      } catch {
        return false;
      }
    },
    add: (crmId) => {
      const ids = FavoritesStorage.get();
      if (!ids.includes(crmId)) {
        ids.push(crmId);
        FavoritesStorage.set(ids);
      }
    },
    remove: (crmId) => {
      const ids = FavoritesStorage.get();
      const filtered = ids.filter(id => id !== crmId);
      FavoritesStorage.set(filtered);
    },
    has: (crmId) => FavoritesStorage.get().includes(crmId)
  };
  const safeText = (v) => {
    const s = String(v ?? '').trim();
    return s || '';
  };
  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => (clearTimeout(t), t = setTimeout(() => fn(...a), ms));
  };
  const setText = (el, v) => {
    if (!el) return;
    el.textContent = safeText(v);
  };
  const preloadImage = (url, timeout = 10000) => {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error('No URL provided'));
        return;
      }
      const img = new Image();
      const timeoutId = setTimeout(() => reject(new Error('Image load timeout')), timeout);
      img.onload = () => {
        clearTimeout(timeoutId);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Image load failed'));
      };
      img.src = url;
    });
  };
  const preloadImages = async (urls, options = {}) => {
    const { timeout = 10000, minLoaded = 1, onProgress = null } = options;
    if (!urls || urls.length === 0) return { loaded: [], failed: [] };
    const results = { loaded: [], failed: [] };
    const promises = urls.map((url, index) => {
      return preloadImage(url, timeout)
        .then(img => {
          results.loaded.push({ url, index, img });
          if (onProgress) onProgress({ url, index, status: 'loaded', total: urls.length, loaded: results.loaded.length });
          return { url, index, img };
        })
        .catch(err => {
          results.failed.push({ url, index, error: err });
          if (onProgress) onProgress({ url, index, status: 'failed', total: urls.length, loaded: results.loaded.length });
          return null;
        });
    });
    await Promise.allSettled(promises);
    if (results.loaded.length >= minLoaded) return results;
    await new Promise(resolve => setTimeout(resolve, 500));
    return results;
  };
  const optimizeImageUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|iPhone/i.test(navigator.userAgent);
    if (!isMobile) return url;
    try {
      const u = new URL(url);
      if (!u.searchParams.has('w')) u.searchParams.set('w', '800');
      if (!u.searchParams.has('q')) u.searchParams.set('q', '85');
      return u.toString();
    } catch {
      return url + (url.includes('?') ? '&' : '?') + 'w=800&q=85';
    }
  };
  const setImg = (img, url, options = {}) => {
    if (!img) return;
    const u = safeText(url);
    if (!u) {
      img.style.display = 'none';
      return;
    }
    const { lazy = true, critical = false, decoding = 'async', preloaded = false, fetchPriority = null } = options;
    const optimizedUrl = optimizeImageUrl(u);
    img.style.display = '';
    if (img.decoding !== undefined) img.decoding = decoding;
    if (fetchPriority && 'fetchPriority' in img) {
      img.fetchPriority = fetchPriority;
    } else if (fetchPriority) {
      img.setAttribute('fetchpriority', fetchPriority);
    }
    if (lazy && !critical) {
      img.setAttribute('loading', 'lazy');
    } else {
      img.setAttribute('loading', 'eager');
    }
    img.setAttribute('src', optimizedUrl);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
    if (preloaded) {
      img.style.opacity = '1';
    } else {
      img.style.opacity = '0';
      img.onload = () => { img.style.opacity = '1'; };
    }
    img.onerror = () => { img.style.display = 'none'; };
  };
  const formatMoney = (amount, currency, pret_fara_tva = null) => {
    const priceValue = toNum(amount);
    if (priceValue === null || priceValue === 0) return null;
    const cur = safeText(currency) || 'EUR';
    const formatted = Math.round(priceValue).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const symbol = cur === 'EUR' ? '€' : cur;
    const basePrice = `${formatted}${symbol}`;
    // Show "+ TVA" when flag is explicitly set (accept both number 1 and string "1")
    if (pret_fara_tva === 1 || pret_fara_tva === '1') return `${basePrice} + TVA`;
    return basePrice;
  };
  const formatNumber = (num) => {
    const n = toNum(num);
    if (n === null) return '';
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };
  const titleCaseRo = (s) =>
    String(s || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
      .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ').replace(/\bVila\b/i, 'vilă').replace(/\bInchiriere\b/i, 'Închiriere');
  const formatTipBadge = (tip) => {
    const t = safeText(tip);
    if (!t) return '';
    const lower = t.toLowerCase().trim();
    if (lower === 'speciale' || lower.includes('special')) return 'Proprietate specială';
    if (lower.includes('casa') && lower.includes('vila')) return 'Casă / Vilă';
    if (lower.includes('casa') || lower === 'casă') return 'Casă';
    if (lower.includes('vila') || lower === 'vilă') return 'Vilă';
    return titleCaseRo(t);
  };
  const buildFeatures = (p) => {
    if (!p || typeof p !== 'object') {
      return { f1: '', f2: '', f3: '', f1_icon: null, f2_icon: null, f3_icon: null };
    }
    const tip = safeText(p.tip_proprietate || p.tip || p.property_type || '').toLowerCase();
    const rooms = toNum(p.rooms);
    const area = toNum(p.usable_area || p.area);
    const roomsLabel = safeText(p.rooms_label) || 'camere';
    const empty = { f1_icon: null, f2_icon: null, f3_icon: null };
    if (tip.includes('teren')) {
      return {
        f1: toNum(p.land_area) ? `${p.land_area} mp` : '—',
        f2: toNum(p.front_stradal) ? `FS ${p.front_stradal} m` : '—',
        f3: safeText(p.land_classification) || '—',
        f1_icon: 'https://cdn.prod.website-files.com/692f41901d906e4e89121e9e/692f68c7df6cfa09bb83d5f7_icon-SUPRAFATA.svg',
        f2_icon: 'https://cdn.prod.website-files.com/692f41901d906e4e89121e9e/697241911ae6d73bf69d5be3_front-stradal.svg',
        f3_icon: 'https://cdn.prod.website-files.com/692f41901d906e4e89121e9e/69724191a8a865aa81e63cab_intra-extra-vilan.svg'
      };
    }
    if (tip.includes('apart')) {
      let floorText = '';
      const floorVal = toNum(p.floor);
      if (floorVal === 0) {
        floorText = 'Parter';
      } else if (floorVal !== null && floorVal !== undefined) {
        floorText = `Etaj ${floorVal}`;
      }
      return {
        f1: rooms ? `${rooms} ${roomsLabel}` : '—',
        f2: floorText,
        f3: area ? `${area} mp` : '—',
        ...empty
      };
    }
    if (tip.includes('casa') || tip.includes('vil')) {
      return {
        f1: rooms ? `${rooms} ${roomsLabel}` : '—',
        f2: toNum(p.nrbai || p.bathrooms || p.baths) ? `${p.nrbai || p.bathrooms || p.baths} băi` : '',
        f3: area ? `${area} mp` : '—',
        f1_icon: null,
        f2_icon: 'https://cdn.prod.website-files.com/692f41901d906e4e89121e9e/692f68c61dbdf7d447923ac2_icon-BAIE.svg',
        f3_icon: null
      };
    }
    return {
      f1: rooms ? `${rooms} ${roomsLabel}` : '—',
      f2: toNum(p.levels) ? `${p.levels} nivele` : '',
      f3: area ? `${area} mp` : '—',
      ...empty
    };
  };
  const fillCard = (cardEl, p) => {
    if (!cardEl || !p || typeof p !== 'object') return;
    const id = toNum(p.crm_id || p.id);
    const f = buildFeatures(p);
    const tEl = DOMCache.get(cardEl, '[data-bind="transaction"]');
    const priceEl = DOMCache.get(cardEl, '[data-bind="price"]');
    const titleEl = DOMCache.get(cardEl, '[data-bind="title"]');
    const locationEl = DOMCache.get(cardEl, '[data-bind="location"]');
    const imageEl = DOMCache.get(cardEl, '[data-bind="image"]') || DOMCache.get(cardEl, '.img-card[data-bind="image"]');
    const badgeEl = DOMCache.get(cardEl, '[data-bind="badge-tip"]') || 
                    DOMCache.get(cardEl, '[data-bind="tip-proprietate"]') || 
                    DOMCache.get(cardEl, '.badge-tip-proprietate [data-bind]') || 
                    DOMCache.get(cardEl, '.badge-tip-proprietate');
    const favBtn = DOMCache.get(cardEl, '[data-action="favorite"]');
    const shareBtn = DOMCache.get(cardEl, '[data-action="share"]');
    batchDOMUpdates(() => {
      if (tEl) {
        const tr = safeText(p.transaction);
        setText(tEl, tr === 'rent' ? 'Închiriere' : tr === 'sale' ? 'Vânzare' : '');
      }
      if (priceEl) {
        const priceValue = toNum(p.price) || toNum(p.sale_price) || toNum(p.rent_price);
        const currencyValue = p.currency || p.sale_currency || p.rent_currency || 'EUR';
        const pret_fara_tva = p.pret_fara_tva !== undefined ? p.pret_fara_tva : null;
        setText(priceEl, priceValue !== null ? formatMoney(priceValue, currencyValue, pret_fara_tva) : 'Preț la cerere');
      }
      if (titleEl) {
        setText(titleEl, safeText(p.title_ro) || safeText(p.title) || '');
        titleEl.style.display = '-webkit-box';
        titleEl.style.webkitLineClamp = '2';
        titleEl.style.webkitBoxOrient = 'vertical';
        titleEl.style.overflow = 'hidden';
      }
      if (locationEl) {
        const city = safeText(p.city_name);
        const zone = safeText(p.zone_name);
        setText(locationEl, [city, zone].filter(Boolean).join(', '));
      }
      if (imageEl) {
        const isFirstCard = !cardEl.previousElementSibling || 
                          !cardEl.previousElementSibling.classList.contains('card-property');
        const imageUrl = p.cover_image_url || p.image_url || p.image || null;
        setImg(imageEl, imageUrl, { lazy: !isFirstCard, critical: isFirstCard });
        if (imageUrl) {
          imageEl.setAttribute('data-mdc-loaded', '1');
          imageEl.classList.add('mdc-image-reveal');
        }
        setupCardImageHover(cardEl, imageEl);
      }
      if (badgeEl) {
        const wrap = badgeEl.closest('.badge-tip-proprietate') || badgeEl;
        const label = formatTipBadge(p.tip_proprietate || p.tip || p.property_type);
        if (label) {
          wrap.style.display = '';
          const labelEl = badgeEl.querySelector('[data-bind]') || badgeEl.querySelector('*') || badgeEl;
          setText(labelEl, label);
        } else {
          wrap.style.display = 'none';
        }
      }
      const fEls = {
        f1: DOMCache.get(cardEl, '[data-bind="f1"]'),
        f2: DOMCache.get(cardEl, '[data-bind="f2"]'),
        f3: DOMCache.get(cardEl, '[data-bind="f3"]')
      };
      if (fEls.f1) setText(fEls.f1, f.f1 || '');
      if (fEls.f2) setText(fEls.f2, f.f2 || '');
      if (fEls.f3) setText(fEls.f3, f.f3 || '');
      for (let i = 1; i <= 3; i++) {
        const iconEl = DOMCache.get(cardEl, `[data-bind="f${i}_icon"]`);
        if (iconEl && f[`f${i}_icon`]) {
          if (iconEl.tagName === 'IMG') {
            iconEl.src = f[`f${i}_icon`];
          } else {
            iconEl.setAttribute('src', f[`f${i}_icon`]);
          }
        }
        const wrap = DOMCache.get(cardEl, `[data-feature-slot="${i}"]`);
        if (wrap) wrap.style.display = (f[`f${i}`] === '' || !f[`f${i}`]) ? 'none' : '';
      }
    });
    if (id) {
      const linkEl = DOMCache.get(cardEl, '[data-bind="card-link"]') || cardEl;
      if (linkEl._mdcClickHandler) {
        linkEl.removeEventListener('click', linkEl._mdcClickHandler);
      }
      const buildPropertyCleanUrl = window.MDC?.urlHelpers?.buildPropertyCleanUrl;
      const href = (p.slug && buildPropertyCleanUrl) ? buildPropertyCleanUrl(p.slug) : `/proprietate?crm_id=${id}`;
      if (!p.slug && id) Logger.warn('MDC: Lipsește slug pentru proprietatea crm_id=' + id);
      linkEl._mdcClickHandler = (e) => {
        const target = e.target;
        if (target.closest('a, button, .fav-share-item, [data-action="favorite"], [data-action="share"]') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
        e.preventDefault();
        e.stopPropagation();
        sessionStorage.setItem('mdc_scroll_position', window.scrollY.toString());
        window.location.href = href;
      };
      linkEl.style.cursor = 'pointer';
      linkEl.setAttribute('role', 'button');
      linkEl.setAttribute('tabindex', '0');
      linkEl.addEventListener('click', linkEl._mdcClickHandler);
      linkEl.addEventListener('keydown', (e) => {
        if (['Enter', ' '].includes(e.key)) {
          e.preventDefault();
          linkEl._mdcClickHandler(e);
        }
      });
    }
    if (favBtn && id) {
      favBtn.dataset.crmId = id.toString();
      updateFavoriteButton(favBtn, id);
      const favShareItem = favBtn.closest('.fav-share-item');
      if (favShareItem) setupFavoriteHover(favShareItem, id);
    }
    if (shareBtn && id) {
      shareBtn.dataset.crmId = id.toString();
      shareBtn.dataset.slug = p.slug || '';
    }
  };
  const setupCardImageHover = (cardEl, imageEl) => {
    if (!cardEl || !imageEl) return;
    if (cardEl._imageHoverHandlers) {
      cardEl.removeEventListener('mouseenter', cardEl._imageHoverHandlers.enter);
      cardEl.removeEventListener('mouseleave', cardEl._imageHoverHandlers.leave);
    }
    imageEl.style.transition = 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)';
    imageEl.style.transformOrigin = 'center center';
    imageEl.style.transform = 'scale(1)';
    const onMouseEnter = () => { imageEl.style.transform = 'scale(1.05)'; };
    const onMouseLeave = () => { imageEl.style.transform = 'scale(1)'; };
    cardEl.addEventListener('mouseenter', onMouseEnter);
    cardEl.addEventListener('mouseleave', onMouseLeave);
    cardEl._imageHoverHandlers = { enter: onMouseEnter, leave: onMouseLeave };
  };
  const setupFavoriteHover = (favShareItem, crmId) => {
    if (!favShareItem || !crmId) return;
    if (favShareItem._hoverHandlers) {
      favShareItem.removeEventListener('mouseenter', favShareItem._hoverHandlers.enter);
      favShareItem.removeEventListener('mouseleave', favShareItem._hoverHandlers.leave);
    }
    favShareItem.style.transition = 'background-color 0.2s cubic-bezier(0.25, 1, 0.5, 1)';
    const getInitialBg = () => {
      const isFavorite = FavoritesStorage.has(crmId);
      return isFavorite ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.6)';
    };
    favShareItem.style.backgroundColor = getInitialBg();
    const onMouseEnter = () => { favShareItem.style.backgroundColor = 'rgba(255, 255, 255, 1)'; };
    const onMouseLeave = () => { favShareItem.style.backgroundColor = getInitialBg(); };
    favShareItem.addEventListener('mouseenter', onMouseEnter);
    favShareItem.addEventListener('mouseleave', onMouseLeave);
    favShareItem._hoverHandlers = { enter: onMouseEnter, leave: onMouseLeave };
  };
  const updateFavoriteButton = (btn, crmId) => {
    if (!btn) return;
    const isFavorite = FavoritesStorage.has(crmId);
    btn.classList.toggle('is-favorite', isFavorite);
    btn.classList.toggle('item-switch-selected', isFavorite);
    btn.setAttribute('aria-pressed', isFavorite);
    const favShareItem = btn.closest('.fav-share-item');
    if (favShareItem) {
      const hollowImg = favShareItem.querySelector('.favorite-hollow');
      const fillImg = favShareItem.querySelector('.favorite-fill');
      const easeOutQuart = 'cubic-bezier(0.25, 1, 0.5, 1)';
      if (hollowImg) {
        hollowImg.style.transition = `opacity 0.2s ${easeOutQuart}, visibility 0.2s ${easeOutQuart}`;
      }
      if (fillImg) {
        fillImg.style.transition = `opacity 0.2s ${easeOutQuart}, visibility 0.2s ${easeOutQuart}`;
      }
      favShareItem.style.transition = `background-color 0.2s ${easeOutQuart}`;
      if (isFavorite) {
        favShareItem.style.backgroundColor = 'rgba(255, 255, 255, 1)';
        if (hollowImg) {
          hollowImg.style.opacity = '0';
          hollowImg.style.visibility = 'hidden';
        }
        if (fillImg) {
          fillImg.style.opacity = '1';
          fillImg.style.visibility = 'visible';
        }
      } else {
        favShareItem.style.backgroundColor = 'rgba(255, 255, 255, 0.6)';
        if (hollowImg) {
          hollowImg.style.opacity = '1';
          hollowImg.style.visibility = 'visible';
        }
        if (fillImg) {
          fillImg.style.opacity = '0';
          fillImg.style.visibility = 'hidden';
        }
      }
      setupFavoriteHover(favShareItem, crmId);
    }
  };
  const updateFavoriteCount = () => {
    const count = FavoritesStorage.get().length;
    const countEls = $$('[data-bind="fav-count"], .fav-count');
    countEls.forEach(el => { el.textContent = count.toString(); });
  };
  const handleFavorite = (e) => {
    const btn = e.target.closest('[data-action="favorite"]');
    if (!btn) return;
    const crmId = parseInt(btn.dataset.crmId, 10);
    if (!Number.isFinite(crmId)) return;
    e.preventDefault();
    e.stopPropagation();
    const isFavorite = FavoritesStorage.has(crmId);
    if (isFavorite) {
      FavoritesStorage.remove(crmId);
    } else {
      FavoritesStorage.add(crmId);
    }
    updateFavoriteButton(btn, crmId);
    updateFavoriteCount();
    document.dispatchEvent(new CustomEvent('mdc:favorite-changed', {
      detail: { crmId, isFavorite: !isFavorite }
    }));
  };
  const handleShare = (e) => {
    const btn = e.target.closest('[data-action="share"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const crmId = btn.dataset.crmId;
    const slug = btn.dataset.slug;
    const buildPropertyCleanUrl = window.MDC?.urlHelpers?.buildPropertyCleanUrl;
    const origin = window.location.origin || '';
    const url = (slug && buildPropertyCleanUrl) ? (origin + buildPropertyCleanUrl(slug)) : (crmId ? (origin + '/proprietate?crm_id=' + crmId) : window.location.href);
    const title = btn.closest('.card-property')?.querySelector('[data-bind="title"]')?.textContent || 'Proprietate MDC';
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => copyToClipboard(url));
    } else {
      copyToClipboard(url);
    }
  };
  const copyToClipboard = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => Logger.log('Copied to clipboard:', text));
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        Logger.error('Copy failed:', err);
      }
      document.body.removeChild(textarea);
    }
  };
  const init = () => {
    if (document.body.dataset.mdcInitialized) return;
    document.body.dataset.mdcInitialized = '1';
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="favorite"]')) handleFavorite(e);
      if (e.target.closest('[data-action="share"]')) handleShare(e);
    }, { passive: true });
    $$('[data-action="favorite"]').forEach(btn => {
      const crmId = parseInt(btn.dataset.crmId, 10);
      if (Number.isFinite(crmId)) updateFavoriteButton(btn, crmId);
    });
    updateFavoriteCount();
    document.addEventListener('mdc:favorite-changed', updateFavoriteCount);
    Logger.log('MDC site.js initialized');
  };
  const initRouter = () => {
    let page = document.documentElement.dataset.page;
    if (!page) {
      const path = window.location.pathname.toLowerCase();
      if (path.includes('/results') || path.includes('/rezultate')) {
        page = 'results';
      } else if (path.includes('/proprietate') || path.includes('/listing')) {
        page = 'listing';
      } else if (path.includes('/favorites') || path.includes('/favorite')) {
        page = 'favorites';
      } else {
        page = 'home';
      }
      document.documentElement.dataset.page = page;
    }
    Logger.log('MDC Router: Detected page:', page);
    
    const run = () => {
      // Wait for page handler to be registered (page scripts load after site-footer.js)
      const maxAttempts = 50; // 5 seconds max wait
      let attempts = 0;
      
      const tryRun = () => {
        if (!window.MDC || !window.MDC.pages) {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(tryRun, 100);
          }
          return;
        }
        
        if (typeof window.MDC.pages[page] === 'function') {
          try {
            Logger.time(`Page init: ${page}`);
            window.MDC.pages[page]();
            Logger.timeEnd(`Page init: ${page}`);
          } catch (e) {
            Logger.error('MDC Router: Error running page init:', e);
          }
        } else {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(tryRun, 100);
          }
        }
      };
      
      tryRun();
    };
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  };
  const renderGroupedItems = (container, itemClass, keySelector, valueSelector, groups) => {
    if (!container || !itemClass) return;
    const existing = $$(`.${itemClass}`, container);
    const itemTemplate = existing[0];
    if (!itemTemplate) return;
    itemTemplate.style.display = 'none';
    $$(`.${itemClass}[data-clone="1"]`, container).forEach(item => item.remove());
    if (!groups || !Array.isArray(groups) || groups.length === 0) return;
    const validGroups = groups.filter(group => group.items && Array.isArray(group.items) && group.items.length > 0);
    if (validGroups.length === 0) return;
    const fragment = document.createDocumentFragment();
    validGroups.forEach(group => {
      const groupLabel = group.label || group.key || '';
      const itemLabels = group.items.map(item => item.label || '').filter(label => label !== '');
      if (itemLabels.length === 0) return;
      const itemEl = itemTemplate.cloneNode(true);
      itemEl.classList.remove('w-dummy');
      itemEl.dataset.clone = '1';
      itemEl.style.display = '';
      const keyEl = $(keySelector, itemEl) || $(`.${itemClass.replace('-item', '')}-key`, itemEl);
      const valueEl = $(valueSelector, itemEl) || $(`.${itemClass.replace('-item', '')}-value`, itemEl);
      if (keyEl) keyEl.textContent = `${groupLabel}:`;
      if (valueEl) valueEl.textContent = itemLabels.join(', ');
      fragment.appendChild(itemEl);
    });
    container.appendChild(fragment);
  };
  const ENDPOINT_FILTERS = CONSTANTS.ENDPOINTS.FILTERS_DYNAMIC;
  const fillSelect = (sel, values, placeholder, capitalizeDisplay = false) => {
    if (!sel) return;
    const cur = sel.value || '';
    sel.innerHTML = '';
    if (placeholder) sel.add(new Option(placeholder, ''));
    (values || []).forEach((v) => {
      const val = String(v);
      const display = capitalizeDisplay && val ? val.charAt(0).toUpperCase() + val.slice(1) : val;
      sel.add(new Option(display, val));
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  };
  const readSelect = (sel) => (sel && sel.value ? sel.value : null);
  const asNum = (x) => {
    const s = String(x ?? '').trim();
    if (!s) return null;
    const n = Number(s.replace(/\s+/g, '').replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  };
  const createFilterManager = (options = {}) => {
    const { onTransactionChange, onScopeChange, onFilterChange, onApply, onReset } = options;
    const byFilter = (k) => $(`[data-filter="${k}"]`);
    const typeSel = byFilter('type');
    const citySel = byFilter('city');
    const zoneSel = byFilter('zone');
    const countrySel = byFilter('country');
    const roomsSel = byFilter('rooms');
    const priceMinInp = $('#price-min') || byFilter('min_price');
    const priceMaxInp = $('#price-max') || byFilter('max_price');
    const resetBtn = $('#reset-filter');
    const resetBtnInactive = $('#reset-filter-inactive');
    const applyBtn = $('#search-filter');
    const switchWrap = $('.switch-button') || $('.main-switches-wrapper') || document;
    const tBtns = [...switchWrap.querySelectorAll('[data-transaction]')];
    let transaction = 'sale';
    const setTransaction = (v) => {
      transaction = (v === 'sale' || v === 'rent') ? v : 'sale';
      tBtns.forEach(b => b.classList.toggle('item-switch-selected', b.dataset.transaction === transaction));
      if (onTransactionChange) onTransactionChange(transaction);
    };
    const scopeSwitchWrap = $('#scope') || $('[data-control="scope"]') || document;
    const sBtns = [...scopeSwitchWrap.querySelectorAll('[data-scope]')];
    const countryWrapper = $('#country-wrapper');
    const zoneWrapper = $('#zone-wrapper');
    let scope = 'national';
    const setScope = (v) => {
      scope = (v === 'national' || v === 'international') ? v : 'national';
      sBtns.forEach(b => {
        const isSelected = b.dataset.scope === scope;
        b.classList.toggle('item-switch-selected', isSelected);
        b.classList.toggle('w-active', isSelected);
      });
      if (countryWrapper) countryWrapper.style.display = scope === 'international' ? '' : 'none';
      if (zoneWrapper) zoneWrapper.style.display = scope === 'national' ? '' : 'none';
      if (scope === 'national' && countrySel) countrySel.value = '';
      if (scope === 'international' && zoneSel) zoneSel.value = '';
      if (onScopeChange) onScopeChange(scope);
    };
    const buildQuery = () => {
      const q = {};
      const add = (k, v) => (v !== null && v !== undefined && v !== '') && (q[k] = v);
      add('transaction', transaction);
      add('scope', scope);
      add('type', readSelect(typeSel));
      add('city', readSelect(citySel));
      if (scope === 'national') {
        add('zone', readSelect(zoneSel));
      } else if (scope === 'international') {
        add('country', readSelect(countrySel));
      }
      add('rooms', readSelect(roomsSel));
      add('min_price', asNum(priceMinInp?.value));
      add('max_price', asNum(priceMaxInp?.value));
      return q;
    };
    const hasActiveFilters = () => {
      const q = buildQuery();
      if (q.transaction === 'sale') delete q.transaction;
      if (q.scope === 'national') delete q.scope;
      return Object.keys(q).length > 0;
    };
    const updateResetButtons = () => {
      const hasFilters = hasActiveFilters();
      if (resetBtn) resetBtn.style.display = hasFilters ? '' : 'none';
      if (resetBtnInactive) resetBtnInactive.style.display = hasFilters ? 'none' : '';
    };
    const refreshDynamicFilters = async () => {
      const url = new URL(ENDPOINT_FILTERS);
      const q = buildQuery();
      Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v));
      try {
        const res = await fetchJSON(url.toString());
        const opt = res?.options || {};
        fillSelect(typeSel, opt.types, 'Tip proprietate', true);
        fillSelect(citySel, opt.cities, 'Oraș');
        fillSelect(zoneSel, opt.zones, 'Zonă');
        fillSelect(countrySel, opt.countries, 'Țară');
        fillSelect(roomsSel, opt.rooms, 'Camere');
        const rMin = asNum(res?.price?.rangeMin);
        const rMax = asNum(res?.price?.rangeMax);
        if (priceMinInp) {
          if (rMin !== null) priceMinInp.min = String(rMin);
          if (rMax !== null) priceMinInp.max = String(rMax);
        }
        if (priceMaxInp) {
          if (rMin !== null) priceMaxInp.min = String(rMin);
          if (rMax !== null) priceMaxInp.max = String(rMax);
        }
      } catch (e) {}
    };
    const onFilterChangeDebounced = debounce(() => {
      refreshDynamicFilters().catch(console.error);
      updateResetButtons();
      if (onFilterChange) onFilterChange();
    }, 250);
    const initFromUI = () => {
      const selectedTransaction = tBtns.find(b => b.classList.contains('item-switch-selected') || b.classList.contains('w-active'));
      if (selectedTransaction?.dataset?.transaction) {
        setTransaction(selectedTransaction.dataset.transaction);
      } else {
        setTransaction('sale');
      }
      const selectedScope = sBtns.find(b => b.classList.contains('item-switch-selected') || b.classList.contains('w-active'));
      if (selectedScope?.dataset?.scope) {
        setScope(selectedScope.dataset.scope);
      } else {
        setScope('national');
      }
    };
    const initFromURL = (params) => {
      if (params.transaction) setTransaction(params.transaction === 'rent' ? 'rent' : 'sale');
      if (params.scope) setScope(params.scope === 'international' ? 'international' : 'national');
      if (params.type && typeSel) typeSel.value = params.type;
      if (params.city && citySel) citySel.value = params.city;
      if (params.zone && zoneSel) zoneSel.value = params.zone;
      if (params.country && countrySel) countrySel.value = params.country;
      if (params.rooms && roomsSel) roomsSel.value = String(params.rooms);
      if (params.min_price && priceMinInp) priceMinInp.value = String(params.min_price);
      if (params.max_price && priceMaxInp) priceMaxInp.value = String(params.max_price);
    };
    const wireEvents = () => {
      [typeSel, citySel, zoneSel, countrySel, roomsSel].forEach(el => {
        if (el) {
          el.addEventListener('change', () => {
            onFilterChangeDebounced();
            updateResetButtons();
          });
        }
      });
      [priceMinInp, priceMaxInp].forEach(el => {
        if (el) {
          el.addEventListener('input', () => {
            onFilterChangeDebounced();
            updateResetButtons();
          });
        }
      });
      tBtns.forEach(b => b.addEventListener('click', (e) => {
        e.preventDefault();
        setTransaction(b.dataset.transaction);
        onFilterChangeDebounced();
        updateResetButtons();
      }));
      sBtns.forEach(b => b.addEventListener('click', (e) => {
        e.preventDefault();
        setScope(b.dataset.scope);
        onFilterChangeDebounced();
        updateResetButtons();
      }));
      resetBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        [typeSel, citySel, zoneSel, countrySel, roomsSel].forEach(el => el && (el.value = ''));
        if (priceMinInp) priceMinInp.value = '';
        if (priceMaxInp) priceMaxInp.value = '';
        setTransaction('sale');
        setScope('national');
        refreshDynamicFilters().catch(console.error);
        onFilterChangeDebounced();
        updateResetButtons();
        if (onReset) onReset();
      });
      applyBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (onApply) onApply(buildQuery());
      });
    };
    return {
      getTransaction: () => transaction,
      getScope: () => scope,
      buildQuery,
      hasActiveFilters,
      setTransaction,
      setScope,
      updateResetButtons,
      refreshDynamicFilters,
      initFromUI,
      initFromURL,
      wireEvents,
      elements: {
        typeSel, citySel, zoneSel, countrySel, roomsSel,
        priceMinInp, priceMaxInp, resetBtn, applyBtn
      }
    };
  };
  window.MDC.Favorites = FavoritesStorage;
  window.MDC.updateFavoriteButton = updateFavoriteButton;
  window.MDC.updateFavoriteCount = updateFavoriteCount;
  window.MDC.util.formatMoney = formatMoney;
  window.MDC.util.formatNumber = formatNumber;
  window.MDC.util.safeText = safeText;
  window.MDC.util.toNum = toNum;
  window.MDC.util.fetchJSON = fetchJSON;
  window.MDC.util.debounce = debounce;
  window.MDC.util.renderGroupedItems = renderGroupedItems;
  window.MDC.util.setImg = setImg;
  window.MDC.util.optimizeImageUrl = optimizeImageUrl;
  window.MDC.util.preloadImage = preloadImage;
  window.MDC.util.preloadImages = preloadImages;
  window.MDC.util.batchDOMUpdates = batchDOMUpdates;
  window.MDC.util.DOMCache = DOMCache;
  window.MDC.network = networkManager;
  window.MDC.Logger = Logger;
  window.MDC.filters = { createFilterManager, fillSelect, readSelect, asNum };
  window.MDCPropertyCard = { fill: fillCard, buildFeatures };
  
  // Ensure pages object exists
  if (!window.MDC.pages) {
    window.MDC.pages = {};
  }
  
  // Only run init once
  if (!document.body.dataset.mdcGlobalInit) {
    document.body.dataset.mdcGlobalInit = '1';
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        init();
        initRouter();
      });
    } else {
      init();
      initRouter();
    }
  } else {
    // Router can run multiple times safely
    initRouter();
  }
})();
