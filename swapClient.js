import fetch from "node-fetch";
import { createJupiterApiClient } from "@jup-ag/api";
import {PublicKey, VersionedTransaction } from "@solana/web3.js";
import { connection, owner as wallet } from "./lib/config.js";


globalThis.fetch = fetch;

const jupiterQuoteApi = createJupiterApiClient();

// Constants
const SOL_MINT = "So11111111111111111111111111111111111111112"; 
const AMOUNT_TO_BUY = 0.0119 * 1_000_000_000; // amount in lamports
const tokensBeingBought = new Set();


// Get token balance for the wallet
async function getTokenBalance(wallet, tokenMintAddress) {
  const accountInfo = await connection.getParsedTokenAccountsByOwner(
    wallet.publicKey,
    { mint: new PublicKey(tokenMintAddress) }
  );

  return accountInfo.value.reduce(
    (acc, token) => acc + BigInt(token.account.data.parsed.info.tokenAmount.amount),
    0n
  );
}

// Buy a token using Jupiter API
export async function Buy(baseMint) {
  if (tokensBeingBought.has(baseMint)) {
    console.log(`⚠️ ${baseMint} is already being bought, skipping.`);
    return false;
  }

  tokensBeingBought.add(baseMint);

  try {
    const quote = await jupiterQuoteApi.quoteGet({
      inputMint: SOL_MINT,
      outputMint: baseMint,
      amount: AMOUNT_TO_BUY,
      slippageBps: 500,
    });

    if (!quote?.outAmount) {
      console.error("❌ No route found.");
      return false;
    }

    const response = await jupiterQuoteApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 10_000_000,
            priorityLevel: "veryHigh",
          },
        },
      },
    });

    if (!response.swapTransaction) {
      console.error("❌ Failed to generate swap transaction.");
      return false;
    }

    const txBuffer = Buffer.from(response.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([wallet]);

    const txid = await connection.sendTransaction(tx);
    console.log("✅ Swap sent:", txid);

    const confirmation = await connection.confirmTransaction(txid, "confirmed");
    if (confirmation.value.err) {
      console.error("❌ Transaction failed:", confirmation.value.err);
      return false;
    }

    console.log("✅ Transaction confirmed successfully.");
    return true;
  } catch (err) {
    console.error("❌ Swap failed:", err.message);
    return false;
  } finally {
    tokensBeingBought.delete(baseMint);
  }
}

// Sell a token using Jupiter API
export async function Sell(baseMint) {
  const amount = await getTokenBalance(wallet, baseMint);

  console.log(`Selling ${amount} lamports worth of ${baseMint}`);

  try {
    const quote = await jupiterQuoteApi.quoteGet({
      inputMint: baseMint,
      outputMint: SOL_MINT,
      amount: amount.toString(),
      slippageBps: 500,
    });

    if (!quote?.outAmount) {
      console.error("❌ No route found.");
      return false;
    }

    const response = await jupiterQuoteApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 10_000_000,
            priorityLevel: "veryHigh",
          },
        },
      },
    });

    if (!response.swapTransaction) {
      console.error("❌ Failed to generate swap transaction.");
      return false;
    }

    const txBuffer = Buffer.from(response.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([wallet]);

    const txid = await connection.sendTransaction(tx);
    console.log("✅ Swap sent:", txid);

    const confirmation = await connection.confirmTransaction(txid, "confirmed");
    if (confirmation.value.err) {
      console.error("❌ Transaction failed:", confirmation.value.err);
      return false;
    }

    const parsed = await connection.getParsedTransaction(txid, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    });

    const logError = parsed?.meta?.logMessages?.find(log =>
      log.includes("custom program error")
    );

    if (parsed?.meta?.err || logError) {
      console.error("❌ Detected error in inner transaction:", parsed?.meta?.err || logError);
      return false;
    }

    console.log("✅ Transaction confirmed successfully.");
    return true;
  } catch (err) {
    console.error("❌ Swap failed:", err.message);
    return false;
  }
}
