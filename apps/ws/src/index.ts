import { createServer } from './server.js'

const port = Number(process.env.PORT ?? 8080)
createServer(port)
console.log(`WebSocket server listening on port ${port}`)
