import fetch from "node-fetch";
import { Sell } from "./swapClient.js";
import { notifySell, notifySellFailed } from "./telegramNotifier.js";
import { fetchLiquidityData } from "./fetchLiqudity.js";
import { initSdk, owner as wallet, connection } from "./lib/config.js";
import { PublicKey } from "@solana/web3.js";
import { Metaplex } from "@metaplex-foundation/js";
import { getTokenPrice } from "./price.js";

const SOL_CA = "So11111111111111111111111111111111111111112";
const TTP_PERCENT = 20;        // Trailing take-profit %
const STOP_LOSS_PERCENT = 20;  // Stop-loss %

export const Monitor = async (tokenMint, entryPrice) => {
  let highestPrice = 0;
  let sold = false;

  const stopLossPrice = entryPrice * (1 - STOP_LOSS_PERCENT / 100);
  const { name, symbol } = await getTokenNameandSymbol(tokenMint);
  const amount = await getTokenBalance(wallet, tokenMint);
  const balance = amount.toString(); // BigInt → string

  const initial = await getTokenPrice(tokenMint);
  highestPrice = initial;

  console.log(
    `📊 [${symbol || tokenMint.slice(0, 5)}...] Started at $${initial.toFixed(4)} | 🛑 Stop Loss: $${stopLossPrice.toFixed(4)}\n`
  );

  return new Promise((resolve) => {
    const intervalId = setInterval(async () => {
      try {
        const currentPrice = await getTokenPrice(tokenMint);
        if (currentPrice > highestPrice) highestPrice = currentPrice;

        const dropPercent = ((highestPrice - currentPrice) / highestPrice) * 100;

        console.log(
          `💰 [${symbol || tokenMint.slice(0, 5)}...] Current: $${currentPrice.toFixed(4)} | 📈 High: $${highestPrice.toFixed(4)} | 📉 Drop: ${dropPercent.toFixed(2)}%`
        );

        // Trailing Take Profit
        if (!sold && dropPercent >= TTP_PERCENT) {
          console.log(`🚨 Trailing Take Profit Triggered!`);
          sold = true;
          clearInterval(intervalId);
          const liquidity = await fetchLiquidityData(tokenMint);
          const success = await trySellWithRetry(tokenMint);

          if (success) {
            await notifySell(symbol, name, tokenMint, balance, liquidity);
          } else {
            await notifySellFailed(symbol, name, tokenMint, balance, liquidity);
          }
          resolve();
        }

        // Stop Loss
        if (!sold && currentPrice <= stopLossPrice) {
          console.log(`❌ Stop Loss Triggered! Fell below $${stopLossPrice.toFixed(4)}`);
          sold = true;
          clearInterval(intervalId);
          const liquidity = await fetchLiquidityData(tokenMint);
          const success = await Sell(tokenMint);

          if (success) {
            await notifySell(symbol, name, tokenMint, balance, liquidity);
          } else {
            await notifySellFailed(symbol, name, tokenMint, balance, liquidity);
          }
          resolve();
        }
      } catch (err) {
        console.error("❌ Error fetching price:", err.message);
      }
    }, 1000); // Check every second
  });
};

// --- Helper functions ---

async function trySellWithRetry(token, initialDelay = 500, backoff = true) {
  let attempt = 1;
  let delayMs = initialDelay;

  while (attempt <= 20) {
    console.log(`🔁 Attempt ${attempt} to sell ${token}`);
    const success = await Sell(token);

    if (success) {
      console.log(`✅ Sell successful on attempt ${attempt}`);
      return true;
    }

    console.error(`❌ Sell attempt ${attempt} failed.`);
    if (attempt < 20) {
      console.log(`⏳ Retrying in ${delayMs / 1000}s... (attempt ${attempt})`);
      await new Promise((res) => setTimeout(res, delayMs));
      if (backoff) delayMs *= 2; // exponential backoff
      attempt++;
    } else {
      console.error("❌ All 20 sell attempts failed.");
      return false;
    }
  }
}

const getTokenBalance = async (wallet, tokenMintAddress) => {
  const accountInfo = await connection.getParsedTokenAccountsByOwner(
    wallet.publicKey,
    { mint: new PublicKey(tokenMintAddress) }
  );

  return accountInfo.value.reduce(
    (acc, token) =>
      acc + BigInt(token.account.data.parsed.info.tokenAmount.amount),
    0n
  );
};

async function getTokenNameandSymbol(address) {
  const mintAddress = new PublicKey(address);
  const metaplex = Metaplex.make(connection);

  try {
    const nft = await metaplex.nfts().findByMint({ mintAddress });
    return {
      name: nft.name || "Unknown Token",
      symbol: nft.symbol || "",
    };
  } catch (error) {
    console.error(`Error loading metadata for ${mintAddress}:`, error);
    return { name: "Unknown Token", symbol: "" };
  }
}

// Example call
// await Monitor("AXiegbZbyMTAJwrvnXGH3Scbp2sjnTx7Sj7t1jywSM7H", 0.00009869);
