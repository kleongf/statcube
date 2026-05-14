const FTCSCOUT_URL = import.meta.env.DEV
  ? '/ftcscout-graphql'
  : 'https://api.ftcscout.org/graphql'

export async function ftcscoutQuery(query, variables) {
  const res = await fetch(FTCSCOUT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors?.length) throw new Error(json.errors[0].message)
  return json.data
}
