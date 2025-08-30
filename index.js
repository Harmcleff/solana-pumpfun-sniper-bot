import WebSocket from "ws";
import axios from "axios";
import fetch from "node-fetch";
import { connection } from "./lib/config.js";
import { Metaplex } from "@metaplex-foundation/js";
import { PublicKey } from "@solana/web3.js";
import { Buy } from "./swapClient.js";
import { Monitor } from "./monitor.js";
import { notifyBuy, notifyBuyFailed } from "./telegramNotifier.js";
import dotenv from 'dotenv';

dotenv.config();

// -------------------- Constants --------------------
const SOL_CA = "So11111111111111111111111111111111111111112";
const WSOL_MINT = SOL_CA;
const PUMPFUN_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
if (!WEBSOCKET_URL) {
  throw new Error("Missing WEBSOCKET_URL in environment variables");
}
const AMOUNT_TO_BUY = 0.006834 * 1_000_000_000;
const RETRY_DELAY = 500;

let activeMonitors = 0;
let isProcessing = false;
const seenSignatures = new Set();
const tokensBeingBought = new Set();

// -------------------- WebSocket Subscription --------------------
async function subscribeToLogs() {
  const ws = new WebSocket(WEBSOCKET_URL);

  ws.on("open", () => {
    console.log("🟢 Connected to WebSocket");
    const subscribeMsg = {
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [{ mentions: [PUMPFUN_PROGRAM_ID] }, { commitment: "processed" }],
    };
    ws.send(JSON.stringify(subscribeMsg));
  });

  ws.on("message", async (data) => {
    if (isProcessing) return;

    const logData = JSON.parse(data);
    const value = logData?.params?.result?.value;
    const { err, logs = [], signature } = value || {};

    const hasMigrate = logs.some((log) => log.includes("Program log: Instruction: Migrate"));
    const hasBuyInstruction = logs.some((log) => log.includes("Program log: Instruction: buy"));

    if (!err && signature && hasMigrate && !hasBuyInstruction && !seenSignatures.has(signature)) {
      seenSignatures.add(signature);
      console.log(`\n📥 New signature: ${signature}`);
      isProcessing = true;

      try {
        const result = await getAmmAddressFromTransactionWithRetry(signature);
        if (!result) {
          console.log("❌ Failed to fetch AMM details.");
          return;
        }

        const { freezeAuthority, token0 } = result;

        if (tokensBeingBought.has(token0)) {
          console.log(`⚠️ Skipped: Token ${token0} already in process.`);
          return;
        }

        tokensBeingBought.add(token0);
        console.log(`✅ Processing token: ${token0}`);

        if (!freezeAuthority) {
          console.log("✅ Token is not freezable.");
          const success = await tryBuyWithRetry(token0);
          if (success) {
            console.log("✅ Buy successful");
            const liquidity = await fetchLiquidityData(token0);
            const { name, symbol } = await getTokenNameandSymbol(token0);
            await notifyBuy(symbol, name, token0, AMOUNT_TO_BUY, liquidity);
            handleAddress(token0);
          } else {
            console.warn(`⚠️ Buy failed for ${token0}`);
            await notifyBuyFailed(token0);
          }
        } else {
          console.log("⚠️ Token has freeze authority.");
        }
      } catch (err) {
        console.error("❌ Error processing transaction:", err);
      } finally {
        tokensBeingBought.delete(result?.token0);
        isProcessing = false;
        console.log(`✅ Finished processing: ${result?.token0}`);
      }
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket closed. Reconnecting in 5s...");
    setTimeout(subscribeToLogs, 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
    ws.terminate();
  });
}

// -------------------- Transaction Helpers --------------------
async function getAmmAddressFromTransaction(signature) {
  const url = "https://solana-mainnet.g.alchemy.com/v2/Y3y-StpTsIJmQTBr2hqpnhxXtmUHq5MS";
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
  };

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const tx = (await res.json()).result;
    const instructions = tx?.transaction?.message?.instructions || [];
    const logs = tx.meta.logMessages || [];

    const migrateInstruction = logs.some((log) => log.includes("Program log: Instruction: Migrate"));
    for (const ix of instructions) {
      const accounts = ix.accounts || [];
      if (accounts.length > 5) {
        let [ammAddress, , token0, , token1, lpMint] = migrateInstruction
          ? [accounts[0], null, accounts[2], null, accounts[4], accounts[5]]
          : [accounts[0], null, accounts[3], null, accounts[4], accounts[5]];

        if (token0 === WSOL_MINT) [token0, token1] = [token1, token0];

        console.log(`✅ AMM: ${ammAddress}, Base Token: ${token0}, Quote: ${token1}, LP Mint: ${lpMint}`);
        const { freezeAuthority, isSPL } = await getTokenMintInfo(token0);
        return { ammAddress, freezeAuthority, token0, token1, isSPL, lpMint };
      }
    }
  } catch (error) {
    console.error("❌ Error fetching transaction:", error);
  }
  return null;
}

