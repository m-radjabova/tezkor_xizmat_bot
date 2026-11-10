const assert = require('node:assert/strict')
const { test } = require('node:test')
const { ApiError, getBusinesses, getCategories } = require('../lib/api')
const { downloadTelegramPhoto } = require('../lib/telegram-photo')
const {
  escapeHtml,
  formatBusiness,
  formatBusinessCaption,
  formatReview,
  getBusinessPhotos,
  truncate,
} = require('../lib/presentation')

test('escapes Telegram HTML and truncates long button labels', () => {
  assert.equal(escapeHtml(`<script a="b">O'&</script>`), '&lt;script a=&quot;b&quot;&gt;O&#39;&amp;&lt;/script&gt;')
  assert.equal(truncate('abcdef', 4), 'abc…')
  assert.equal(truncate('abc', 4), 'abc')
})

test('formats business details and public review text safely', () => {
  const business = formatBusiness({
    name: '<Clinic>',
    category: { name: 'Tibbiyot' },
    is_verified: true,
    rating_average: 4.5,
    rating_count: 2,
    address: 'Buxoro',
    open_time: '09:00:00',
    close_time: '18:00:00',
    description: 'Xizmat & sifat',
  })
  assert.match(business, /&lt;Clinic&gt;/)
  assert.match(business, /09:00–18:00/)
  assert.match(business, /Xizmat &amp; sifat/)
  assert.doesNotMatch(business, /null|undefined/)

  assert.equal(
    formatReview({ rating: 3, user: { full_name: '<User>' }, comment: 'Nice & safe' }),
    '<b>&lt;User&gt;</b> · ⭐⭐⭐\nNice &amp; safe',
  )
})

test('formats photo captions and selects valid business gallery images', () => {
  const business = {
    name: 'Grand Medical',
    category: { name: 'Tibbiyot' },
    address: 'Buxoro',
    description: 'Xizmatlar'.repeat(100),
    images: [
      'https://example.com/clinic.jpg',
      'javascript:alert(1)',
      'https://example.com/clinic.jpg',
    ],
    logo_url: 'https://example.com/logo.jpg',
  }

  assert.ok(formatBusinessCaption(business).length < 1024)
  assert.deepEqual(getBusinessPhotos(business), ['https://example.com/clinic.jpg'])
  assert.deepEqual(getBusinessPhotos({ images: [], logo_url: 'https://example.com/logo.jpg' }), [
    'https://example.com/logo.jpg',
  ])
  assert.deepEqual(getBusinessPhotos({ images: [], logo_url: 'javascript:alert(1)' }), [])
})

test('downloads photos and prepares them for Telegram multipart upload', async (t) => {
  const originalFetch = global.fetch
  t.after(() => {
    global.fetch = originalFetch
  })

  global.fetch = async (url, options) => {
    assert.equal(url.href, 'https://example.com/photo.png')
    assert.ok(options.signal)
    return new Response(Buffer.from('png data'), {
      headers: { 'content-type': 'image/png' },
    })
  }

  const photo = await downloadTelegramPhoto('https://example.com/photo.png')
  assert.equal(photo.filename, 'photo.png')
  assert.equal(photo.source.toString(), 'png data')
})

test('rejects invalid photo URLs, non-image responses, and oversized photos', async (t) => {
  const originalFetch = global.fetch
  t.after(() => {
    global.fetch = originalFetch
  })

  await assert.rejects(downloadTelegramPhoto('http://example.com/photo.png'), /must use HTTPS/)
  global.fetch = async () => new Response('not an image', {
    headers: { 'content-type': 'text/html' },
  })
  await assert.rejects(downloadTelegramPhoto('https://example.com/photo.png'), /Unsupported photo content type/)

  global.fetch = async () => new Response(null, {
    headers: { 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) },
  })
  await assert.rejects(downloadTelegramPhoto('https://example.com/photo.jpg'), /10 MB upload limit/)
})

test('requests business filters using the backend query contract', async (t) => {
  const originalFetch = global.fetch
  t.after(() => {
    global.fetch = originalFetch
  })

  let requestedUrl
  global.fetch = async (url) => {
    requestedUrl = new URL(url)
    return { ok: true, status: 200, text: async () => '[]' }
  }

  await getBusinesses({
    category_id: 'category-id',
    search: 'usta & ta’mir',
    latitude: 39.77,
    longitude: 64.43,
    sort_by: 'distance',
    min_rating: 4,
    limit: 8,
    offset: 8,
  })

  assert.equal(requestedUrl.pathname, '/businesses')
  assert.equal(requestedUrl.searchParams.get('category_id'), 'category-id')
  assert.equal(requestedUrl.searchParams.get('search'), 'usta & ta’mir')
  assert.equal(requestedUrl.searchParams.get('sort_by'), 'distance')
  assert.equal(requestedUrl.searchParams.get('offset'), '8')
})

test('rejects malformed or failed backend responses explicitly', async (t) => {
  const originalFetch = global.fetch
  t.after(() => {
    global.fetch = originalFetch
  })

  global.fetch = async () => ({ ok: false, status: 503, text: async () => '{"detail":"unavailable"}' })
  await assert.rejects(getCategories(), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 503)
    assert.match(error.message, /unavailable/)
    return true
  })

  global.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' })
  await assert.rejects(getCategories(), /noto‘g‘ri format/)
})
