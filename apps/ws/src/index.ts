import { createServer } from './server.js'

const port = Number(process.env.PORT ?? 8080)
const wss = createServer(port)

wss.on('listening', () => {
  console.log(`WebSocket server listening on port ${port}`)
})

wss.on('error', (err) => {
  console.error('WebSocket server failed to start:', err)
  process.exit(1)
})
