/**
 * Entry point for the messaging layer.
 *
 * Callers ask for a provider and get whichever transport the workspace is on.
 * Today that is always Zernio; when the Meta transport lands, the choice is
 * made here from the channel's `provider` column, and nothing upstream of this
 * file has to know which one answered.
 */

export type {
  MessagingProvider,
  OutboundMessage,
  ProviderConversation,
  ProviderMessage,
  ProviderPost,
  SendMessageResult,
} from "./provider";

import type { MessagingProvider } from "./provider";
import { createZernioProvider } from "./zernio-provider";
import { decryptSecret } from "@/lib/secrets";

export { ZernioProvider, createZernioProvider } from "./zernio-provider";

/**
 * Builds the messaging provider for a workspace's stored credential.
 *
 * Decryption happens here rather than at each call site: every caller reads
 * the same column, so one place to decrypt is one place to get it wrong.
 * A credential stored before encryption existed passes through untouched.
 *
 * @param storedApiKey the value straight out of the workspaces row
 */
export function createMessagingProvider(storedApiKey: string): MessagingProvider {
  return createZernioProvider(decryptSecret(storedApiKey));
}
