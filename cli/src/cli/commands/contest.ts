/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'node:path'
import { Command, Option } from 'clipanion'
import * as t from 'typanion'
import consola from 'consola'
import ky from 'ky'
import type { Ranklist } from '@aoi-js/common'
import sanitize from 'sanitize-filename'
import { $ } from 'zx'
import { BaseCommand } from './base.js'
import fs from 'fs-extra'

export class ContestExportRanklistCommand extends BaseCommand {
  static paths = [[`contest`, `export`, `ranklist`]]

  static usage = Command.Usage({
    category: 'Contest',
    description: `Export ranklist of a contest`
  })

  limit = Option.String('-n,--limit', { validator: t.isNumber() })
  contestId = Option.String('-c,--contest')
  ranklistKey = Option.String('-r,--ranklist')
  output = Option.String('-o,--output', { required: true })

  async execute() {
    const api = await this.getAPI()
    const contestId =
      this.contestId ?? this.env.contestId ?? (await consola.prompt('Contest ID', { type: 'text' }))
    const problems = await api.get(`contest/${contestId}/problem`).json<any[]>()
    const idSlug = Object.fromEntries(
      problems.map((problem) => [problem._id, problem.settings.slug])
    )

    const ranklistKey = this.ranklistKey ?? (await consola.prompt('Ranklist Key', { type: 'text' }))
    const { url } = await api
      .get(`contest/${contestId}/ranklist/${ranklistKey}/url/download`)
      .json<{
        url: string
      }>()

    const data = await ky.get(url).json<Ranklist>()
    const limit = this.limit ?? data.participant.list.length
    const cont = await consola.prompt(`Will export ${limit} participants, continue?`, {
      type: 'confirm'
    })
    if (!cont) return
    const participants = data.participant.list.slice(0, limit)
    const digits = participants.length.toString().length
    let cnt = 0
    for (const participant of participants) {
      ++cnt
      const cntNo = `${cnt}`.padStart(digits, '0')
      consola.info(`Exporting (${cntNo}/${participants.length}) ${participant.userId}`)
      const no = `${participant.rank}`.padStart(digits, '0')
      const user = await api.get(`user/${participant.userId}`).json<{
        profile: {
          name: string
        }
      }>()
      const dir = path.join(this.output, sanitize(`${no}-${user.profile.name}`))
      await fs.ensureDir(dir)
      const solutions: any[] = []
      for (let page = 1; ; page++) {
        const result = await api
          .get(`contest/${contestId}/solution`, {
            searchParams: {
              userId: participant.userId,
              page,
              perPage: 30
            }
          })
          .json<{ items: any[] }>()
        if (!result.items.length) break
        solutions.push(...result.items)
      }
      solutions.sort((a, b) => a.submittedAt - b.submittedAt)
      const solutionsPerProblem: Record<string, any[]> = {}
      for (const solution of solutions) {
        const problem = idSlug[solution.problemId]
        if (!solutionsPerProblem[problem]) solutionsPerProblem[problem] = []
        solutionsPerProblem[problem].push(solution)
      }
      let stats = ''
      for (const [problem, solutions] of Object.entries(solutionsPerProblem)) {
        stats += `Problem ${problem} Total ${solutions.length} solutions\n`
        let selected = solutions[0]
        for (const solution of solutions) {
          if (solution.score > selected.score) selected = solution
        }
        for (const solution of solutions) {
          const submitTime = solution.submittedAt
            ? new Date(solution.submittedAt).toISOString()
            : 'UNSUBMITTED'
          stats += `${submitTime} ${solution._id} ${solution.score}`
          if (solution._id === selected._id) stats += ' *'
          stats += `\n`
        }
        const { url } = await api
          .get(`contest/${contestId}/solution/${selected._id}/data/download`)
          .json<{
            url: string
          }>()
        $.cwd = dir
        await $`wget -q -O ${problem}.zip ${url}`
        await $`unzip -q -d ${problem} ${problem}.zip`.nothrow()
        stats += '\n'
      }
      await fs.writeFile(path.join(dir, 'stats.txt'), stats)
    }
    consola.success(`Exported ${participants.length} participants`)
  }
}
