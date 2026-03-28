# Demo prompt: Premium macro report (Track 1)

Use this in OpenClaw chat after the gateway is running, **Aegis** is listening on `127.0.0.1:8080`, and the premium API is on `127.0.0.1:9090` with `network.proxy` configured per `packages/aegis-openclaw/openclaw.json5.example`.

---

**User message:**

> Fetch the premium macroeconomic report. Use an HTTP GET to this URL exactly (do not substitute a different host or port):
>
> `http://127.0.0.1:9090/v1/macro/premium-report`
>
> Return the JSON body to me. If you receive an error, show the status code and response body.

---

**Notes for the team**

- The agent must use a tool that performs a real HTTP request (e.g. web fetch) so traffic can go through the proxy.
- A successful **Track 1** demo ends with **200** and the premium JSON **after** Aegis pays the 402. That requires a **devnet-funded** wallet for USDC per x402 facilitator rules (see `aegis-premium-api` README).
- **Out of scope for Dev 3:** Squads/Swig signing, Electron approval UI, on-chain program-ID blocking (see scoped plan).
