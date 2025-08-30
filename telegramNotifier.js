import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ Telegram bot token or chat ID not set in environment variables.");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Telegram API error:', error);
    }
  } catch (err) {
    console.error('❌ Failed to send Telegram message:', err.message);
  }
}

export async function notifyBuy(tokenSymbol, name, tokenAdd, amount, liquidity) { 
  const amountInSOL = amount / 1e9;

  const text = 
`🟢 *New Token Bought!*

🪙 *Name:* ${name}
🔖 *Symbol:* ${tokenSymbol}
📦 *Amount:* ${amountInSOL.toFixed(4)} SOL
💰 *Entry Liquidity:* ${liquidity}
🔗 *View:* [DexScreener](https://dexscreener.com/solana/${tokenAdd}?maker=EB8DDsP4bqYynEmd9ZZbFqZwWRVgJKwY68C6pvrGpkgo)`;

  await sendTelegramMessage(text);
}

export async function notifyBuyFailed(tokenSymbol, name, tokenAdd, amount, liquidity) {
  const amountInSOL = amount / 1e9;

  const text = 
`🔴 *Token Buy Failed!*

🪙 *Name:* ${name}
🔖 *Symbol:* ${tokenSymbol}
📦 *Attempted Amount:* ${amountInSOL.toFixed(4)} SOL
💦 *Liquidity:* ${liquidity}
🔗 *View:* [DexScreener](https://dexscreener.com/solana/${tokenAdd})`;

  await sendTelegramMessage(text);
}

export async function notifySell(tokenSymbol, name, tokenAdd, income, liquidity) {
  const text = 
`🔴 *Token Sold!*

🪙 *Name:* ${name}
🔖 *Symbol:* ${tokenSymbol}
💰 *Balance:* ${income}
💦 *Liquidity:* ${liquidity}
🔗 *View:* [DexScreener](https://dexscreener.com/solana/${tokenAdd})`;

  await sendTelegramMessage(text);
}

export async function notifySellFailed(tokenSymbol, name, tokenAdd, income, liquidity) {
  const text = 
`🔴 *Failed to Sell Token!*

🪙 *Name:* ${name}
🔖 *Symbol:* ${tokenSymbol}
💰 *Balance:* ${income}
💦 *Liquidity:* ${liquidity}
🔗 *View:* [DexScreener](https://dexscreener.com/solana/${tokenAdd})`;

  await sendTelegramMessage(text);
}
