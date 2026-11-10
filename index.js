require('dotenv').config()

const { Telegraf, Markup, session } = require('telegraf')
const { getBusiness, getBusinesses, getCategories, getReviews, startKeepAlive } = require('./lib/api')
const { downloadTelegramPhoto } = require('./lib/telegram-photo')
const {
  escapeHtml,
  formatBusiness,
  formatBusinessCaption,
  formatReview,
  getBusinessPhotos,
  truncate,
} = require('./lib/presentation')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN
const WEB_APP_URL = (process.env.WEB_APP_URL || 'https://tezkor-xizmat.vercel.app').replace(/\/+$/, '')
const WELCOME_IMAGE_URL = process.env.WELCOME_IMAGE_URL || `${WEB_APP_URL}/website.png`
const PAGE_SIZE = 8
const CATEGORY_PAGE_SIZE = 8
const UUID = '[0-9a-f-]{36}'

const BTN = {
  categories: '🗂 Kategoriyalar',
  search: '🔎 Qidirish',
  top: '⭐ Top reyting',
  nearby: '📍 Yaqin xizmatlar',
  help: 'ℹ️ Yordam',
  cancel: '❌ Bekor qilish',
}
const MENU_TEXTS = new Set(Object.values(BTN))

const menuKeyboard = Markup.keyboard([
  [Markup.button.webApp('🚀 Ilovani ochish', WEB_APP_URL)],
  [BTN.categories, BTN.search],
  [BTN.top, BTN.nearby],
  [BTN.help],
]).resize()

const webLink = (path = '') => `${WEB_APP_URL}${path}`
const DEFAULT_FILTERS = () => ({ sort_by: 'newest' })

function getFilters(ctx) {
  ctx.session.filters ??= DEFAULT_FILTERS()
  return ctx.session.filters
}

/** Callback bosilganda xabarni o'sha joyda yangilaydi, aks holda yangi xabar yuboradi. */
async function show(ctx, text, extra = {}) {
  const options = { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra }
  if (ctx.callbackQuery?.message && !ctx.callbackQuery.message.photo) {
    try {
      return await ctx.editMessageText(text, options)
    } catch (error) {
      if (/not modified/i.test(error.description || error.message)) return
      console.error('Could not update Telegram message:', error)
    }
  } else if (ctx.callbackQuery?.message?.photo) {
    try {
      await ctx.deleteMessage()
    } catch (error) {
      console.error('Could not remove Telegram photo message:', error)
    }
  }
  return ctx.reply(text, options)
}

async function showPhoto(ctx, photo, caption, extra = {}) {
  const uploadedPhoto = await downloadTelegramPhoto(photo)
  if (ctx.callbackQuery?.message?.photo) {
    try {
      return await ctx.editMessageMedia(
        { type: 'photo', media: uploadedPhoto, caption, parse_mode: 'HTML' },
        extra,
      )
    } catch (error) {
      if (/not modified/i.test(error.description || error.message)) return
      console.error('Could not update Telegram photo message:', error)
    }
  }

  const message = await ctx.replyWithPhoto(uploadedPhoto, { caption, parse_mode: 'HTML', ...extra })
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.deleteMessage()
    } catch (error) {
      console.error('Could not remove previous Telegram message:', error)
    }
  }
  return message
}

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length === 9) return `+998${digits}`
  return digits ? `+${digits}` : ''
}

/* ---------------- Kategoriyalar ---------------- */

function categoryKeyboard(categories, offset) {
  const rows = categories
    .slice(offset, offset + CATEGORY_PAGE_SIZE)
    .map((c) => [Markup.button.callback(`${c.icon || '🗂'} ${truncate(c.name, 50)}`, `cat:${c.id}`)])
  const controls = []
  if (offset > 0) controls.push(Markup.button.callback('⬅️ Oldingi', `catp:${Math.max(0, offset - CATEGORY_PAGE_SIZE)}`))
  if (offset + CATEGORY_PAGE_SIZE < categories.length) {
    controls.push(Markup.button.callback('Keyingi ➡️', `catp:${offset + CATEGORY_PAGE_SIZE}`))
  }
  if (controls.length) rows.push(controls)
  rows.push([Markup.button.callback('🧰 Barcha xizmatlar', 'all')])
  return Markup.inlineKeyboard(rows)
}

async function showCategories(ctx, offset = 0) {
  const categories = await getCategories()
  if (!categories.length) return show(ctx, 'Hozircha xizmat kategoriyalari mavjud emas.')
  const start = Math.min(offset, Math.max(0, categories.length - 1))
  const end = Math.min(start + CATEGORY_PAGE_SIZE, categories.length)
  return show(ctx, `🗂 <b>Xizmat kategoriyalari</b>\n<i>${start + 1}–${end} / ${categories.length}</i>`, {
    ...categoryKeyboard(categories, start),
  })
}

