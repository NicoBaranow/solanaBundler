import { CREATE_CPMM_POOL_PROGRAM, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId, Raydium, CurveCalculator } from '@raydium-io/raydium-sdk-v2'
import { NATIVE_MINT } from '@solana/spl-token'
import { Keypair, VersionedTransaction, TransactionMessage, SystemProgram, PublicKey } from '@solana/web3.js'
import * as jito from 'jito-ts'

import BN from 'bn.js'
import bs58 from 'bs58'
import { readFileSync } from 'fs'

import { loadConfig } from './config'

  

export async function createPool () {

  /**
   * Input: None
   * Output: object VersionedTransaction v0
   * Description: devuelve una transaccion firmada, serializada y en base64 lista para enviar enviar a la red. 
   */

    const { raydium, txVersion, connection } = await loadConfig({ loadToken: true })
    
    // WSOL nativo
    const mintA = await raydium.token.getTokenInfo(NATIVE_MINT.toBase58())
    
    // Tu token TEST7 en Devnet
    const mintB = await raydium.token.getTokenInfo('CxSJZ6pfnYntBNkumCqrDgoY3dBRVTcAUpAbTTZS7Zd')
    
    const feeConfigs = await raydium.api.getCpmmConfigs()

    // Ajuste de IDs en Devnet
    feeConfigs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(
        DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,    // Para Mainnet: usar CREATE_CPMM_POOL_PROGRAM
        config.index
      ).publicKey.toBase58()
    })
  
    try {
      // Creamos el pool usando la feeAccount del SDK
      const  {execute, extInfo}  = await raydium.cpmm.createPool({
        programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
        poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,   // Devnet fee vault PDA :contentReference[oaicite:1]{index=1}
        mintA,
        mintB,
        mintAAmount: new BN(1 * 10 ** mintA.decimals),
        mintBAmount: new BN(1 * 10 ** mintB.decimals),
        startTime: new BN(0),
        feeConfig: feeConfigs[0],
        associatedOnly: false,
        ownerInfo: { useSOLBalance: true },
        txVersion,
      })
  
      const {txId, signedTx} = await execute({ sendAndConfirm: false }) // Cuando se corre execute False, no se envía la transacción automáticamente, pero si falla el script por algun motivo, los SOL y tokens no se ven en la cuenta del owner. Chequear!!! En teoría, los SOL se convierten a wSOL y los tokens quedan en el ADA ? no se qué es realmente.   Chequear!!!
      console.log('Pool creado exitosamente:', txId)
      

      const poolAccount   = extInfo.address.poolId.toBase58();

      const raw   = signedTx.serialize()                    // Uint8Array
      const txB64 = Buffer.from(raw).toString('base64')     // string
      return {txB64, poolAccount}

    } catch (err) {
      console.log(err)
    }
}

type WalletInfo = {
  kp: Keypair              // Keypair for signing
  publicKey: string        // base58 pubkey
  secretKey: Uint8Array    // raw 64‑byte secret key
  solLamports: number      // SOL balance snapshot
  swapB64?: string         // signed SOL→ROCK swap (base64)
}
  
async function loadWalletInfos(path = './wallets.json'): Promise<WalletInfo[]> {
  const { connection } = await loadConfig()
  // 1 ─ parse the JSON file
  const raw: string[] = JSON.parse(readFileSync(path, 'utf8'))

  // 2 ─ convert to Keypair[]
  const kps = raw.map(b58 => Keypair.fromSecretKey(bs58.decode(b58)))

  // 3 ─ fetch balances in one RPC batch (100 pubkeys per call is safe)
  const pubkeys = kps.map(kp => kp.publicKey)
  const infos = await connection.getMultipleAccountsInfo(pubkeys, 'confirmed')

  // 4 ─ build the array of objects
  return kps.map((kp, i) => ({
    kp,
    publicKey: kp.publicKey.toBase58(),
    secretKey: kp.secretKey,              // Uint8Array(64)
    solLamports: infos[i]?.lamports ?? 0, // 0 if account nonexistent
  }))
}

async function buildSwapTxForWallet(
  w: WalletInfo,
  poolInfo: any,
  poolKeys: any,
  rpcData: any,
  raydium: Raydium,
  txVersion: any
): Promise<string> {
  // 1. Calcular el monto disponible (deja 8 000 lamports de colchón)
  const inputLamports = w.solLamports - 8_000
  if (inputLamports <= 0) return ''

  // 2. Determinar si SOL es mintA o mintB
  const baseIn = NATIVE_MINT.toBase58() === poolInfo.mintA.address

  // 3. Calcular el swapResult siguiendo la demo oficial
  const swapResult = CurveCalculator.swap(
    new BN(inputLamports),
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
    rpcData.configInfo!.tradeFeeRate
  )

  // 4. Construir la transacción de swap (sin enviarla)
  const { execute } = await raydium.cpmm.swap({
    poolInfo,
    poolKeys,
    payer: w.kp.publicKey,         
    inputAmount: new BN(inputLamports),
    swapResult,
    slippage: 0.05,                // 5 %
    baseIn,
    txVersion
  })

  // 5. Obtener la transacción sin confirmar
  const { signedTx } = await execute({ sendAndConfirm: false })

  // 7. Serializar a base‑64 para guardarla en el objeto
  return Buffer.from(signedTx.serialize()).toString('base64')
}

