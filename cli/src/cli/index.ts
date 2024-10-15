import { Cli } from 'clipanion'
import * as commands from './commands/index.js'

export const cli = new Cli({
  binaryLabel: `AOI Client`,
  binaryName: `aoi`,
  binaryVersion: await import('../../package.json', { assert: { type: 'json' } }).then(
    ({ default: { version } }) => version
  )
})

cli.register(commands.ProblemDeployCommand)
cli.register(commands.ProblemShowCommand)
cli.register(commands.ProblemSubmitCommand)
cli.register(commands.ContestExportRanklistCommand)