/* ---------------- Xizmatlar ro'yxati ---------------- */

function listTitle(f) {
  if (f.search) return `🔎 <b>“${escapeHtml(f.search)}” bo‘yicha natijalar</b>`
  if (f.category_name) return `🗂 <b>${escapeHtml(f.category_name)}</b>`
  if (f.latitude !== undefined) return '📍 <b>Sizga yaqin xizmatlar</b>'
  if (f.sort_by === 'rating') return '⭐ <b>Yuqori reytingli xizmatlar</b>'
  return '🧰 <b>Xizmatlar</b>'
}

async function showBusinesses(ctx, offset = 0) {
  const filters = getFilters(ctx)
  // PAGE_SIZE + 1 so'raymiz — "Keyingi" tugmasi faqat haqiqatan keyingi sahifa bo'lsa chiqadi
  const fetched = await getBusinesses({ ...filters, limit: PAGE_SIZE + 1, offset })
  const hasMore = fetched.length > PAGE_SIZE
  const businesses = fetched.slice(0, PAGE_SIZE)
  ctx.session.listOffset = offset
  const title = listTitle(filters)

  if (!businesses.length) {
    return show(ctx, `${title}\n\nMos xizmat topilmadi. Boshqa so‘z bilan qidiring yoki kategoriyani o‘zgartiring.`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗂 Kategoriyalar', 'categories')],
        [Markup.button.callback('🔄 Barcha xizmatlar', 'all')],
      ]),
    })
  }

  const rows = businesses.map((b) => [
    Markup.button.callback(
      `${b.is_verified ? '✅ ' : ''}${truncate(b.name, 48)} · ${b.rating_average ? `⭐ ${Number(b.rating_average).toFixed(1)}` : 'Yangi'}`,
      `biz:${b.id}`,
    ),
  ])
  const controls = []
  if (offset > 0) controls.push(Markup.button.callback('⬅️ Oldingi', `page:${Math.max(0, offset - PAGE_SIZE)}`))
  if (hasMore) controls.push(Markup.button.callback('Keyingi ➡️', `page:${offset + PAGE_SIZE}`))
  if (controls.length) rows.push(controls)
  rows.push([
    Markup.button.callback('🗂 Kategoriyalar', 'categories'),
    Markup.button.webApp('🚀 Ilovada', webLink()),
  ])

  const first = businesses[0]
  const firstRating = Number(first.rating_average)
  const caption =
    `${title}\n<i>${offset + 1}–${offset + businesses.length} ta xizmat</i>\n\n` +
    `📸 <b>${escapeHtml(truncate(first.name, 90))}</b>\n` +
    `${first.category?.name ? `🗂 ${escapeHtml(truncate(first.category.name, 60))}\n` : ''}` +
    `${firstRating > 0 ? `⭐ ${firstRating.toFixed(1)} · ${first.rating_count || 0} ta sharh\n` : ''}` +
    '<i>Ko‘rish uchun xizmatni tanlang:</i>'
  const keyboard = { ...Markup.inlineKeyboard(rows) }
  const photos = getBusinessPhotos(first)

  if (!photos.length) return show(ctx, caption, keyboard)
  try {
    return await showPhoto(ctx, photos[0], caption, keyboard)
  } catch (error) {
    console.error('Could not send business-list photo:', error)
    return show(ctx, caption, keyboard)
  }
}

/* ---------------- Xizmat tafsiloti ---------------- */

