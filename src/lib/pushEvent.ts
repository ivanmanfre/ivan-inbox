export type PushClientEvent = { type: 'push'; url: string; family?: string; notificationId?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The service worker and foreground frame share this exact window message. */
export function pushClientEvent(data: { url?: unknown; family?: unknown; notificationId?: unknown }): PushClientEvent {
  return {
    type: 'push',
    url: typeof data.url === 'string' ? data.url : './',
    ...(typeof data.family === 'string' ? { family: data.family } : {}),
    ...(typeof data.notificationId === 'string' && UUID.test(data.notificationId)
      ? { notificationId: data.notificationId }
      : {}),
  }
}

export function forwardPushToClients(
  data: Parameters<typeof pushClientEvent>[0],
  clients: readonly Pick<Client, 'postMessage'>[],
): void {
  const message = pushClientEvent(data)
  for (const client of clients) client.postMessage(message)
}
