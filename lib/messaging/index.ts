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

export { ZernioProvider, createZernioProvider } from "./zernio-provider";

/**
 * Builds the messaging provider for a workspace API key.
 *
 * @param apiKey the workspace's stored vendor credential
 */
export function createMessagingProvider(apiKey: string): MessagingProvider {
  return createZernioProvider(apiKey);
}