async function swapSolToRock(poolId = ''): Promise<WalletInfo[]> {
  const walletsInfo = await loadWalletInfos('./wallets.json')
  const { raydium, txVersion } = await loadConfig({ loadToken: true })

  // Obtener info del pool una sola vez

  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId)

  // Construir y guardar el swap en cada objeto
  for (const w of walletsInfo) {
    w.swapB64 = await buildSwapTxForWallet(w, poolInfo, poolKeys, rpcData, raydium, txVersion)
  }
  return walletsInfo;
}

async function buildTipTransaction(
  idx: number,
  tipAccounts: string[],
  walletsInfo: WalletInfo[],
  blockhash: string,
  tipLamports: number = 1000
): Promise<VersionedTransaction> {
  // pick a random tip account
  const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
  // compute fee payer index
  let feePayerIndex = idx * 4;
  if (feePayerIndex >= walletsInfo.length) feePayerIndex = walletsInfo.length - 1;
  // search for wallet with enough SOL
  let feePayerWallet: WalletInfo | undefined = undefined;
  for (let i = feePayerIndex; i < walletsInfo.length; i++) {
    if (walletsInfo[i].solLamports >= tipLamports) {
      feePayerWallet = walletsInfo[i];
      break;
    }
  }
  if (!feePayerWallet) {
    throw new Error("No wallet has enough SOL for tip");
  }
  // create transfer instruction
  const instruction = SystemProgram.transfer({
    fromPubkey: feePayerWallet.kp.publicKey,
    toPubkey: new PublicKey(tipAccount),
    lamports: tipLamports,
  });
  // compile message
  const messageV0 = new TransactionMessage({
    payerKey: feePayerWallet.kp.publicKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();
  const tipTx = new VersionedTransaction(messageV0);
  tipTx.sign([feePayerWallet.kp]);
  return tipTx;
}

async function createBundles() {

  const result = await createPool();
  if (!result) {
    throw new Error("createPool() returned undefined.");
  }
  const { txB64, poolAccount } = result;
  
  const tx = txFromB64(txB64) // VersionedTransaction del liquitity pool, lista para enviar con J
  console.log('El VersionedTransaction del liquidity Pool creation es: ', tx)

  const walletsInfo = await swapSolToRock(poolAccount);
  console.log('Wallets info con swaps:', walletsInfo);
  const client = jito.searcher.searcherClient('ny.mainnet.block-engine.jito.wtf')
  const tipAccountsObject = await client.getTipAccounts();
  if (!tipAccountsObject.ok) {
    throw new Error(`No pude obtener tipAccounts: ${tipAccountsObject.error.message}`);
  }
  const tipAccounts: string[] = tipAccountsObject.value;

  let swaps = [] // Array<VersionedTransaction> con todos los swaps listos para enviar con Jito

  for (const i in walletsInfo) {
    const w = walletsInfo[i];
    if (w.swapB64) {
      const swapTx = txFromB64(w.swapB64);
      swaps.push(swapTx);
    }
  }

  // First bundle: pool creation + first 3 swaps + random tip
  const bundles: Array<Array<VersionedTransaction | string>> = [];

  // copy swaps array
  const remainingSwaps = [...swaps];

  // take first 3 for the initial bundle
  const firstSwaps = remainingSwaps.splice(0, 3);
  bundles.push([
    tx,
    ...firstSwaps
  ]);

  // Create subsequent bundles of 4 swaps + random tip
  while (remainingSwaps.length > 0) {
    const swapGroup = remainingSwaps.splice(0, 4);
    bundles.push([
      ...swapGroup
    ]);
  }

  const { connection } = await loadConfig();

  const { blockhash } = await connection.getLatestBlockhash('finalized');

  const tipTxs: VersionedTransaction[] = [];
  for (let idx = 0; idx < bundles.length; idx++) {
    tipTxs.push(await buildTipTransaction(idx, tipAccounts, walletsInfo, blockhash));
  }

  // Append each tip transaction as the final tx in its bundle
  tipTxs.forEach((tipTx, idx) => {
    bundles[idx].push(tipTx);
  });

  console.log('Bundles ready for Jito:', bundles);
}

function txFromB64(b64: string): VersionedTransaction {
  const raw = Buffer.from(b64, 'base64');
  return VersionedTransaction.deserialize(raw);
}


createBundles().catch((err) => {
  console.error(err);
  process.exit(1);
});
