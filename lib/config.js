import fs from "fs";
import { Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Raydium, parseTokenAccountResp, TxVersion } from "@raydium-io/raydium-sdk-v2";

// Load wallet
let owner;

if (fs.existsSync("./wallet.json")) {
  const secretKey = JSON.parse(fs.readFileSync("./wallet.json", "utf8"));
  owner = Keypair.fromSecretKey(Uint8Array.from(secretKey));
} else {
  throw new Error("wallet.json not found. Please create or provide one.");
}

export { owner };

// Setup connection and cluster
export const connection = new Connection(
  "https://mainnet.helius-rpc.com/?api-key=ae59724e-0820-4545-884e-73cd9036854a",
  "confirmed"
);
export const txVersion = TxVersion.V0; // TxVersion.V0 or TxVersion.LEGACY
export const cluster = "mainnet"; // 'mainnet' | 'devnet'

let raydium;

export const initSdk = async (params = {}) => {
  if (raydium) return raydium;

  if (connection.rpcEndpoint === clusterApiUrl("mainnet-beta")) {
    console.warn(
      "Using a free RPC node may cause unexpected errors. Strongly consider using a paid RPC node."
    );
  }

  console.log(`Connected to RPC ${connection.rpcEndpoint} in ${cluster}`);

  raydium = await Raydium.load({
    owner,
    connection,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: !params.loadToken,
    blockhashCommitment: "finalized",
  });

  // Handle token account updates manually
  raydium.account.updateTokenAccount(await fetchTokenAccountData());
  connection.onAccountChange(owner.publicKey, async () => {
    raydium.account.updateTokenAccount(await fetchTokenAccountData());
  });

  return raydium;
};

export const fetchTokenAccountData = async () => {
  const solAccountResp = await connection.getAccountInfo(owner.publicKey);
  const tokenAccountResp = await connection.getTokenAccountsByOwner(
    owner.publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );
  const token2022Req = await connection.getTokenAccountsByOwner(
    owner.publicKey,
    { programId: TOKEN_2022_PROGRAM_ID }
  );

  return parseTokenAccountResp({
    owner: owner.publicKey,
    solAccountResp,
    tokenAccountResp: {
      context: tokenAccountResp.context,
      value: [...tokenAccountResp.value, ...token2022Req.value],
    },
  });
};