async function showBusiness(ctx, id, imageIndex = 0) {
  const business = await getBusiness(id)
  const photos = getBusinessPhotos(business)
  const selectedImage = Math.min(Math.max(imageIndex, 0), Math.max(photos.length - 1, 0))
  const rows = []

  if (photos.length > 1) {
    const gallery = []
    if (selectedImage > 0) {
      gallery.push(Markup.button.callback('⬅️', `biz:${business.id}:${selectedImage - 1}`))
    }
    gallery.push(Markup.button.callback(`🖼 ${selectedImage + 1}/${photos.length}`, `biz:${business.id}:${selectedImage}`))
    if (selectedImage + 1 < photos.length) {
      gallery.push(Markup.button.callback('➡️', `biz:${business.id}:${selectedImage + 1}`))
    }
    rows.push(gallery)
  }

  if (business.phone) {
    rows.push([Markup.button.callback('📞 Qo‘ng‘iroq qilish', `phone:${business.id}`)])
  }
  if (business.latitude != null && business.longitude != null) {
    const { latitude: lat, longitude: lng } = business
    rows.push([
      Markup.button.callback('📍 Lokatsiya', `loc:${business.id}`),
      Markup.button.url('🗺 Google', `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`),
      Markup.button.url('🗺 Yandex', `https://yandex.com/maps/?pt=${lng},${lat}&z=17&l=map`),
    ])
  }
  rows.push([
    Markup.button.callback('⭐ Sharhlar', `reviews:${business.id}:${selectedImage}`),
    Markup.button.webApp('🌐 Ilovada ochish', webLink(`/businesses/${encodeURIComponent(business.id)}`)),
  ])
  rows.push([Markup.button.callback('⬅️ Ro‘yxatga qaytish', 'backlist')])

  const keyboard = { ...Markup.inlineKeyboard(rows) }
  if (!photos.length) return show(ctx, formatBusiness(business), keyboard)

  const caption = `${formatBusinessCaption(business)}\n\n🖼 ${selectedImage + 1}/${photos.length}`
  try {
    return await showPhoto(ctx, photos[selectedImage], caption, keyboard)
  } catch (error) {
    console.error('Could not send business photo:', error)
    return show(ctx, formatBusiness(business), keyboard)
  }
}

async function showReviews(ctx, id, imageIndex = 0) {
  const reviews = await getReviews(id)
  const business = await getBusiness(id)
  const photos = getBusinessPhotos(business)
  const selectedImage = Math.min(Math.max(imageIndex, 0), Math.max(photos.length - 1, 0))
  const body = reviews.length
    ? reviews.slice(0, photos.length ? 3 : 5).map((review) => formatReview(review, photos.length ? 120 : 500)).join('\n\n')
    : 'Bu xizmat uchun hali sharhlar yo‘q.'
  const caption = `⭐ <b>${escapeHtml(truncate(business.name, 100))} — sharhlar</b>\n\n${body}`
  const keyboard = {
    ...Markup.inlineKeyboard([
      [Markup.button.webApp('✍️ Sharh qoldirish', webLink(`/businesses/${encodeURIComponent(id)}`))],
      [Markup.button.callback('⬅️ Xizmatga qaytish', `biz:${id}:${selectedImage}`)],
    ]),
  }
  if (!photos.length) return show(ctx, caption, keyboard)
  try {
    return await showPhoto(ctx, photos[selectedImage], caption, keyboard)
  } catch (error) {
    console.error('Could not send business-review photo:', error)
    return show(ctx, caption, keyboard)
  }
}

/* ---------------- Qidiruv / lokatsiya ---------------- */

function beginSearch(ctx) {
  ctx.session.awaitingSearch = true
  ctx.session.awaitingLocation = false
  return ctx.reply('🔎 Qaysi xizmatni qidiryapsiz? Nomini yoki kalit so‘zni yozing (masalan: <i>santexnik</i>).', {
    parse_mode: 'HTML',
    ...Markup.keyboard([[BTN.cancel]]).resize(),
  })
}

function askForLocation(ctx) {
  ctx.session.awaitingLocation = true
  ctx.session.awaitingSearch = false
  return ctx.reply(
    'Yaqin atrofdagi xizmatlarni topish uchun joylashuvingizni yuboring 👇',
    Markup.keyboard([[Markup.button.locationRequest('📍 Joylashuvni yuborish')], [BTN.cancel]]).resize(),
  )
}

async function runSearch(ctx, query) {
  query = query.trim()
  if (query.length < 2 || query.length > 100) {
    return ctx.reply('Qidiruv 2–100 ta belgidan iborat bo‘lishi kerak.')
  }
  ctx.session.awaitingSearch = false
  ctx.session.filters = { search: query, sort_by: 'newest' }
  await ctx.reply('🔎 Qidirilmoqda…', menuKeyboard)
  return showBusinesses(ctx)
}

/* ---------------- Bot ---------------- */

