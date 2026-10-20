/**
 * Inbox backfill from Zernio.
 *
 * The local `conversations` table is otherwise populated only by inbound
 * webhooks, so conversations that predate webhook registration never appear
 * in the Inbox (#12). This module pages through Zernio's inbox conversations
 * per channel and imports the ones missing locally.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingProvider, ProviderConversation } from "./messaging";
import { messagePreview } from "@/lib/message-preview";
import { cacheContactAvatar, shouldCacheAvatar } from "@/lib/contact-avatar";

/**
 * What a platform tells us about the person behind a conversation, beyond
 * their name. Instagram is the only one that sends any of it today.
 */
export interface PlatformProfile {
  followerCount?: number | null;
  isVerified?: boolean | null;
  isFollower?: boolean | null;
  isFollowing?: boolean | null;
  fetchedAt?: string | null;
}

/** Drops the keys the platform left empty, so a null cannot erase a known value. */
function presentFields(profile: PlatformProfile): Record<string, unknown> | null {
  const kept = Object.entries(profile).filter(([, v]) => v !== null && v !== undefined);
  return kept.length > 0 ? Object.fromEntries(kept) : null;
}

/**
 * Merges what a platform said about the person into the contact's metadata,
 * under that platform's own key. Returns the existing metadata untouched when
 * the platform sent nothing, so a sync that answers with empty fields cannot
 * wipe a follower count captured on a previous one.
 */
function profileMetadata(
  platform: string | null | undefined,
  profile: PlatformProfile | null | undefined,
  current: Record<string, unknown>
): Record<string, unknown> {
  if (!platform || !profile) return current;
  const fields = presentFields(profile);
  if (!fields) return current;

  const previous = (current[platform] as Record<string, unknown> | undefined) ?? {};
  return { ...current, [platform]: { ...previous, ...fields } };
}

/**
 * Fills in what a known contact is missing.
 *
 * The picture, the @ and the real name only ever landed on the row that
 * created the contact, so a contact first seen before the platform sent any
 * of it stayed blank for good. This is deliberately conservative: it fills
 * gaps and never overwrites something already there, because a display name
 * can have been edited by hand and the platform does not know that.
 */
