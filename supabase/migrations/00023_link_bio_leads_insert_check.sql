-- Make the link-in-bio insert policy check the shape of a lead.
--
-- 00022 let a visitor insert any row (with check (true)), which the Security
-- Advisor flags as an unrestricted policy. The rule stays the same, insert
-- only and anon only, but a row must now look like what the quiz page at
-- thiagoborrelli.com/links-bio/ actually sends: contact details present and
-- plausible, every answer filled in, the recommendation in the shape the page
-- builds, and nothing longer than the page itself would ever send.
--
-- Every limit here is equal to or looser than the page's own validation, on
-- purpose. The page only logs a failed insert to the browser console, so a
-- rule stricter than the form would lose real leads without anyone noticing.
-- That is why the name allows one character where the page asks for two (the
-- page counts an emoji as two, Postgres as one), the email pattern only asks
-- for something@something.something, and the free-text fields the page does
-- not limit (nome, email, whatsapp, user_agent) have no upper bound here.
-- Checked before this was written: 20,000 submissions built by the page's own
-- code, none turned away.
--
-- What this is not: spam protection. The page's code and its publishable key
-- are public, so anyone can send rows that pass. It keeps malformed and
-- oversized rows out; stopping automated submissions would need a server-side
-- step (a CAPTCHA and rate limiting) in front of the table.
--
-- The array check is a CASE because Postgres does not promise to evaluate the
-- parts of an AND in order, and jsonb_array_length raises an error on anything
-- that is not an array. Grants, the table and every other policy are unchanged.
alter policy "Link bio visitors can submit a lead"
  on public.link_bio_leads
  with check (
    -- Fields the form always sends filled in
    num_nulls(nome, email, whatsapp, p1, p2, p3, p4, p5, servico_recomendado,
              servicos_alternativos, scores, aceita_contato, consentimento_em,
              consentimento_texto, landing_url) = 0
    -- Contact: the page's own rules, or looser
    and char_length(nome) >= 1
    and email ~ '^[^@]+@[^@]+\.[^@]+$'
    and char_length(regexp_replace(whatsapp, '[^0123456789]', '', 'g')) between 8 and 15
    -- Answers and result: short, fixed values
    and char_length(p1) <= 64 and char_length(p2) <= 64 and char_length(p3) <= 64
    and char_length(p4) <= 64 and char_length(p5) <= 64
    and char_length(servico_recomendado) <= 64
    and case when jsonb_typeof(servicos_alternativos) = 'array'
             then jsonb_array_length(servicos_alternativos) <= 5
             else false end
    and jsonb_typeof(scores) = 'object'
    and octet_length(scores::text) <= 2000
    -- Consent (the page's fixed wording)
    and char_length(consentimento_texto) <= 1000
    -- Tracking: the page already cuts these to these lengths
    and coalesce(char_length(utm_source), 0)   <= 200
    and coalesce(char_length(utm_medium), 0)   <= 200
    and coalesce(char_length(utm_campaign), 0) <= 200
    and coalesce(char_length(utm_content), 0)  <= 200
    and coalesce(char_length(utm_term), 0)     <= 200
    and coalesce(char_length(referrer), 0)     <= 500
    and char_length(landing_url) <= 500
  );
