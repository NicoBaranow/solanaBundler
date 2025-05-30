import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2'
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js'
import bs58 from 'bs58'
import 'dotenv/config'         
import * as dotenv from 'dotenv'
dotenv.config()

/**
 * Centralised configuration loader.
 * Values can be overridden via environment variables:
 *   CLUSTER   = 'mainnet' | 'devnet'
 *   RPC_URL   = full RPC endpoint
 *   OWNER_KEY = base‑58 secret key
 */

export interface AppConfig {
  owner: Keypair
  connection: Connection
  cluster: 'mainnet' | 'devnet'
  txVersion: TxVersion
  raydium: Raydium
}

let cached: AppConfig | undefined

export async function loadConfig(
  opts?: { loadToken?: boolean }
): Promise<AppConfig> {
  if (cached) return cached

  /* ---- resolve parameters ------------------------------------------------ */
  const cluster =
    (process.env.CLUSTER as 'mainnet' | 'devnet') ?? 'devnet'

  const rpc =
    process.env.RPC_URL ??
    (cluster === 'mainnet'
      ? clusterApiUrl('mainnet-beta')
      : 'https://api.devnet.solana.com')

  const ownerB58 = process.env.OWNER_KEY
  if (!ownerB58)
    throw new Error(
      'Set OWNER_KEY env-var with the base58 secret key of the fee payer'
    )

  /* ---- build primitives -------------------------------------------------- */
  const owner = Keypair.fromSecretKey(bs58.decode(ownerB58))
  const connection = new Connection(rpc)
  const txVersion = TxVersion.V0

  /* ---- Lazy‑load Raydium SDK -------------------------------------------- */
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster,
    blockhashCommitment: 'finalized',
    disableLoadToken: !opts?.loadToken,
    disableFeatureCheck: true
  })

  cached = { owner, connection, cluster, txVersion, raydium }
  return cached
}
