import { closeDb, migrateDb } from './index.ts'

await migrateDb()
await closeDb()
console.log('Database migrated.')
