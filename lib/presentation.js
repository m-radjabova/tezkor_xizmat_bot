function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(value = '', maxLength = 100) {
  const text = String(value)
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function getBusinessPhotos(business) {
  const images = Array.isArray(business.images) ? business.images : []
  const photos = images.filter((url) => {
    if (typeof url !== 'string') return false
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {
      return false
    }
  })

  if (!photos.length && typeof business.logo_url === 'string') {
    try {
      if (['http:', 'https:'].includes(new URL(business.logo_url).protocol)) {
        photos.push(business.logo_url)
      }
    } catch {
      // Ignore an invalid optional logo URL.
    }
  }

  return [...new Set(photos)]
}

function formatBusiness(business, descriptionLimit = 2800) {
  const rating = Number(business.rating_average)
  const ratingText = Number.isFinite(rating) && rating > 0
    ? `⭐ ${rating.toFixed(1)} (${business.rating_count || 0} ta sharh)`
    : 'Hali reyting berilmagan'
  const hours = business.open_time && business.close_time
    ? `${business.open_time.slice(0, 5)}–${business.close_time.slice(0, 5)}`
    : 'Ko‘rsatilmagan'
  const lines = [
    `${business.is_verified ? '✅ ' : ''}<b>${escapeHtml(business.name)}</b>`,
    business.category?.name ? `🗂 ${escapeHtml(business.category.name)}` : null,
    ratingText,
    `📍 ${escapeHtml(business.address || 'Manzil ko‘rsatilmagan')}`,
    `🕒 Ish vaqti: ${escapeHtml(hours)}`,
    business.working_days ? `📅 ${escapeHtml(business.working_days)}` : null,
    '',
    escapeHtml(truncate(business.description || 'Tavsif mavjud emas.', descriptionLimit)),
  ]
  return lines.filter((line) => line !== null).join('\n')
}

function formatBusinessCaption(business) {
  const shortBusiness = {
    ...business,
    name: truncate(business.name, 100),
    address: truncate(business.address || 'Manzil ko‘rsatilmagan', 100),
    working_days: truncate(business.working_days || '', 80),
    category: business.category
      ? { ...business.category, name: truncate(business.category.name, 70) }
      : business.category,
  }
  return formatBusiness(shortBusiness, 400)
}

function formatReview(review, commentLimit = 500) {
  const rating = Math.max(0, Math.min(5, Number(review.rating) || 0))
  const author = truncate(review.user?.full_name || 'Foydalanuvchi', 80)
  const comment = review.comment ? escapeHtml(truncate(review.comment, commentLimit)) : 'Izoh qoldirilmagan.'
  return `<b>${escapeHtml(author)}</b> · ${'⭐'.repeat(rating)}\n${comment}`
}

module.exports = {
  escapeHtml,
  formatBusiness,
  formatBusinessCaption,
  formatReview,
  getBusinessPhotos,
  truncate,
}
