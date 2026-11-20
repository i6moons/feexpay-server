# Contributing

Thanks for your help! Issues and pull requests are welcome in English or French.

## Getting started

```sh
git clone https://github.com/i6moons/feexpay-server.git
cd feexpay-server
npm install
npm test
```

Before opening a pull request, `npm run typecheck`, `npm test` and `npm run build` must pass.

## Project rules

1. **Every behavior is backed by a source.** Cite the section of the [FeexPay documentation](https://docs.feexpay.me) in a comment. If the behavior was observed and is not documented, say so ("observed in production on …").
2. **Zero runtime dependencies.** `fetch` and standard Web APIs are enough: the package must run on Node, Edge, Bun and Deno.
3. **One test per behavior**, using the simulator (`src/testing.ts`). If it cannot reproduce a case, extend it by following the "Sandbox" section of the documentation.
4. **The key never leaks**: not in a message, not in a returned object, not in a log.

## Does a network behave differently for you?

Open an issue with:
- the network (`network`);
- the environment (sandbox or live);
- the request and the response, **without the key and with the number masked** (`maskPhoneNumber`).

This feedback is valuable: the documentation does not cover everything.
