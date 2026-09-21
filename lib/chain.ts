// The one place the network is chosen.
//
// Everything below derives from genlayer-js's own chain objects so nothing can
// drift out of sync, with one deliberate exception documented at EXPLORER.
//
// Set NEXT_PUBLIC_GENLAYER_NETWORK=studionet | bradbury.
// Contract addresses are per network: switching this without redeploying and
// updating NEXT_PUBLIC_FIELDWORK_CONTRACT points the app at an address that
// does not exist.

import { studionet, testnetBradbury } from "genlayer-js/chains";

export type NetworkName = "studionet" | "bradbury";

export const NETWORK: NetworkName =
  (process.env.NEXT_PUBLIC_GENLAYER_NETWORK as NetworkName) || "studionet";

export const IS_STUDIO = NETWORK === "studionet";

export const chain = IS_STUDIO ? studionet : testnetBradbury;

export const CHAIN_ID: number = chain.id;
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
export const CHAIN_NAME: string = chain.name;

/** What the footer says. The SDK's own `chain.name` is "Genlayer Studio
 *  Network", which is long and spells the brand with a lowercase L; the design
 *  writes it as GenLayer Studio, so display copy uses this and anything
 *  technical keeps CHAIN_NAME. */
export const CHAIN_LABEL = IS_STUDIO ? "GenLayer Studio" : "GenLayer Bradbury";
export const RPC_URL: string = chain.rpcUrls.default.http[0];
export const NATIVE_CURRENCY = chain.nativeCurrency;

/**
 * Studio's explorer is the one place we do NOT take the SDK's word.
 *
 * genlayer-js carries `https://genlayer-explorer.vercel.app` for studionet and
 * that host answers 503 on every request. The working Studio explorer is
 * explorer-studio.genlayer.com. Bradbury's SDK value is correct, so it is used
 * as given.
 */
export const EXPLORER: string = IS_STUDIO
  ? "https://explorer-studio.genlayer.com"
  : chain.blockExplorers?.default.url.replace(/\/$/, "") ||
    "https://explorer-bradbury.genlayer.com";

/**
 * Studio is gasless for wallet flows - its RPC reports eth_gasPrice 0x0, and a
 * normal wallet address reads 0 GEN there forever. Any "you have no GEN" guard
 * must be conditional on this, or it refuses every transaction on Studio before
 * one is ever attempted.
 */
export const REQUIRES_GAS = !IS_STUDIO;

/**
 * Studio's faucet is not a URL. It is the water drop button in the account
 * selector inside studio.genlayer.com, and it funds Studio's own accounts
 * rather than an external wallet. Because the flow is gasless, end users never
 * need it, so the UI shows no faucet link on Studio.
 */
export const FAUCET_URL: string | null = IS_STUDIO
  ? null
  : "https://testnet-faucet.genlayer.foundation/";

export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER}/address/${address}`;
}

/** Shape MetaMask wants for wallet_addEthereumChain. */
export const walletChainParams = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN_NAME,
  rpcUrls: [RPC_URL],
  nativeCurrency: NATIVE_CURRENCY,
  blockExplorerUrls: [EXPLORER],
};
