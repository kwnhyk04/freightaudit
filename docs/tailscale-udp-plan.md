# Direct UDP for the demo's tailscale node: plan

Status: a plan only, nothing built (2026-10-22). It would reverse part of the egress design in `docs/threat-notes.md`,
so it waits for the user's review. Sources are listed at the end; anything not read in a source says so.

## Why

- Today the tailscale container has no UDP route out. Every Funnel connection therefore rides the node's one relay
  (DERP) tunnel, over HTTPS through squid's port 3129 (`docs/deploy.md`).
- Measured on 2026-10-21 at a calm moment, from the PC (docs/context.md, Known Limitations): 3 of 10 public `/healthz`
  and `/readyz` requests answered within 2.5 s, and 2 of 10 never connected in 30 s. The slowest answer took 5.68 s.
  Most of the time went to the TLS handshake (up to 5.0 s), which ends at the node, over the relay.
- On 2026-10-18 the same request took 1.7 s on a new TLS connection and 0.46 s on a reused one, with the home relay in
  `sin`. On 2026-10-21 the home relay was `hkg`.
- What the numbers cannot show: every measurement ran on the PC itself, so the public client and the node shared the
  home uplink. The two no-connects stalled at the TCP connect to Funnel's ingress (activity log, 2026-10-21), before
  any byte could reach the node. Vercel's own leg was not measured. So it is not known how much of the delay direct UDP
  would remove.

## How the traffic flows

From Tailscale's documentation (read through web search on 2026-10-22; the site itself is refused by this session's
egress proxy, so no page was read whole):

- Funnel: public DNS answers with a Funnel relay (ingress) server's address, never the node's. The ingress proxies the
  TCP stream to the node over the tailnet, encrypted, and TLS ends on the node, here the tailscale container.
- Funnel's ingress servers are peers of the node in the tailnet, marked so that they have no packet-level access. All
  they can do is offer a funneled TCP connection, which the node accepts or refuses.
- Between two peers, Tailscale sends WireGuard over UDP directly when it can get through the NATs, and otherwise over
  a DERP relay on TCP 443. A forum answer in the same results adds that the first packets of a new path always go over
  DERP while it negotiates, so the relay stays needed either way.

```
Today:   client --TCP 443--> Funnel ingress --WireGuard over DERP--> relay (hkg)
                             relay <--HTTPS CONNECT, squid :3129-- tailscale container --edge--> api:4000
Direct:  client --TCP 443--> Funnel ingress --WireGuard over UDP--> home router NAT --> Docker Desktop NAT
                             --> tailscale container (behind the firewall below) --edge--> api:4000
```

## What exactly opens, and to where

Tailscale's firewall FAQ (via search): outbound UDP from the node's port, 41641 by default, to any destination for
direct connections; outbound UDP to port 3478 for STUN, which the client sends only to DERP servers; TCP 443 for DERP;
the control plane on TCP 80 or 443. For this demo that becomes:

