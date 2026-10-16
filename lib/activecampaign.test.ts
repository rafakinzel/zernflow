import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActiveCampaignError,
  addContactToList,
  addTagToContact,
  listFields,
  listLists,
  listTags,
  normalizeBaseUrl,
  syncContact,
} from "./activecampaign";

const credentials = {
  baseUrl: "https://acme.api-us1.com",
  apiKey: "token-123",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs fetch with one canned response and returns the spy. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("normalizeBaseUrl", () => {
  it("accepts the bare account name", () => {
    expect(normalizeBaseUrl("acme")).toBe("https://acme.api-us1.com");
  });

  it("accepts the host without a scheme", () => {
    expect(normalizeBaseUrl("acme.api-us1.com")).toBe(
      "https://acme.api-us1.com"
    );
  });

  it("strips a trailing slash and a pasted /api/3", () => {
    expect(normalizeBaseUrl("https://acme.api-us1.com/api/3")).toBe(
      "https://acme.api-us1.com"
    );
    expect(normalizeBaseUrl("https://acme.api-us1.com/")).toBe(
      "https://acme.api-us1.com"
    );
  });

  it("returns empty for empty input", () => {
    expect(normalizeBaseUrl("   ")).toBe("");
  });
});

describe("syncContact", () => {
  it("posts to contact/sync with the Api-Token header and returns the id", async () => {
    const fetchMock = stubFetch({ contact: { id: "42" } });

    const id = await syncContact(credentials, {
      email: "rafa@example.com",
      firstName: "Rafa",
      fieldValues: [{ field: "3", value: "instagram" }],
    });

    expect(id).toBe("42");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.api-us1.com/api/3/contact/sync");
    expect(init.method).toBe("POST");
    expect(init.headers["Api-Token"]).toBe("token-123");
    expect(JSON.parse(init.body)).toEqual({
      contact: {
        email: "rafa@example.com",
        firstName: "Rafa",
        fieldValues: [{ field: "3", value: "instagram" }],
      },
    });
  });

  it("omits empty optional fields rather than blanking them", async () => {
    const fetchMock = stubFetch({ contact: { id: "1" } });

    await syncContact(credentials, { email: "a@b.com" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      contact: { email: "a@b.com" },
    });
  });

  it("throws when the vendor answers without an id", async () => {
    stubFetch({ contact: {} });
    await expect(syncContact(credentials, { email: "a@b.com" })).rejects.toThrow(
      ActiveCampaignError
    );
  });

  it("names a rejected key on 403 instead of echoing the status", async () => {
    stubFetch({ message: "nope" }, { ok: false, status: 403 });
    await expect(
      syncContact(credentials, { email: "a@b.com" })
    ).rejects.toThrow(/rejected the API key/);
  });
});

describe("addContactToList", () => {
  it("sends numeric ids and status 1 by default", async () => {
    const fetchMock = stubFetch({});

    await addContactToList(credentials, { contactId: "42", listId: "7" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://acme.api-us1.com/api/3/contactLists"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      contactList: { list: 7, contact: 42, status: 1 },
    });
  });
});

describe("listing", () => {
  it("maps lists to id and name", async () => {
    stubFetch({ lists: [{ id: "7", name: "Lançamento" }, { name: "sem id" }] });
    await expect(listLists(credentials)).resolves.toEqual([
      { id: "7", name: "Lançamento" },
    ]);
  });

  it("maps fields to id, title and type", async () => {
    stubFetch({ fields: [{ id: "3", title: "utm_source", type: "text" }] });
    await expect(listFields(credentials)).resolves.toEqual([
      { id: "3", title: "utm_source", type: "text" },
    ]);
  });

  it("keeps contact tags and drops template tags", async () => {
    stubFetch({
      tags: [
        { id: "20", tag: "lead-bot", tagType: "contact" },
        { id: "21", tag: "modelo", tagType: "template" },
        { id: "22", tag: "sem tipo" },
      ],
    });
    await expect(listTags(credentials)).resolves.toEqual([
      { id: "20", name: "lead-bot" },
      { id: "22", name: "sem tipo" },
    ]);
  });

  it("pages through tags until a short page comes back", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      id: String(i + 1),
      tag: `tag-${i + 1}`,
      tagType: "contact",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tags: full }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tags: [{ id: "101", tag: "ultima" }] }),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    const tags = await listTags(credentials);

    expect(tags).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=100");
  });
});

describe("addTagToContact", () => {
  it("posts the tag id, which is what the API requires", async () => {
    const fetchMock = stubFetch({});

    await addTagToContact(credentials, { contactId: "42", tagId: "20" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://acme.api-us1.com/api/3/contactTags"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      contactTag: { contact: "42", tag: "20" },
    });
  });
});
