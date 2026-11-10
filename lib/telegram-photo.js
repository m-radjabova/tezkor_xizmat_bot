const { Input } = require('telegraf')

const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

async function downloadTelegramPhoto(url) {
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Photo URL is invalid.')
  }
  if (parsedUrl.protocol !== 'https:') throw new Error('Photo URL must use HTTPS.')

  const response = await fetch(parsedUrl, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Could not download photo (HTTP ${response.status}).`)

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const extension = IMAGE_EXTENSIONS[contentType]
  if (!extension) throw new Error(`Unsupported photo content type: ${contentType || 'unknown'}.`)

  const declaredSize = Number(response.headers.get('content-length'))
  if (declaredSize > MAX_PHOTO_SIZE) throw new Error('Photo exceeds Telegram’s 10 MB upload limit.')
  if (!response.body) throw new Error('Photo response has no content.')

  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_PHOTO_SIZE) throw new Error('Photo exceeds Telegram’s 10 MB upload limit.')
    chunks.push(chunk)
  }
  if (!size) throw new Error('Photo response is empty.')

  return Input.fromBuffer(Buffer.concat(chunks, size), `photo.${extension}`)
}

module.exports = { downloadTelegramPhoto }
