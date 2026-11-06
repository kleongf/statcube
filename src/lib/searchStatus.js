export function searchStatus({ q, key, settledKey, failedKey }) {
  if (!q) return 'idle'
  if (failedKey === key) return 'failed'
  return settledKey === key ? 'settled' : 'pending'
}
