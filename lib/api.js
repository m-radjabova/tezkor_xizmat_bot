const API_BASE_URL = (
  process.env.API_BASE_URL ||
  process.env.VITE_API_ORIGIN ||
  'https://tezkor-xizmat-back.onrender.com'
).replace(/\/+$/, '')

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Oddiy xotira keshi (backend sekin/uxlab qolganda ham bot tez javob beradi) ---
const cache = new Map()
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = await loader()
  cache.set(key, { value, expires: Date.now() + ttlMs })
  if (cache.size > 500) cache.delete(cache.keys().next().value)
  return value
}

async function request(path, { retries = 2 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(45000),
      })

      // Render uyg'onayotganda 502/503/504 qaytarishi mumkin — qayta urinamiz
      if ([502, 503, 504].includes(response.status) && attempt < retries) {
        await sleep(2000 * (attempt + 1))
        continue
      }

      const body = await response.text()
      let data
      try {
        data = body ? JSON.parse(body) : null
      } catch {
        throw new ApiError(`Backend JSON formatida javob bermadi (HTTP ${response.status}).`, response.status)
      }

      if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${response.status}`
        throw new ApiError(`Backend so‘rovi bajarilmadi: ${detail}`, response.status)
      }
      return data
    } catch (error) {
      lastError = error
      if (error instanceof ApiError) throw error // mantiqiy xatoni qayta urinish befoyda
      if (attempt < retries) {
        await sleep(2000 * (attempt + 1))
        continue
      }
      throw new ApiError(`Backend bilan bog‘lanib bo‘lmadi: ${error.message}`)
    }
  }
  throw lastError
}

async function getCategories() {
  return cached('categories', 5 * 60 * 1000, async () => {
    const data = await request('/categories')
    if (!Array.isArray(data)) throw new ApiError('Backend kategoriyalar ro‘yxatini noto‘g‘ri formatda qaytardi.')
    return data
  })
}

async function getBusinesses(filters = {}) {
  const params = new URLSearchParams()
  for (const key of ['category_id', 'search', 'latitude', 'longitude', 'sort_by', 'min_rating', 'limit', 'offset']) {
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const query = params.toString()
  // Lokatsiyali so'rovlar keshlanmaydi (har foydalanuvchi uchun alohida)
  const ttl = filters.latitude !== undefined ? 0 : 30 * 1000
  return cached(`businesses:${query}`, ttl, async () => {
    const data = await request(`/businesses?${query}`)
    if (!Array.isArray(data)) throw new ApiError('Backend xizmatlar ro‘yxatini noto‘g‘ri formatda qaytardi.')
    return data
  })
}

async function getBusiness(id) {
  return cached(`business:${id}`, 60 * 1000, async () => {
    const data = await request(`/businesses/${encodeURIComponent(id)}`)
    if (!data || typeof data !== 'object' || !data.id) {
      throw new ApiError('Backend xizmat tafsilotlarini noto‘g‘ri formatda qaytardi.')
    }
    return data
  })
}

async function getReviews(id) {
  return cached(`reviews:${id}`, 30 * 1000, async () => {
    const data = await request(`/businesses/${encodeURIComponent(id)}/reviews`)
    if (!Array.isArray(data)) throw new ApiError('Backend sharhlar ro‘yxatini noto‘g‘ri formatda qaytardi.')
    return data
  })
}

/**
 * Render bepul rejasida backend 15 daqiqa so'rovsiz qolsa uxlab qoladi (birinchi so'rov ~50 soniya).
 * Bot ishga tushganda va har 10 daqiqada backendni "uyg'otib" turamiz.
 * O'chirish: KEEP_ALIVE=0
 */
function startKeepAlive() {
  if (process.env.KEEP_ALIVE === '0') return
  const ping = () => fetch(`${API_BASE_URL}/categories`, { signal: AbortSignal.timeout(60000) }).catch(() => {})
  ping()
  setInterval(ping, 10 * 60 * 1000).unref()
}

module.exports = { ApiError, getBusiness, getBusinesses, getCategories, getReviews, startKeepAlive }