function setupBot() {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN (yoki BOT_TOKEN) environment variable is required')

  const bot = new Telegraf(BOT_TOKEN)

  bot.use(session())
  bot.use(async (ctx, next) => {
    ctx.session ??= {}
    // Backend uyg'onguncha (Render "cold start") foydalanuvchi "yozmoqda..." ni ko'rib turadi
    if (ctx.chat && !ctx.callbackQuery) ctx.sendChatAction('typing').catch(() => {})
    // Menyu tugmasi bosilsa, kutilayotgan qidiruv/lokatsiya holati bekor bo'ladi
    if (MENU_TEXTS.has(ctx.message?.text)) {
      ctx.session.awaitingSearch = false
      ctx.session.awaitingLocation = false
    }
    return next()
  })

  bot.start(async (ctx) => {
    ctx.session = { filters: DEFAULT_FILTERS() }
    const payload = ctx.startPayload || ''

    // Chuqur havola: t.me/<bot>?start=biz_<uuid>
    const match = payload.match(new RegExp(`^biz_(${UUID})$`, 'i'))
    if (match) {
      await ctx.reply('Xizmat ma’lumotlari:', menuKeyboard)
      return showBusiness(ctx, match[1])
    }

    const welcomeText =
      `Assalomu alaykum, ${escapeHtml(ctx.from.first_name || 'do‘st')}! 👋\n\n` +
      '<b>Tezkor Xizmat</b>\n' +
      'Ishonchli xizmatlarni toping, rasmlarini ko‘ring, reytinglarni solishtiring va bog‘laning.\n\n' +
      '🚀 Boshlash uchun ilovani oching yoki pastdagi menyudan xizmat tanlang.'
    try {
      await ctx.replyWithPhoto(await downloadTelegramPhoto(WELCOME_IMAGE_URL), {
        caption: welcomeText,
        parse_mode: 'HTML',
        ...menuKeyboard,
      })
    } catch (error) {
      console.error('Could not send welcome image:', error)
      await ctx.reply(welcomeText, { parse_mode: 'HTML', ...menuKeyboard })
    }
    await ctx.reply(
      'Tezkor boshlash:',
      Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Ilovani ochish', WEB_APP_URL)],
        [Markup.button.callback('🗂 Kategoriyalar', 'categories'), Markup.button.callback('⭐ Top', 'top')],
      ]),
    )
  })

  const help = (ctx) =>
    ctx.reply(
      'ℹ️ <b>Yordam</b>\n\n' +
        '🗂 /categories — kategoriyalar bo‘yicha ko‘rish\n' +
        '🔎 /search <i>so‘z</i> — qidirish\n' +
        '⭐ /top — eng yaxshi reytingli xizmatlar\n' +
        '📍 /nearby — sizga yaqin xizmatlar\n' +
        '🚀 /app — ilovani ochish\n\n' +
        'Xizmat sahifasida telefon, lokatsiya, sharhlar va reyting mavjud.',
      { parse_mode: 'HTML', ...menuKeyboard },
    )
  bot.help(help)
  bot.hears(BTN.help, help)

  bot.command('app', (ctx) =>
    ctx.reply('Ilovani ochish uchun bosing 👇', Markup.inlineKeyboard([[Markup.button.webApp('🚀 Ilovani ochish', WEB_APP_URL)]])),
  )

  const topHandler = async (ctx) => {
    ctx.session.filters = { sort_by: 'rating', min_rating: 4 }
    return showBusinesses(ctx)
  }

  bot.command('categories', (ctx) => showCategories(ctx))
  bot.command('top', topHandler)
  bot.command('nearby', askForLocation)
  bot.command('search', (ctx) => {
    const query = ctx.message.text.replace(/^\/search(?:@\w+)?\s*/i, '')
    return query.trim() ? runSearch(ctx, query) : beginSearch(ctx)
  })

  bot.hears(BTN.categories, (ctx) => showCategories(ctx))
  bot.hears(BTN.search, beginSearch)
  bot.hears(BTN.top, topHandler)
  bot.hears(BTN.nearby, askForLocation)
  bot.hears(BTN.cancel, (ctx) => ctx.reply('Bekor qilindi.', menuKeyboard))

  bot.on('location', async (ctx) => {
    const { latitude, longitude } = ctx.message.location
    ctx.session.awaitingLocation = false
    ctx.session.filters = { latitude, longitude, sort_by: 'distance' }
    await ctx.reply('📍 Joylashuvingiz qabul qilindi.', menuKeyboard)
    return showBusinesses(ctx)
  })

  // Menyu tugmasi bo'lmagan oddiy matn: qidiruv kutilayotgan bo'lsa — qidiramiz
  bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next()
    if (ctx.session.awaitingSearch) return runSearch(ctx, ctx.message.text)
    // Qidiruv rejimida bo'lmasa ham, oddiy matnni qidiruv deb qabul qilamiz — eng qulay variant
    return runSearch(ctx, ctx.message.text)
  })

  /* ---- Inline tugmalar ---- */

  bot.action('categories', async (ctx) => {
    await ctx.answerCbQuery()
    return showCategories(ctx)
  })
  bot.action(/^catp:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery()
    return showCategories(ctx, Number(ctx.match[1]))
  })
  bot.action(new RegExp(`^cat:(${UUID})$`, 'i'), async (ctx) => {
    await ctx.answerCbQuery()
    const category = (await getCategories()).find((c) => c.id === ctx.match[1])
    if (!category) return ctx.reply('Kategoriya topilmadi. Ro‘yxatni yangilab ko‘ring.')
    ctx.session.filters = { category_id: category.id, category_name: category.name, sort_by: 'newest' }
    return showBusinesses(ctx)
  })
  bot.action('all', async (ctx) => {
    await ctx.answerCbQuery()
    ctx.session.filters = DEFAULT_FILTERS()
    return showBusinesses(ctx)
  })
  bot.action('top', async (ctx) => {
    await ctx.answerCbQuery()
    return topHandler(ctx)
  })
  bot.action(/^page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery()
    return showBusinesses(ctx, Number(ctx.match[1]))
  })
  bot.action('backlist', async (ctx) => {
    await ctx.answerCbQuery()
    return showBusinesses(ctx, ctx.session.listOffset || 0)
  })
  bot.action(new RegExp(`^biz:(${UUID})(?::(\\d+))?$`, 'i'), async (ctx) => {
    await ctx.answerCbQuery()
    return showBusiness(ctx, ctx.match[1], Number(ctx.match[2] || 0))
  })
  bot.action(new RegExp(`^reviews:(${UUID})(?::(\\d+))?$`, 'i'), async (ctx) => {
    await ctx.answerCbQuery()
    return showReviews(ctx, ctx.match[1], Number(ctx.match[2] || 0))
  })

  // Telefon: Telegram'ning o'z "kontakt" kartasi — bir bosishda qo'ng'iroq qilish mumkin
  bot.action(new RegExp(`^phone:(${UUID})$`, 'i'), async (ctx) => {
    await ctx.answerCbQuery()
    const business = await getBusiness(ctx.match[1])
    const phone = normalizePhone(business.phone || '')
    if (!phone) return ctx.reply('Telefon raqami ko‘rsatilmagan.')
    try {
      await ctx.replyWithContact(phone, truncate(business.name, 60))
    } catch {
      await ctx.reply(`📞 <b>${escapeHtml(business.name)}</b>\n<code>${escapeHtml(phone)}</code>`, { parse_mode: 'HTML' })
    }
  })

  // Lokatsiya: Telegram xaritasi ko'rinishida
  bot.action(new RegExp(`^loc:(${UUID})$`, 'i'), async (ctx) => {
    await ctx.answerCbQuery()
    const b = await getBusiness(ctx.match[1])
    if (b.latitude == null || b.longitude == null) return ctx.reply('Lokatsiya ko‘rsatilmagan.')
    return ctx.replyWithVenue(b.latitude, b.longitude, truncate(b.name, 100), truncate(b.address || '—', 200))
  })

  bot.use(async (ctx) => {
    if (ctx.message) {
      await ctx.reply('Kerakli bo‘limni tanlang yoki /help buyrug‘ini yuboring.', menuKeyboard)
    }
  })

  bot.catch(async (error, ctx) => {
    console.error('Telegram bot update failed:', error)
    if (ctx.chat) {
      await ctx
        .reply('⚠️ Xizmat vaqtincha ishlamayapti. Birozdan so‘ng qayta urinib ko‘ring.', menuKeyboard)
        .catch((e) => console.error('Could not send error reply:', e))
    }
  })

  return bot
}

if (require.main === module) {
  const bot = setupBot()

  async function startBot() {
    try {
      await bot.telegram.setChatMenuButton({
        menuButton: { type: 'web_app', text: 'Ilovani ochish', web_app: { url: WEB_APP_URL } },
      })
      await bot.telegram.setMyCommands([
        { command: 'start', description: 'Boshlash' },
        { command: 'app', description: 'Ilovani ochish' },
        { command: 'categories', description: 'Kategoriyalar' },
        { command: 'search', description: 'Xizmat qidirish' },
        { command: 'top', description: 'Top reytingli xizmatlar' },
        { command: 'nearby', description: 'Yaqin xizmatlar' },
        { command: 'help', description: 'Yordam' },
      ])
    } catch (error) {
      console.error('Could not configure bot menu/commands:', error)
    }

    startKeepAlive()
    await bot.launch()
    console.log('Tezkor Xizmat Telegram bot is running')
  }

  startBot().catch((error) => {
    console.error('Could not start Telegram bot:', error)
    process.exitCode = 1
  })

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

module.exports = { setupBot }