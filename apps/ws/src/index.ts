import { createServer } from './server.js'
import { MemoryRoomStore } from './store.js'
import { RedisRoomStore } from './redisStore.js'

const port = Number(process.env.PORT ?? 8080)
const store = process.env.REDIS_URL
  ? new RedisRoomStore(process.env.REDIS_URL)
  : new MemoryRoomStore()

if (process.env.REDIS_URL) console.log('Using Redis room store')

const wss = createServer(port, store)

wss.on('listening', () => {
  console.log(`WebSocket server listening on port ${port}`)
})

wss.on('error', (err) => {
  console.error('WebSocket server failed to start:', err)
  process.exit(1)
})
