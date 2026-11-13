# React dashboard

This frontend stays in React and talks to the Rust API. From this directory:

```sh
npm ci
npm run dev
```

Set `VITE_API_URL` in `.env` if the API is not at `http://127.0.0.1:8000`.
See the project [README](../README.md) for backend setup and migration steps.

`npm run build` creates the production build; `npm run lint` checks source code.
