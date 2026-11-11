// The commit the packaged app was built from, baked into the main bundle by
// `vite.main.config.mts`'s `define`: the build's `WIGLEY_BUILD_COMMIT`
// environment variable (`npm run install-app` sets it to the commit it
// packages), else empty, as in the dev app.
declare const WIGLEY_BUILD_COMMIT: string;
