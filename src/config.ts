export const LISTEN_PORT = parseInt(process.env.LISTEN_PORT ?? '3030')
export const IMAGE_NAME = process.env.IMAGE_NAME ?? 'openvscode-server-base'
export const CONTAINER_URL = process.env.CONTAINER_URL ?? 'http://localhost:{port}?tkn={token}'
export const API_ROOT = process.env.API_ROOT ?? 'https://hpcgame.pku.edu.cn/api'

console.log(`OpenVSCode Farm Configuration:
  - Listen Port  : ${LISTEN_PORT}
  - Image Name   : ${IMAGE_NAME}
  - Container URL: ${CONTAINER_URL}
  - API Root     : ${API_ROOT}
`)
