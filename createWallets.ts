/**
 * createWallets.ts
 *
 * Usage:
 *   ts-node createWallets.ts 80          # genera 80 wallets
 *
 * Salida:
 *   - Crea (o sobre-escribe) ./wallets.json con un array plano
 *     de claves privadas en base-58.
 */

import { Keypair } from '@solana/web3.js'
import * as fs from 'fs'
import * as path from 'path'
import bs58 from 'bs58'

/* -------- parámetros de línea de comandos -------- */
const N = parseInt(process.argv[2] ?? '', 10)
if (!Number.isFinite(N) || N <= 0) {
  console.error('Indica la cantidad de wallets, p. ej.: ts-node createWallets.ts 50')
  process.exit(1)
}

/* -------- generación -------- */
const wallets: string[] = []

for (let i = 0; i < N; i++) {
  const kp = Keypair.generate()
  wallets.push(bs58.encode(kp.secretKey))      // 64-bytes → base-58
}

const outfile = path.resolve(__dirname, 'wallets.json')
fs.writeFileSync(outfile, JSON.stringify(wallets, null, 2), 'utf8')

console.log(`✅  Generadas ${N} wallets y guardadas en ${outfile}`)