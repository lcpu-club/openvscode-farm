import ky from 'ky'
import { API_ROOT } from './config.js'

export const client = ky.extend({
  prefixUrl: API_ROOT
})

export async function getUserInfo(token: string, userId: string) {
  return client
    .get(`user/${userId}/profile`, { headers: { authorization: `Bearer ${token}` } })
    .json<{ name: string; email: string }>()
}

export async function getContestInfo(token: string, contestId: string) {
  return client
    .get(`contest/${contestId}`, { headers: { authorization: `Bearer ${token}` } })
    .json<{ title: string }>()
}
