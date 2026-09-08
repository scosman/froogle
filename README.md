# Froogle

### A fast, ad-free search engine portal in one HTML file

[Froogle](https://froogle.fyi) is a search engine portal in one HTML file (plus an optional proxy). Zero frameworks, zero dependencies. It uses the [Keenable](https://keenable.ai) search API.

 - **Ad-free**: no ads, ever.
 - **Simple**: no AI, no personalization. It's a list of web links.
 - **Private**: pretty good privacy compared to major search engines. We don't track anything, although our search API provider may. See below for details.
 - **Fast**: nearly instant results.
 - **Open Source**: MIT.
 - **Self-Hostable**: just download index.html.

<p align="center">
<img width="481" height="339" alt="Preview" src="https://github.com/user-attachments/assets/e964109b-809a-4408-92c2-aefe2de4f10c" />
</p>

### Privacy

Our search is powered by the [Keenable](https://keenable.ai) API. Keenable will see all search queries and may track your requests. See [their privacy policy](https://keenable.ai/privacy) for details about how they handle your data.

On the Froogle side we don't log or track anything. There are two modes with different privacy tradeoffs you can choose from:

 - **Proxied mode** (default on [Froogle.fyi](https://froogle.fyi)): queries are proxied through Froogle's servers to the Keenable API. Nothing is logged or tracked by Froogle servers. Keenable may still log and track queries, but we don't pass them any personal identifier or your IP; your traffic is mixed with other Froogle users. This mode may hit rate limits. Zero setup.
 - **Direct mode**: you can enter a Keenable API key, which is saved to your browser's local storage. All requests go directly from your browser to Keenable; Froogle never sees your queries. You'll need to create an account with Keenable to set up this mode. Keenable will be able to identify you via the unique API key.

You can change your mode in settings.

### Self Hosting

 - Simple: download index.html, open it, set up an API key, and search. You can host it anywhere, including your Downloads folder.
 - Proxy mode: runs a proxy for queries. Download this repo and run `node src/serve.mjs`.

See the [technical docs](./specs/DESIGN.md) for details.

### Powered by Keenable.ai

Froogle is powered by [Keenable](https://keenable.ai), a web search infrastructure provider. We may add other search API providers in the future.

Froogle is not associated with Keenable.

### License

MIT licensed — see [LICENSE](LICENSE).


