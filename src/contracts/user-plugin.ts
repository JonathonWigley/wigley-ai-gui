import type {
  ChannelShape,
  MainApi,
  MainStart,
  PageApi,
  PageStart,
  PluginManifest,
  UntypedEvents,
} from './plugin';

export type UserMainApi = MainApi<
  PluginManifest,
  ChannelShape,
  UntypedEvents,
  UntypedEvents
>;
export type UserMainStart = MainStart<PluginManifest>;
export type UserPageApi = PageApi<
  PluginManifest,
  ChannelShape,
  UntypedEvents,
  UntypedEvents
>;
export type UserPageStart = PageStart<PluginManifest>;

// What a user plugin's `main.js` exports.
export interface UserMainModule {
  start(api: UserMainApi): UserMainStart;
}

// What a user plugin's `page.js` exports.
export interface UserPageModule {
  start(api: UserPageApi): UserPageStart;
}
