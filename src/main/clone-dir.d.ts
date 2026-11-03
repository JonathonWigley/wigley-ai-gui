// The repo clone's absolute path, baked into the main bundle by
// `vite.main.config.mts`'s `define`: the build's `WIGLEY_CLONE_DIR`
// environment variable (`npm run install-app` sets it to the main clone), else
// the repo the build runs in.
declare const WIGLEY_CLONE_DIR: string;
