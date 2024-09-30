import { loadConfig } from 'c12'
import { BaseCommand } from './base.js'
import consola from 'consola'
import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import archiver from 'archiver'
import { $, fs, path, tmpdir, tmpfile } from 'zx'
import { pipeline } from 'node:stream/promises'
import { type ProblemConfig, SProblemConfigSchema as SDataConfig } from '@aoi-js/common'
import { createHash } from 'node:crypto'
import { Option } from 'clipanion'
import matter from 'gray-matter'
import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

// @ts-expect-error
marked.use(markedTerminal())

export const SAOIProblemConfig = Type.Object({
  type: Type.Literal('problem'),
  server: Type.String(),
  problemId: Type.String()
})
const ProblemConfig = TypeCompiler.Compile(SAOIProblemConfig)
const DataConfig = TypeCompiler.Compile(SDataConfig)

export const SAOIContentMetadata = Type.Partial(
  Type.Object({
    title: Type.String(),
    slug: Type.String(),
    tags: Type.Array(Type.String())
  })
)
const ContentMetadata = TypeCompiler.Compile(SAOIContentMetadata)

async function sha256(file: string) {
  const hash = createHash('sha256')
  const input = fs.createReadStream(file)
  for await (const chunk of input) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export class ProblemDeployCommand extends BaseCommand {
  static paths = [[`problem`, `deploy`]]

  static usage = BaseCommand.Usage({
    category: 'Problem',
    description: `Deploy a problem`
  })

  packOnly = Option.Boolean('-P,--pack-only')
  statement = Option.Boolean('-s,--statement')
  description = Option.String('-d,--description')
  set = Option.Boolean('-S,--set')
  rejudge = Option.Boolean('-r,--rejudge')

  async execute() {
    const { config: dataConfig } = await loadConfig({ configFile: 'problem' })
    if (!DataConfig.Check(dataConfig)) {
      consola.error('Invalid data configuration')
      return 1
    }
    await fs.ensureDir(path.resolve('dist'))
    const dataArchive = path.resolve('dist', 'data.zip')
    const output = fs.createWriteStream(dataArchive)
    const archive = archiver('zip', {})
    const pipe = pipeline(archive, output)
    archive.directory('data', false)
    archive.append(JSON.stringify(dataConfig, null, '  '), { name: 'problem.json' })
    archive.finalize()
    await pipe
    const { size } = await fs.stat(dataArchive)
    consola.info(`Data packed into ${dataArchive} size=${size}Bytes`)
    const hash = await sha256(dataArchive)
    consola.info(`Data sha256 hash = ${hash}`)
    if (this.packOnly) return

    const { config } = await loadConfig({ name: 'aoi' })
    if (!ProblemConfig.Check(config)) {
      consola.error('Invalid configuration')
      return 1
    }
    const api = await this.getAPI()
    await fs.ensureDir('dist')

    if (this.statement) {
      consola.start('Uploading statement')
      const statement = await fs.readFile('statement.md', 'utf-8')
      const { data, content } = matter(statement)
      if (!ContentMetadata.Check(data)) {
        consola.error('Invalid statement metadata')
        return 1
      }
      await api.patch(`problem/${config.problemId}/content`, {
        json: { ...data, description: content }
      })
      consola.success('Statement uploaded')
    }

    const description = this.description || (await consola.prompt('Description', { type: 'text' }))
    if (!description) {
      consola.fatal('Description is required')
      return 1
    }

    const resp = await api.get(`problem/${config.problemId}/data/${hash}/url/upload`)
    const { url } = await resp.json<{ url: string }>()
    consola.start(`Uploading data`)
    $.verbose = true
    await $`curl --progress-bar -T ${dataArchive} ${url}`
    await api.post(`problem/${config.problemId}/data`, {
      json: {
        hash: hash,
        description: description,
        config: dataConfig
      }
    })
    consola.success(`Problem Deployed with hash ${hash.slice(0, 7)}`)

    if (this.set || (await consola.prompt('Set as current data', { type: 'confirm' }))) {
      await api.post(`problem/${config.problemId}/data/setDataHash`, {
        json: { hash }
      })
      consola.success('Data set as current')
      if (this.rejudge || (await consola.prompt('Rejudge solutions', { type: 'confirm' }))) {
        const { modifiedCount } = await api
          .post(`problem/${config.problemId}/admin/rejudge-all`, {
            json: { pull: true }
          })
          .json<{ modifiedCount: number }>()
        consola.success(`Rejudged ${modifiedCount} solutions`)
      }
    }
  }
}

export class ProblemShowCommand extends BaseCommand {
  static paths = [[`problem`, `show`]]

  static usage = BaseCommand.Usage({
    category: 'Problem',
    description: `Show problem details`
  })

  problemId = Option.String('-p,--problem')
  contestId = Option.String('-c,--contest')
  problemSlug = Option.String()

  async execute() {
    const api = await this.getAPI()
    const contestId =
      this.contestId ?? this.env.contestId ?? (await consola.prompt('Contest ID', { type: 'text' }))
    const resolveProblemId = async () => {
      if (!this.problemSlug) {
        this.problemSlug = await consola.prompt('Problem Slug', { type: 'text' })
      }
      if (!this.problemSlug) throw new Error('Cannot resolve problem ID')
      if (contestId) {
        const problems = await api.get(`contest/${contestId}/problem`).json<any[]>()
        const problem = problems.find((problem) => problem.settings.slug === this.problemSlug)
        return problem?._id
      } else {
        throw new Error('Cannot resolve problem ID outside of contest')
      }
    }
    const problemId = this.problemId ?? (await resolveProblemId())
    const problem: any = contestId
      ? await api.get(`contest/${contestId}/problem/${problemId}`).json()
      : await api.get(`problem/${problemId}`).json()
    console.log(marked(problem.description))
  }
}

export class ProblemSubmitCommand extends BaseCommand {
  static paths = [[`problem`, `submit`]]

  static usage = BaseCommand.Usage({
    category: 'Problem',
    description: `Submit a problem`
  })

  problemId = Option.String('-p,--problem')
  contestId = Option.String('-c,--contest')
  problemSlug = Option.String()

  async execute() {
    const api = await this.getAPI()
    const contestId =
      this.contestId ?? this.env.contestId ?? (await consola.prompt('Contest ID', { type: 'text' }))
    const resolveProblemId = async () => {
      if (!this.problemSlug) {
        this.problemSlug = await consola.prompt('Problem Slug', { type: 'text' })
      }
      if (!this.problemSlug) throw new Error('Cannot resolve problem ID')
      if (contestId) {
        const problems = await api.get(`contest/${contestId}/problem`).json<any[]>()
        const problem = problems.find((problem) => problem.settings.slug === this.problemSlug)
        return problem?._id
      } else {
        throw new Error('Cannot resolve problem ID outside of contest')
      }
    }
    const problemId = this.problemId ?? (await resolveProblemId())
    const problem: any = contestId
      ? await api.get(`contest/${contestId}/problem/${problemId}`).json()
      : await api.get(`problem/${problemId}`).json()
    const config = problem.config as ProblemConfig
    const submitMethods = Object.entries(config.submit)
      .filter(([_, value]) => value)
      .map(([key]) => key)
    const submitMethod = await consola.prompt('Submit Method', {
      type: 'select',
      options: submitMethods
    })
    let zipPath = tmpfile('solution.zip')
    fs.rm(zipPath, { force: true })
    $.verbose = true
    switch (submitMethod) {
      case 'upload':
        const file = await consola.prompt('File', { type: 'text' })
        await fs.copy(file, zipPath)
        break
      case 'zipFolder':
        const folder = await consola.prompt('Folder', { type: 'text' })
        await $`zip -r -J ${zipPath} ${folder}`
        break
      case 'form':
        const tmpwd = tmpdir()
        const files = config.submit.form!.files
        for (const file of files) {
          const currentPath = path.join(tmpwd, file.path)
          const userfile = await consola.prompt(`File ${file.label}`, { type: 'text' })
          await fs.copy(userfile, currentPath)
        }
        await $`zip -r -J ${zipPath} ${tmpwd}`
        await fs.rm(tmpwd, { recursive: true, force: true })
        break
    }
    $.verbose = false
    const size = fs.statSync(zipPath).size
    const hash = await sha256(zipPath)
    consola.info(`File packed into ${zipPath} size=${size}Bytes sha256=${hash}`)
    //https://hpcgame.pku.edu.cn/api/problem/b50a33c2-df75-4aaf-a85b-eb4cce703dea/solution
    const solutionResp = contestId
      ? await api.post(`contest/${contestId}/problem/${problemId}/solution`, {
          json: { hash, size }
        })
      : await api.post(`problem/${problemId}/solution`, { json: { hash, size } })
    const { solutionId, uploadUrl } = await solutionResp.json<any>()
    await $`curl --progress-bar -T ${zipPath} ${uploadUrl}`
    consola.success(`Uploaded solution ${solutionId}`)
    await fs.rm(zipPath)
    // https://hpcgame.pku.edu.cn/api/problem/b50a33c2-df75-4aaf-a85b-eb4cce703dea/solution/c6e6fbc2-48f2-4854-a2db-e9e28d186a73/submit
    const submitResp = contestId
      ? await api.post(`contest/${contestId}/solution/${solutionId}/submit`, { json: {} })
      : await api.post(`problem/${problemId}/solution/${solutionId}/submit`, { json: {} })
    await submitResp.json()
    consola.success(`Submitted solution ${solutionId}`)
  }
}
