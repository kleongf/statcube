import { scoreFieldsFor } from './rankings.js'

export function getEventQuery(season) {
  const scoreFields = scoreFieldsFor(season).join(' ')
  return `
    query EventByCode($season: Int!, $code: String!) {
      eventByCode(season: $season, code: $code) {
        location { city country state }
        start
        end
        finished
        code
        matches {
          matchNum
          tournamentLevel
          hasBeenPlayed
          scheduledStartTime
          postResultTime
          teams {
            teamNumber
            onField
            alliance
            surrogate
          }
          scores {
            ... on MatchScores${season} {
              red { ${scoreFields} }
              blue { ${scoreFields} }
            }
          }
        }
        teams {
          teamNumber
          team { name number }
          stats {
            ... on TeamEventStats${season} {
              qualMatchesPlayed
              rank
              rp
              tb1
              tb2
              wins
              losses
              ties
              dqs
            }
          }
        }
      }
    }
  `
}