async function refreshKnownContact({
  supabase,
  contactId,
  channelId,
  platform,
  senderId,
  senderName,
  senderPicture,
  senderUsername,
  senderProfile,
  storedUsername,
}: {
  supabase: SupabaseClient;
  contactId: string;
  channelId: string;
  platform?: string | null;
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  senderUsername?: string | null;
  senderProfile?: PlatformProfile | null;
  storedUsername?: string | null;
}): Promise<void> {
  if (!storedUsername && senderUsername) {
    await supabase
      .from("contact_channels")
      .update({ platform_username: senderUsername })
      .eq("channel_id", channelId)
      .eq("platform_sender_id", senderId);
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("display_name, avatar_url, metadata")
    .eq("id", contactId)
    .single();
  if (!contact) return;

  const patch: Record<string, unknown> = {};

  // The sender id doubles as the display name when the platform sent none,
  // which is the one name worth replacing: it is a number, not a person.
  if (contact.display_name === senderId && senderName && senderName !== senderId) {
    patch.display_name = senderName;
  }

  if (shouldCacheAvatar(senderPicture, contact.avatar_url)) {
    const cached = await cacheContactAvatar(supabase, contactId, senderPicture!);
    if (cached) patch.avatar_url = cached;
    else if (!contact.avatar_url) patch.avatar_url = senderPicture;
  }

  const current = (contact.metadata as Record<string, unknown> | null) ?? {};
  const merged = profileMetadata(platform, senderProfile, current);
  if (merged !== current) patch.metadata = merged;

  if (Object.keys(patch).length > 0) {
    await supabase.from("contacts").update(patch).eq("id", contactId);
  }
}

/** Cap per channel: 4 pages x 50 conversations. */
const MAX_PAGES_PER_CHANNEL = 4;
const PAGE_SIZE = 50;

export interface BackfillChannel {
  id: string;
  late_account_id: string;
  platform: string;
}

/** Conversation item shape the messaging provider hands back. */
type ZernioInboxConversation = ProviderConversation;

/**
 * Finds or creates the contact behind a platform sender: reuses the mapping in
 * `contact_channels` (channel_id, platform_sender_id); otherwise inserts the
 * contact, its channel mapping, and a `contact_created` analytics event.
 * Returns null when the contact insert fails; `existed` tells whether the
 * sender was already known on this channel.
 * With `stampExisting: false` an existing contact's last_interaction_at is
 * left untouched; the caller stamps it once the interaction is confirmed.
 */
export async function upsertContactForSender({
  supabase,
  channel,
  senderId,
  senderName,
  senderPicture,
  senderUsername,
  senderProfile,
  interactionAt,
  stampExisting = true,
}: {
  supabase: SupabaseClient;
  channel: { id: string; workspace_id: string; platform?: string | null };
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  senderUsername?: string | null;
  senderProfile?: PlatformProfile | null;
  interactionAt: string;
  stampExisting?: boolean;
}): Promise<{ contactId: string; existed: boolean } | null> {
  const { data: existingContactChannel } = await supabase
    .from("contact_channels")
    .select("contact_id, platform_username")
    .eq("channel_id", channel.id)
    .eq("platform_sender_id", senderId)
    .single();

  if (existingContactChannel) {
    const contactId = existingContactChannel.contact_id;

    await refreshKnownContact({
      supabase,
      contactId,
      channelId: channel.id,
      platform: channel.platform,
      senderId,
      senderName,
      senderPicture,
      senderUsername,
      senderProfile,
      storedUsername: existingContactChannel.platform_username,
    });

    if (stampExisting) {
      await supabase
        .from("contacts")
        .update({ last_interaction_at: interactionAt })
        .eq("id", contactId);
    }
    return { contactId, existed: true };
  }

  const { data: newContact } = await supabase
    .from("contacts")
    .insert({
      workspace_id: channel.workspace_id,
      display_name: senderName,
      // The platform's own link, replaced below by our copy of it. Keeping it
      // here means the picture renders straight away even if the copy fails.
      avatar_url: senderPicture,
      metadata: profileMetadata(channel.platform, senderProfile, {}),
      last_interaction_at: interactionAt,
    })
    .select("id")
    .single();

  if (!newContact) return null;

  if (shouldCacheAvatar(senderPicture, null)) {
    const cached = await cacheContactAvatar(supabase, newContact.id, senderPicture!);
    if (cached) {
      await supabase
        .from("contacts")
        .update({ avatar_url: cached })
        .eq("id", newContact.id);
    }
  }

  await supabase.from("contact_channels").insert({
    contact_id: newContact.id,
    channel_id: channel.id,
    platform_sender_id: senderId,
    platform_username: senderUsername ?? null,
  });

  await supabase.from("analytics_events").insert({
    workspace_id: channel.workspace_id,
    contact_id: newContact.id,
    event_type: "contact_created",
  });

  return { contactId: newContact.id, existed: false };
}

/**
 * Imports Zernio inbox conversations missing from the local `conversations`
 * table. Insert-only: conversations already known (by late_conversation_id)
 * are skipped, and a contact whose (channel_id, contact_id) row already exists
 * under a different late_conversation_id is left to the webhook, so the
 * webhook-maintained late_conversation_id / status / last_message_at /
 * unread_count are never clobbered. A failing channel is logged and skipped,
 * not fatal.
 */
export async function backfillInboxConversations({
  supabase,
  messaging,
  workspaceId,
  channels,
}: {
  supabase: SupabaseClient;
  messaging: MessagingProvider;
  workspaceId: string;
  channels: BackfillChannel[];
}): Promise<{ imported: number }> {
  let imported = 0;

  for (const channel of channels) {
    try {
      imported += await backfillChannel({ supabase, messaging, workspaceId, channel });
    } catch (err) {
      console.error(
        `[inbox-sync] backfill failed for channel ${channel.id} (${channel.platform}):`,
        err
      );
    }
  }

  return { imported };
}

async function backfillChannel({
  supabase,
  messaging,
  workspaceId,
  channel,
}: {
  supabase: SupabaseClient;
  messaging: MessagingProvider;
  workspaceId: string;
  channel: BackfillChannel;
}): Promise<number> {
  const { data: existingRows } = await supabase
    .from("conversations")
    .select("late_conversation_id")
    .eq("channel_id", channel.id);

  const known = new Set(
    (existingRows ?? [])
      .map((r: { late_conversation_id: string | null }) => r.late_conversation_id)
      .filter(Boolean)
  );

  let imported = 0;
  let cursor: string | undefined;
  const seenParticipants = new Set<string>();

  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page++) {
    const { conversations, nextCursor } = await messaging.listConversations({
      accountId: channel.late_account_id,
      limit: PAGE_SIZE,
      cursor,
    });

    for (const conv of conversations) {
      if (!conv.id || !conv.participantId) continue;
      // A participant can have several provider conversations but the local
      // table is unique on (channel_id, contact_id). The provider lists newest
      // first, so the first conversation seen per participant is the most
      // recent one; later ones are dropped so they cannot overwrite it.
      if (seenParticipants.has(conv.participantId)) continue;
      seenParticipants.add(conv.participantId);

      if (known.has(conv.id)) {
        // The conversation is already here, but the contact behind it can
        // still be missing the picture, the @ or the profile facts, because
        // those were only ever written on the row that created it. Skipping
        // outright is what left every existing contact blank for good.
        await contactForConversation({ supabase, workspaceId, channel, conv });
        continue;
      }

      if (await importConversation({ supabase, workspaceId, channel, conv })) {
        imported++;
      }
    }

    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return imported;
}

/**
 * The contact behind a provider conversation, created if new and topped up
 * with whatever the platform sent if already known. `last_interaction_at` is
 * left alone: listing a conversation is not an interaction.
 */
async function contactForConversation({
  supabase,
  workspaceId,
  channel,
  conv,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  channel: BackfillChannel;
  conv: ZernioInboxConversation;
}) {
  return upsertContactForSender({
    supabase,
    channel: {
      id: channel.id,
      workspace_id: workspaceId,
      platform: channel.platform,
    },
    senderId: conv.participantId!,
    senderName: conv.participantName || conv.participantId!,
    senderPicture: conv.participantPicture || null,
    senderUsername: conv.participantUsername || null,
    senderProfile: conv.instagramProfile ?? null,
    interactionAt: conv.updatedTime ?? new Date().toISOString(),
    stampExisting: false,
  });
}

async function importConversation({
  supabase,
  workspaceId,
  channel,
  conv,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  channel: BackfillChannel;
  conv: ZernioInboxConversation;
}): Promise<boolean> {
  const interactionAt = conv.updatedTime ?? new Date().toISOString();
  const contact = await upsertContactForSender({
    supabase,
    channel: {
      id: channel.id,
      workspace_id: workspaceId,
      platform: channel.platform,
    },
    senderId: conv.participantId!,
    senderName: conv.participantName || conv.participantId!,
    senderPicture: conv.participantPicture || null,
    senderUsername: conv.participantUsername || null,
    senderProfile: conv.instagramProfile ?? null,
    interactionAt,
    stampExisting: false,
  });

  if (!contact) {
    console.error(`[inbox-sync] failed to create contact for conversation ${conv.id}`);
    return false;
  }

  // ignoreDuplicates: an existing (channel_id, contact_id) row is owned by the
  // webhook (possibly under a different late_conversation_id) and must stay
  // untouched; the conflict then returns no rows, so it is not counted as
  // imported either.
  const { data: insertedRows, error } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: workspaceId,
        channel_id: channel.id,
        contact_id: contact.contactId,
        platform: channel.platform,
        late_conversation_id: conv.id,
        status: conv.status === "archived" ? "closed" : "open",
        last_message_at: conv.updatedTime ?? null,
        last_message_preview: messagePreview(conv.lastMessage),
        unread_count: conv.unreadCount ?? 0,
      },
      { onConflict: "channel_id,contact_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    console.error(`[inbox-sync] failed to upsert conversation ${conv.id}:`, error);
    return false;
  }

  const inserted = (insertedRows ?? []).length > 0;

  // Stamp the existing contact only after the conversation row was actually
  // inserted; a webhook-owned duplicate is not a new interaction.
  if (inserted && contact.existed) {
    await supabase
      .from("contacts")
      .update({ last_interaction_at: interactionAt })
      .eq("id", contact.contactId);
  }

  return inserted;
}
