import { readFileSync } from 'node:fs'
import { Command } from 'clipanion'
import consola from 'consola'
import ky, { HTTPError } from 'ky'

export abstract class BaseCommand extends Command {
  async catch(error: unknown) {
    consola.error(error)
  }

  env: {
    token: string
    contestId: string
    apiRoot: string
  }

  constructor() {
    super()
    this.env = JSON.parse(readFileSync('/tmp/env.json', 'utf8'))
  }

  protected async getAPI() {
    const http = ky.create({
      prefixUrl: this.env.apiRoot,
      hooks: {
        beforeRequest: [(req) => req.headers.set('Authorization', `Bearer ${this.env.token}`)],
        beforeError: [
          async (err: HTTPError) => {
            if (err.response.status === 401) {
              const { code } = <{ code: string }>await err.response.json()
              if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
                consola.error('Session expired')
              }
            }
            return err
          }
        ]
      }
    })
    return http
  }
}
