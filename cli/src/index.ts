import { Static } from '@sinclair/typebox'
import { SAOIProblemConfig } from './cli/commands/problem.js'

export function defineConfig(config: Static<typeof SAOIProblemConfig>) {
  return config
}
