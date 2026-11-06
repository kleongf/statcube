// Records ftcscout's response to getEventQuery as test fixtures.
// Usage: node scripts/record-ranking-fixtures.mjs 2025:USMIGRQ 2024:USTXNXM5
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEventQuery } from '../src/lib/eventQuery.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/__fixtures__/rankings')
mkdirSync(dir, { recursive: true })

for (const arg of process.argv.slice(2)) {
  const [seasonText, code] = arg.split(':')
  const season = Number(seasonText)
  const res = await fetch('https://api.ftcscout.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: getEventQuery(season), variables: { season, code } }),
  })
  const json = await res.json()
  if (json.errors?.length || !json.data?.eventByCode) {
    throw new Error(`${arg}: ${json.errors?.[0]?.message ?? 'event not found'}`)
  }
  writeFileSync(join(dir, `${season}-${code}.json`), JSON.stringify(json))
  console.log(`recorded ${arg}`)
}
