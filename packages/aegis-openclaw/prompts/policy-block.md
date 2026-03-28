# Demo prompt: Policy block (Track 1 guardrail)

Use this after the proxy and gateway are running.

---

**User message:**

> Make an HTTP GET request to this URL exactly:
>
> `https://blocked.invalid/`
>
> Use the configured proxy path. Return the status code and response body.

---

**Expected outcome**

- Proxy should reject this before forwarding and return **403** because `blocked.invalid` is not in proxy whitelist.