async function getAmmAddressFromTransactionWithRetry(signature, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const result = await getAmmAddressFromTransaction(signature);
    if (result) return result;
    console.log(`🔁 Retry ${i + 1}`);
    await new Promise((res) => setTimeout(res, RETRY_DELAY));
  }
  console.log("❌ Failed after all retries.");
  return null;
}

async function getTokenMintInfo(tokenMintAddress) {
  const url = "https://purple-sly-borough.solana-mainnet.quiknode.pro/5f878450b93303141515647821cdd95eaea6660c";
  const payload = { jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [tokenMintAddress, { encoding: "jsonParsed" }] };

  try {
    const response = await axios.post(url, payload, { headers: { "Content-Type": "application/json" } });
    const info = response.data.result?.value?.data?.parsed?.info;
    const program = response.data.result?.value?.owner;
    const isSPL = program === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    return { freezeAuthority: info?.freezeAuthority || null, isSPL };
  } catch (error) {
    console.error(`❌ Error checking token info for ${tokenMintAddress}: ${error}`);
    return { freezeAuthority: null, isSPL: false };
  }
}

// -------------------- Buy & Monitoring --------------------
export async function tryBuyWithRetry(address, retries = 5, backoff = true) {
  let delayMs = 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const result = await Buy(address);
    if (result) {
      console.log(`✅ Buy successful on attempt ${attempt}`);
      return true;
    }
    console.error(`❌ Buy attempt ${attempt} failed`);
    if (attempt < retries) {
      console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
      await new Promise((res) => setTimeout(res, delayMs));
      if (backoff) delayMs *= 2;
    }
  }
  console.error("❌ All buy attempts failed.");
  return false;
}

async function handleAddress(address) {
  activeMonitors++;
  const entryPrice = await getTokenPrice(address);
  try {
    console.log("🔍 Monitoring:", address);
    await Monitor(address, entryPrice);
  } catch (e) {
    console.error("❌ Error monitoring:", address, e.message);
  }
  activeMonitors--;
}

async function getTokenPrice(BASE, maxRetries = 50, delayMs = 1000) {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${BASE}&outputMint=${SOL_CA}&amount=1000000&slippage=1`;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      const price = data.outAmount / 1e6;
      if (!isNaN(price)) return price;
      console.warn(`⚠️ Attempt ${attempt}: NaN price`);
    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed:`, err.message);
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error(`Failed to get price after ${maxRetries} attempts`);
}

export async function fetchLiquidityData(tokenAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const liquidity = data.pairs[0].liquidity.usd;
      return formatLiquidity(liquidity);
    } else {
      console.error("Error fetching liquidity:", response.status);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

async function getTokenNameandSymbol(address) {
  const mintAddress = new PublicKey(address);
  const metaplex = Metaplex.make(connection);
  try {
    const nft = await metaplex.nfts().findByMint({ mintAddress });
    return { name: nft.name || "Unknown Token", symbol: nft.symbol || "" };
  } catch (error) {
    console.error(`Error loading metadata for ${mintAddress}:`, error);
  }
}

// -------------------- Start --------------------
subscribeToLogs();
