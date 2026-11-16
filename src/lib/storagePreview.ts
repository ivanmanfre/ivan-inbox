const PREFIX = '_library-thumbnails/w480-h600-q75/'

/** Normal object URLs for reusable public-library previews. */
export function storedPreviewUrl(value: string): string {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/^\/storage\/v1\/(object|render\/image)\/public\/([^/]+)\/(.+)$/)
    if (!match) return value
    const [, route, bucket, path] = match
    if (route !== 'object') {
      for (const key of ['width', 'height', 'resize', 'quality', 'format']) url.searchParams.delete(key)
      url.pathname = `/storage/v1/object/public/${bucket}/${path}`
    }
    if (bucket !== 'post-stills' && bucket !== 'client-photos') return route === 'object' ? value : url.toString()
    if (path.split('/').some(part => part === 'onepost' || part === '_edit_preview')) return route === 'object' ? value : url.toString()
    if (!path.startsWith('_library-thumbnails/')) {
      url.pathname = `/storage/v1/object/public/${bucket}/${PREFIX}${path}.webp`
    }
    return url.toString()
  } catch {
    return value
  }
}