1. Outbound UDP from the tailscale node, from one fixed port, 41641, set with
   `TS_TAILSCALED_EXTRA_ARGS=--port=41641` (the image's way to pass tailscaled flags; to check on the pinned v1.102.5):
   - to UDP 3478 on the DERP servers (STUN), whose addresses come from Tailscale's DERP map;
   - to the Funnel ingress peers' endpoints, any public address and port, learned from the control plane at run time.
     They cannot be listed ahead, so the rule has to be "any public address".
2. Inbound UDP: only replies to those flows, by connection tracking, through Docker Desktop's NAT and the home router.
   No port forward on the router, and no UPnP, NAT-PMP or PCP: tailscaled's port mapper asks the LAN gateway, a private
   address, which the rules below drop.
3. Unchanged: TCP stays on squid (control plane, logs, Let's Encrypt, and DERP for negotiation and fallback), the api
   stays on `edge`, and nothing new is published on the PC.
4. Still closed: UDP or TCP to any loopback, private, link-local, CGNAT or other non-public address, Docker Desktop's
   `host.docker.internal` (192.168.65.254) included; TCP to anything but squid and the api; IPv6.

## How it fits the egress lockdown

Today only squid sits on a routed network. The worker and the tailscale container are on internal networks, because a
container on a routed network reaches the PC's own listeners at `host.docker.internal`: before the proxy, the dev and
FilingLens stores, Windows RPC 135 and SMB 445 all answered (docs/threat-notes.md). Squid cannot carry UDP, since it
proxies HTTP and CONNECT only, and tailscaled sends its WireGuard UDP on its own sockets, with no proxy setting for it
(training knowledge, not checked tonight: `HTTPS_PROXY` covers its TCP only). So direct UDP needs a routed network for
the node, plus a firewall that keeps the lockdown's promise for everything except public UDP.

**Option A, a firewall sidecar** (the one to build if we go direct):

- A new container, `tailscale-net`, owns the network namespace. It is Alpine with nftables, built and scanned in CI
  like squid and pinned by digest. It joins `edge`, `outbound` as 10.231.231.3 (so squid's port rule still matches)
  and a new routed network `udp-out`. It needs `NET_ADMIN`, loads its rules at start, then only sleeps.
- The tailscale container joins that namespace (`network_mode: service:tailscale-net`) and keeps `cap_drop: [ALL]`, a
  read-only root and `no-new-privileges`. Holding no `NET_ADMIN`, it cannot change the rules it runs behind.
- The rules (nftables, IPv4 only):
  - output: policy drop; accept loopback, and established or related flows; accept TCP to squid's port 3129 on
    `outbound` and to the api's port 4000 on `edge` (with fixed subnets for `edge` and `udp-out`, as `outbound` has);
    drop every non-public destination (squid's `non_public` list); accept UDP from port 41641 to any other address;
  - input: policy drop; accept loopback, and established or related flows.
- Costs: a capability the design has avoided so far, on the sidecar; a second container on a routed network; one more
  image to build, scan and keep current. The rules become part of the boundary that protects the PC, so a mistake in
  them opens it.
- If the sidecar restarts, its namespace goes with it, and the tailscale container must be recreated too (compose's
  `depends_on` with `restart: true`).

**Rejected:**

- The tailscale container on a routed network with no filter: it would reach the PC's listeners, which is what the
  lockdown exists to stop.
- Host networking, or Tailscale on Windows itself: the same reach, and docs/deploy.md keeps the container as the only
  device.
- A UDP proxy: squid has none, and tailscaled cannot send WireGuard through a proxy.
- Tailscale Peer Relays (in-tailnet UDP relays, documented as beta): they still need UDP on a device of ours, so they do
  not avoid the change.

## What it exposes

| | Today (relay) | Direct (option A) |
| --- | --- | --- |
| Outbound TCP | 443 to Tailscale's control plane, logs, relays and Let's Encrypt, through squid | Unchanged |
| Outbound UDP | None | From port 41641 to any public address and port; non-public addresses dropped |
| Inbound | None; everything arrives inside the relay tunnel | Replies to those flows only, through two NATs; no port forward |
| Capabilities | None anywhere | `NET_ADMIN` on the sidecar, which runs no network service |
| Who sees the PC's public address | Tailscale's control plane and relays | Also Funnel's ingress peers and Tailscale's STUN servers; visitors still see only Funnel's addresses |
| A compromised tailscale container | Reaches any Tailscale node through a relay (docs/threat-notes.md) | Also sends UDP to any public host, a wider way out for data |
| Pre-authentication input | None from the internet | tailscaled parses STUN replies and its discovery messages from peer addresses; WireGuard drops any packet not keyed to the node |
| DNS | Docker's resolver answers internal names only (docs/memory.md, 2026-10-17) | To check: with a routed network in the namespace it may answer external names; if so, set it to fail them |

## Will it work on this PC

The unknowns that decide it, cheapest first:

1. Docker Desktop's NAT for UDP. If it gives each destination a new source port ("hard" NAT), a direct path may still
   fail. A Docker forum answer says Docker Desktop for Windows has no way around its NAT for outbound UDP; a forum
   answer, not confirmed for this PC.
2. The home router's NAT and filtering: unknown.
3. Whether Funnel's ingress peers take a direct path: they are tailnet peers, so they should, but no document found in
   the search says so.
4. Which leg is slow: from the PC alone, the client-to-ingress leg cannot be told apart from the ingress-to-node leg,
   and the no-connects happened on the first.

## How we would test it

**Stage 0, read-only, on the PC as it runs today:**

- `MSYS_NO_PATHCONV=1 docker exec freightaudit-prod-tailscale-1 tailscale --socket=/tmp/tailscaled.sock netcheck`:
  expect `UDP: false` and each region's latency, measured over HTTPS.
- The same container's `tailscale status`: every peer's path reads "relay" today; a direct one would read "direct".
- The 2026-10-21 timing (five rounds a minute apart, `/healthz` and `/readyz`, a new connection each), from the PC
  and from outside the home network (a phone on mobile data, or any machine elsewhere), to see which leg is slow.

**Stage 1, a throwaway container, nothing of the demo touched:**

- A temporary routed network with a name of its own, then
  `docker run --rm --network <it> --entrypoint tailscale tailscale/tailscale:v1.102.5@sha256:c507f3a2a6ab1cabd8d809b98edeb41edbd5c3fb6ad9632ffd098b4c7d0b4065 netcheck`
  (the demo's pinned image; expected to need no login, to check). Read `UDP`, `MappingVariesByDestIP` (true means hard NAT) and `PortMapping`.
- Remove that network by its exact name afterwards; never prune.
- Stop here if `UDP` is false. If `MappingVariesByDestIP` is true, a direct path is doubtful; decide before stage 2.

**Stage 2, the sidecar on a branch:**

- The reachability probes of 2026-10-17, run inside the shared namespace: `host.docker.internal` on 135 and 445, the
  dev and FilingLens ports, 10/8, 172.16/12, 192.168/16, and a public TCP 443 directly must all fail; squid's 3129 and
  the api's 4000 must answer; UDP to a public STUN server must answer, and UDP to 192.168.65.254 must not.
- `nft list ruleset` in the sidecar matches the committed file.
- squid's log shows no new denial.

**Stage 3, on the demo:**

- `pnpm demo:up`; then `tailscale netcheck` reads `UDP: true` and `tailscale status` reads "direct" for the Funnel
  peers.
- The stage 0 timing again, from both places, once at a calm moment and once during normal traffic, on two days.
  Success: at least 9 of 10 within 2.5 s from both places and no no-connect. Otherwise roll back.
- Rollback: the previous `infra/docker-compose.prod.yml`, then `pnpm demo:up`. The login and the certificate stay in
  `freightaudit-prod-tailscale-state`, so nothing is issued again.

## Staying on the relay

- Nothing new is exposed, and the threat model stays as reviewed.
- With the readyz stopgap (branch `readyz-stopgap`), the site stops flipping to the sample. Pages still pay 2 to 6 s
  for each new connection, and a probe that never connects still reads as offline for 5 s.
- Cheap things to measure while staying, none shown to matter yet:
  - Reused connections: 0.46 s against 1.7 s for a new one (2026-10-18). Vercel reuses a connection only inside a warm
    instance, so this is something to know, not to build.
  - Fewer relay regions: a `derpMap` in the tailnet policy can turn regions off (each set to null), so tailscaled stops
    measuring 28 regions and keeps a nearby home relay.
  - Squid's memory: 121.4 of its 128 MiB on 2026-10-21 (docs/memory.md, Unresolved Questions); a higher limit is cheap,
    but nothing ties it to the slow path.

## Recommendation

Stay on the relay for now, with the stopgap, and run stages 0 and 1: one is read-only and the other uses a throwaway
container, about 15 minutes together. Build the sidecar only if stage 1 shows UDP with an easy NAT and stage 0 shows
that the slow part is the ingress-to-node leg. The reason: the sidecar adds a capability and a second routed container
to the boundary that protects the PC, for a gain the measurements do not prove yet.

## Sources

- This repository: docs/context.md (Known Limitations), docs/deploy.md, docs/threat-notes.md, docs/memory.md,
  docs/activity-log.md (2026-10-18 and 2026-10-21), `infra/docker-compose.prod.yml`, `infra/squid.conf`.
- Tailscale's documentation, from web search results on 2026-10-22 (tailscale.com answered 403 through this session's
  egress proxy): the firewall ports FAQ (kb/1082), Funnel (kb/1223), custom DERP servers (kb/1118), Peer Relays and
  Docker parameters (kb/1282).
- A Docker forum thread on Docker Desktop for Windows and outbound UDP (forums.docker.com, through search).
- Training knowledge, not checked tonight: in userspace mode tailscaled still sends WireGuard on its own UDP sockets,
  and `HTTPS_PROXY` covers only its TCP.
