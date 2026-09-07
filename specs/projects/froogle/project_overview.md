---
status: draft
---

# Froogle

I want to make "Froogle", a free search engine using the https://docs.keenable.ai/api-reference API.

## Deployment shapes

* **Option 1: self hostable.** I want this regardless. Should be trivial to self host (docker
  image P2), or to deploy to your own Cloudflare Workers (portable across many hosts, but
  instructions for CF in README). I'm thinking that means Node/TS?
* **Option 2: public instance.** I'll host one, but I expect to quickly hit the 10 requests per
  second limit and 100k/mo if popular at all. Check how the API works. There's an unauthenticated
  mode with request limit per IP -- can I call it from the client's browser? Would need CORS which
  I doubt the API has. Fallback if no CORS would be backend fallback: if the authenticated version
  fails, fall back to unauthenticated. On super distributed Cloudflare Workers, I have a lot of IPs
  on the backend. Maybe a config flag for which to try first. My deployment might do unauth first,
  and use the key on rate limits.
* **API key optional:** the unauthenticated one works fine for most people self hosted.

## Design

Very "old school Google". Just "Froogle" above the search box, small about at the bottom. SERP page
is a simple list of links. All pages return as a single file, CSS in the file. No frameworks. No
images.

## Config options

* Search engine name (default "Froogle")
* API key (default none)
* `unauthenticated_first` (bool, default false; if an API key is present and this is set, try
  unauthenticated before authenticated)

## Open questions

* API options: TBD
* SERP design: TBD
