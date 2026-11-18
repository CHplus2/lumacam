// Downsize large photos in the browser before upload. Vercel rejects request
// bodies over 4.5MB, and smaller images load faster for everyone.
const MAX_SIDE = 1600
const KEEP_BELOW = 1.2 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

export async function shrinkImage(file) {
  if (file.size <= KEEP_BELOW) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) return file
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}
