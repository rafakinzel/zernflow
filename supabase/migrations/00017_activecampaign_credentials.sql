-- ActiveCampaign is configured once per workspace instead of being pasted into
-- every HTTP Request node, so the credential lives here and the flow nodes
-- only reference it.
alter table workspaces
  add column if not exists activecampaign_url text,
  add column if not exists activecampaign_api_key_encrypted text;

comment on column workspaces.activecampaign_url is 'ActiveCampaign account base URL, e.g. https://acme.api-us1.com';
comment on column workspaces.activecampaign_api_key_encrypted is 'ActiveCampaign Api-Token; encrypted when ENCRYPTION_KEY is set, plaintext otherwise (see lib/secrets.ts)';
