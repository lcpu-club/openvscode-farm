import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { serve } from '@hono/node-server'
import { arktypeValidator } from '@hono/arktype-validator'
import { type } from 'arktype'
import { $ } from 'zx'
import { randomBytes } from 'crypto'
import { IMAGE_NAME, CONTAINER_URL, API_ROOT } from './config.js'
import { getContestInfo, getUserInfo } from './api.js'

const app = new Hono()

declare module 'hono' {
  interface ContextVariableMap {
    token: string
    decoded: { userId: string; iat: number; exp: number }
  }
}

app.use(async (c, next) => {
  const token = c.req.header('x-forwarded-access-token')
  if (!token) throw new HTTPException(401)
  c.set('token', token)
  try {
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    c.set('decoded', decoded)
  } catch (cause) {
    throw new HTTPException(401, { cause })
  }
  await next()
})

app.get('/', async (c) => {
  const token = c.var.token
  const { userId } = c.var.decoded
  const userInfo = await getUserInfo(token, userId)
  const { stdout } =
    await $`docker ps --all --filter "label=userId=${userId}" --format "{{.Names}} {{.Status}}"`.nothrow()
  const containers = await Promise.all(
    stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line)
      .map(async (line) => {
        const [name, ...status] = line.split(' ')
        const [_, type, ...rest] = name.split('_')
        switch (type) {
          case 'user':
            return { title: userInfo.name, name, status: status.join(' ') }
          case 'contest':
            const contestInfo = await getContestInfo(token, rest[0])
            return { title: contestInfo.title, name, status: status.join(' '), contestId: rest[0] }
          default:
            return { name, status: status.join(' ') }
        }
      })
  )
  return c.html(
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body class="bg-gray-100">
        <header class="bg-slate-800 text-white py-4 px-6 text-center text-2xl font-bold">
          OpenVSCode Farm
        </header>
        <main class="container mx-auto px-4 py-8">
          {containers.length === 0 ? (
            <div class="bg-white shadow-md rounded-lg p-6 text-center">
              <p class="text-lg text-gray-600">No container is created</p>
              <a
                href="/start"
                class="inline-block px-6 py-3 bg-blue-500 text-white font-bold rounded hover:bg-blue-600 transition duration-300"
              >
                Launch Container
              </a>
            </div>
          ) : (
            <div class="space-y-4">
              {containers.map((container) => (
                <div
                  key={container.name}
                  class="bg-white shadow-md rounded-lg p-6 flex justify-between items-center"
                >
                  <div>
                    <h2 class="text-lg font-semibold text-gray-800">{container.title}</h2>
                    <p class="text-sm text-gray-600">{container.status}</p>
                  </div>
                  <div class="space-x-2 flex">
                    <form class="p-0 m-0" action="/start" method="get">
                      {container.contestId && (
                        <input type="hidden" name="contestId" value={container.contestId} />
                      )}
                      <button class="px-4 py-2 bg-green-500 text-white font-bold rounded hover:bg-green-600 transition duration-300">
                        Start
                      </button>
                    </form>
                    <form class="p-0 m-0" action="/stop" method="post">
                      {container.contestId && (
                        <input type="hidden" name="contestId" value={container.contestId} />
                      )}
                      <button class="px-4 py-2 bg-red-500 text-white font-bold rounded hover:bg-red-600 transition duration-300">
                        Stop
                      </button>
                    </form>
                    <form class="p-0 m-0" action="/remove" method="post">
                      {container.contestId && (
                        <input type="hidden" name="contestId" value={container.contestId} />
                      )}
                      <button class="px-4 py-2 bg-gray-500 text-white font-bold rounded hover:bg-gray-600 transition duration-300">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </body>
    </html>
  )
})

app.get(
  '/start',
  arktypeValidator(
    'query',
    type({
      'contestId?': 'string'
    })
  ),
  async (c) => {
    const { contestId } = c.req.valid('query')
    const { userId } = c.var.decoded
    let containerName = `vscs_user_${userId}`
    const labels: string[] = [`--label`, `userId=${userId}`]
    if (contestId) {
      containerName = `vscs_contest_${contestId}_${userId}`
      labels.push(`--label`, `contestId=${contestId}`)
    }
    const secretToken = randomBytes(16).toString('hex')
    await $`docker run -d --name ${containerName} ${labels} --init --entrypoint "" -p 3000 ${IMAGE_NAME} sh -c 'exec \${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server "\${@}"' -- --connection-token ${secretToken} --host 0.0.0.0 --enable-remote-auto-shutdown`.nothrow()
    await $`docker start ${containerName}`.nothrow()
    const env = {
      token: c.var.token,
      contestId,
      apiRoot: API_ROOT
    }
    const envstr = Buffer.from(JSON.stringify(env, null, 2)).toString('base64')
    await $`docker exec ${containerName} sh -c 'echo ${envstr} | base64 -d > /tmp/env.json'`.nothrow()
    const { stdout } =
      await $`docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}} {{ index (index .Config.Cmd) 5 }}' ${containerName}`
    const [port, token] = stdout.trim().split(' ')
    const url = CONTAINER_URL.replaceAll('{port}', port).replaceAll('{token}', token)
    return c.redirect(url, 302)
  }
)

app.post(
  '/stop',
  arktypeValidator(
    'form',
    type({
      'contestId?': 'string'
    })
  ),
  async (c) => {
    const { contestId } = c.req.valid('form')
    const { userId } = c.var.decoded
    let containerName = `vscs_user_${userId}`
    if (contestId) {
      containerName = `vscs_contest_${contestId}_${userId}`
    }
    await $`docker stop ${containerName}`.nothrow()
    return c.json({ success: true })
  }
)

app.post(
  '/remove',
  arktypeValidator(
    'form',
    type({
      'contestId?': 'string'
    })
  ),
  async (c) => {
    const { contestId } = c.req.valid('form')
    const { userId } = c.var.decoded
    let containerName = `vscs_user_${userId}`
    if (contestId) {
      containerName = `vscs_contest_${contestId}_${userId}`
    }
    await $`docker rm -f -v ${containerName}`.nothrow()
    return c.json({ success: true })
  }
)

serve({
  fetch: app.fetch,
  port: 3030,
  hostname: '0.0.0.0'
})
